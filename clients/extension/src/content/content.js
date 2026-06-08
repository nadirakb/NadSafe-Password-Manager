/**
 * NadSafe content script — autofill UI + web app bridge.
 *
 * Roles:
 *   1. Inject Proton-Pass-style floating icon into focused email/password fields
 *   2. Show inline dropdown: email suggestions + alias, or fill-from-vault + generator
 *   3. Bridge: relay PUSH_SESSION / PUSH_ITEMS from NadSafe web app → background
 */

const ext = typeof browser !== "undefined" ? browser : chrome;

// ─── Web app bridge ───────────────────────────────────────────────────────────

window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  if (event.data.source !== "nadsafe-webapp") return;
  const { type, payload } = event.data;
  switch (type) {
    case "PUSH_SESSION":
      ext.runtime.sendMessage({ type: "UNLOCK", ...payload }, (res) => {
        window.postMessage({ source: "nadsafe-extension", type: "SESSION_RESULT", ok: res?.ok ?? false, error: res?.error }, "*");
      });
      break;
    case "PUSH_ITEMS":
      ext.runtime.sendMessage({ type: "STORE_ITEMS", items: payload.items });
      break;
    case "PING":
      window.postMessage({ source: "nadsafe-extension", type: "PONG", version: ext.runtime.getManifest().version }, "*");
      break;
  }
});
window.postMessage({ source: "nadsafe-extension", type: "READY" }, "*");

// ─── Password generator ────────────────────────────────────────────────────────

function ri(max) {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % max;
}

function generatePassword(length = 20) {
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const digits = "0123456789";
  const syms = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  const charset = upper + lower + digits + syms;
  const required = [upper[ri(upper.length)], lower[ri(lower.length)], digits[ri(digits.length)], syms[ri(syms.length)]];
  const rest = Array.from({ length: length - 4 }, () => charset[ri(charset.length)]);
  const all = [...required, ...rest];
  for (let i = all.length - 1; i > 0; i--) {
    const j = ri(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.join("");
}

// ─── NadSafe icon SVG ─────────────────────────────────────────────────────────

const ICON_SVG = `<svg width="18" height="18" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <path d="M50 5 L95 20 L95 68 C95 87 50 97 50 97 C50 97 5 87 5 68 L5 20 Z" fill="#0f172a" stroke="#3b82f6" stroke-width="2.5"/>
  <path d="M50 13 L87 26 L87 67 C87 81 50 90 50 90 C50 90 13 81 13 67 L13 26 Z" fill="none" stroke="#1e3a8a" stroke-width="1.2"/>
  <path d="M33 64 L33 38 L67 64 L67 38" fill="none" stroke="#f59e0b" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="22" y="64" width="56" height="27" rx="5" fill="#1d4ed8" stroke="#3b82f6" stroke-width="1.5"/>
  <circle cx="50" cy="75" r="5" fill="#bfdbfe"/>
  <rect x="47" y="75" width="6" height="9" rx="3" fill="#bfdbfe"/>
</svg>`;

// ─── Field utilities ──────────────────────────────────────────────────────────

function fillField(field, value) {
  // Use native setter so React synthetic events fire correctly
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  if (desc?.set) desc.set.call(field, value);
  else field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

function classifyField(input) {
  if (input.type === "password") return "password";
  if (input.type === "email") return "email";
  if (input.type !== "text" && input.type !== "search" && input.type !== "") return null;
  const ac = (input.getAttribute("autocomplete") ?? "").toLowerCase();
  const name = (input.name ?? "").toLowerCase();
  const id = (input.id ?? "").toLowerCase();
  const placeholder = (input.placeholder ?? "").toLowerCase();
  const emailHints = ["email", "username", "user", "login", "mail"];
  if (emailHints.some((h) => ac.includes(h) || name.includes(h) || id.includes(h) || placeholder.includes(h))) return "email";
  return null;
}

// ─── Floating icon ────────────────────────────────────────────────────────────

let iconEl = null;
let activeField = null;

function getIcon() {
  if (iconEl) return iconEl;
  iconEl = document.createElement("div");
  iconEl.setAttribute("data-nadsafe-ui", "icon");
  iconEl.style.cssText = [
    "position:fixed",
    "width:26px", "height:26px",
    "display:none",
    "align-items:center", "justify-content:center",
    "border-radius:5px",
    "background:#1e293b",
    "border:1px solid #334155",
    "cursor:pointer",
    "z-index:2147483646",
    "pointer-events:auto",
    "box-sizing:border-box",
    "box-shadow:0 2px 8px rgba(0,0,0,0.35)",
    "transition:box-shadow 0.15s",
  ].join(";");
  iconEl.innerHTML = ICON_SVG;
  iconEl.title = "NadSafe";
  iconEl.addEventListener("mouseover", () => { iconEl.style.boxShadow = "0 2px 12px rgba(59,130,246,0.5)"; });
  iconEl.addEventListener("mouseout",  () => { iconEl.style.boxShadow = "0 2px 8px rgba(0,0,0,0.35)"; });
  document.documentElement.appendChild(iconEl);
  return iconEl;
}

function positionIcon(field) {
  const icon = getIcon();
  const rect = field.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) { icon.style.display = "none"; return; }
  icon.style.top  = `${rect.top + (rect.height - 26) / 2}px`;
  icon.style.left = `${rect.right - 32}px`;
  icon.style.display = "flex";
}

// ─── Dropdown ─────────────────────────────────────────────────────────────────

let activeDropdown = null;

function closeDropdown() {
  activeDropdown?.remove();
  activeDropdown = null;
}

function openDropdown(field) {
  closeDropdown();

  const el = document.createElement("div");
  el.setAttribute("data-nadsafe-ui", "dropdown");
  el.style.cssText = [
    "position:fixed",
    "background:#1e293b",
    "border:1px solid #334155",
    "border-radius:10px",
    "box-shadow:0 8px 32px rgba(0,0,0,0.55)",
    "z-index:2147483647",
    "min-width:250px",
    "max-width:320px",
    "overflow:hidden",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    "font-size:13px",
    "color:#e2e8f0",
  ].join(";");

  const rect = field.getBoundingClientRect();
  el.style.left = `${Math.min(rect.left, window.innerWidth - 258)}px`;
  el.style.top  = `${rect.bottom + 6}px`;

  document.documentElement.appendChild(el);
  activeDropdown = el;

  // Flip above field if overflows viewport
  requestAnimationFrame(() => {
    const elH = el.offsetHeight;
    if (rect.bottom + 6 + elH > window.innerHeight && rect.top - 6 - elH > 0) {
      el.style.top = `${rect.top - 6 - elH}px`;
    }
  });

  // Close on outside click — next tick so this event doesn't immediately close it
  setTimeout(() => {
    function outside(e) {
      if (!el.contains(e.target) && e.target !== iconEl) {
        closeDropdown();
        document.removeEventListener("click", outside, true);
      }
    }
    document.addEventListener("click", outside, true);
  }, 0);

  return el;
}

function addHeader(dropdown, label) {
  const h = document.createElement("div");
  h.style.cssText = "padding:10px 14px 8px;font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:0.06em;text-transform:uppercase;border-bottom:1px solid #334155;";
  h.textContent = label;
  dropdown.appendChild(h);
}

function addOption(dropdown, { emoji, label, sub, onClick, dimmed = false }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;padding:9px 14px;border:none;background:transparent;color:#e2e8f0;cursor:pointer;text-align:left;border-bottom:1px solid #263346;box-sizing:border-box;";

  const iconBox = document.createElement("div");
  iconBox.style.cssText = "width:32px;height:32px;background:#263346;border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:15px;";
  iconBox.textContent = emoji;

  const textWrap = document.createElement("div");
  textWrap.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;";

  const labelEl = document.createElement("span");
  labelEl.style.cssText = `font-size:13px;font-weight:500;color:${dimmed ? "#64748b" : "#f1f5f9"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`;
  labelEl.textContent = label;
  textWrap.appendChild(labelEl);

  if (sub) {
    const subEl = document.createElement("span");
    subEl.style.cssText = "font-size:11px;color:#64748b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    subEl.textContent = sub;
    textWrap.appendChild(subEl);
  }

  btn.appendChild(iconBox);
  btn.appendChild(textWrap);

  btn.addEventListener("mouseover", () => { btn.style.background = "#263346"; });
  btn.addEventListener("mouseout",  () => { btn.style.background = "transparent"; });
  // Prevent blur on the active field when clicking dropdown options
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(btn, labelEl); });

  dropdown.appendChild(btn);
  return btn;
}

function addSeparator(dropdown) {
  const sep = document.createElement("div");
  sep.style.cssText = "height:1px;background:#263346;";
  dropdown.appendChild(sep);
}

// ─── Email dropdown ───────────────────────────────────────────────────────────

async function showEmailDropdown(field, matches) {
  const dropdown = openDropdown(field);
  addHeader(dropdown, "Email");

  const seen = new Set();
  for (const m of matches) {
    if (!m.username || seen.has(m.username)) continue;
    seen.add(m.username);
    addOption(dropdown, {
      emoji: "📧",
      label: m.username,
      sub: m.name,
      onClick: () => { fillField(field, m.username); closeDropdown(); },
    });
  }

  if (seen.size > 0) addSeparator(dropdown);

  // Alias (hide my email)
  let aliasConfig = null;
  try { aliasConfig = await ext.runtime.sendMessage({ type: "GET_ALIAS_CONFIG" }); } catch { /* no-op */ }

  if (aliasConfig?.configured) {
    const serviceName = aliasConfig.service === "simplelogin" ? "SimpleLogin" : "AnonAddy";
    addOption(dropdown, {
      emoji: "🎭",
      label: "Hide my email",
      sub: `Create ${serviceName} alias`,
      onClick: async (btn, labelEl) => {
        const origText = labelEl.textContent;
        labelEl.textContent = "Creating alias…";
        btn.style.pointerEvents = "none";
        try {
          const res = await ext.runtime.sendMessage({ type: "CREATE_ALIAS", hostname: new URL(location.href).hostname });
          if (res?.ok && res.alias) {
            fillField(field, res.alias);
            closeDropdown();
          } else {
            labelEl.textContent = res?.error ?? "Failed";
            setTimeout(() => { labelEl.textContent = origText; btn.style.pointerEvents = ""; }, 3000);
          }
        } catch {
          labelEl.textContent = "Error — check API key";
          setTimeout(() => { labelEl.textContent = origText; btn.style.pointerEvents = ""; }, 3000);
        }
      },
    });
  } else {
    addOption(dropdown, {
      emoji: "🎭",
      label: "Hide my email",
      sub: "Configure in NadSafe popup → Settings",
      dimmed: true,
      onClick: () => closeDropdown(),
    });
  }
}

// ─── Password dropdown ────────────────────────────────────────────────────────

function showPasswordDropdown(field, matches) {
  const dropdown = openDropdown(field);
  addHeader(dropdown, "Password");

  for (const m of matches) {
    addOption(dropdown, {
      emoji: "🔑",
      label: "Fill password",
      sub: `${m.name}${m.username ? ` · ${m.username}` : ""}`,
      onClick: () => {
        fillField(field, m.password);
        const form = field.closest("form");
        if (form && m.username) {
          const uField = form.querySelector('input[type="email"], input[type="text"]');
          if (uField && uField !== field) fillField(uField, m.username);
        }
        closeDropdown();
      },
    });
  }

  if (matches.length > 0) addSeparator(dropdown);

  // Inline generator
  const genWrap = document.createElement("div");
  genWrap.style.cssText = "padding:10px 14px 12px;";
  genWrap.addEventListener("mousedown", (e) => e.preventDefault());

  const genTitle = document.createElement("div");
  genTitle.style.cssText = "font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px;";
  genTitle.textContent = "Generate";
  genWrap.appendChild(genTitle);

  let currentPw = generatePassword(20);

  const pwEl = document.createElement("div");
  pwEl.style.cssText = "background:#0f172a;border:1px solid #334155;border-radius:7px;padding:8px 10px;font-family:'Courier New',Courier,monospace;font-size:12px;color:#a5b4fc;word-break:break-all;margin-bottom:8px;user-select:all;letter-spacing:0.02em;line-height:1.5;";
  pwEl.textContent = currentPw;
  genWrap.appendChild(pwEl);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;gap:6px;";

  function makeBtn(text, primary) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = text;
    b.style.cssText = `flex:1;padding:6px 0;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;border:1px solid ${primary ? "#3b82f6" : "#334155"};background:${primary ? "#3b82f6" : "transparent"};color:${primary ? "#fff" : "#94a3b8"};transition:opacity 0.1s;`;
    b.addEventListener("mouseover", () => { b.style.opacity = "0.85"; });
    b.addEventListener("mouseout",  () => { b.style.opacity = "1"; });
    b.addEventListener("mousedown", (e) => e.preventDefault());
    return b;
  }

  const regenBtn = makeBtn("↻ New", false);
  const fillBtn  = makeBtn("Fill",  true);

  regenBtn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    currentPw = generatePassword(20);
    pwEl.textContent = currentPw;
  });

  fillBtn.addEventListener("click", (e) => {
    e.preventDefault(); e.stopPropagation();
    fillField(field, currentPw);
    closeDropdown();
  });

  btnRow.appendChild(regenBtn);
  btnRow.appendChild(fillBtn);
  genWrap.appendChild(btnRow);
  dropdown.appendChild(genWrap);
}

// ─── Match cache ──────────────────────────────────────────────────────────────

let matchCache = null;

async function getMatches() {
  const url = location.href;
  if (matchCache?.url === url) return matchCache.matches;
  try {
    const status = await ext.runtime.sendMessage({ type: "GET_STATUS" });
    if (status?.locked) return [];
    const res = await ext.runtime.sendMessage({ type: "AUTOFILL_QUERY", url });
    const matches = res?.matches ?? [];
    matchCache = { url, matches };
    return matches;
  } catch {
    return [];
  }
}

// ─── Field instrumentation ────────────────────────────────────────────────────

const decorated = new WeakSet();

function setupField(input) {
  if (decorated.has(input)) return;
  const type = classifyField(input);
  if (!type) return;
  decorated.add(input);

  input.addEventListener("focus", async () => {
    activeField = input;
    positionIcon(input);

    const matches = await getMatches();
    if (activeField !== input) return; // field blurred while awaiting

    if (type === "password") {
      showPasswordDropdown(input, matches);
    } else if (type === "email" && matches.length > 0) {
      showEmailDropdown(input, matches);
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      if (activeField === input) {
        getIcon().style.display = "none";
        activeField = null;
      }
    }, 200);
  });
}

// ─── Icon click ───────────────────────────────────────────────────────────────

getIcon().addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();
  if (!activeField) return;

  // Toggle: second click closes
  if (activeDropdown) { closeDropdown(); return; }

  const type = classifyField(activeField);
  const matches = await getMatches();

  if (type === "email") showEmailDropdown(activeField, matches);
  else if (type === "password") showPasswordDropdown(activeField, matches);
});

// ─── Reposition on scroll / resize ───────────────────────────────────────────

window.addEventListener("scroll", () => { if (activeField) positionIcon(activeField); }, { passive: true, capture: true });
window.addEventListener("resize", () => { if (activeField) positionIcon(activeField); }, { passive: true });

// ─── AUTOFILL message from popup ─────────────────────────────────────────────

ext.runtime.onMessage.addListener((message) => {
  if (message.type !== "AUTOFILL") return;
  ext.runtime.sendMessage({ type: "GET_ITEMS" }, (res) => {
    const item = res?.items?.find((i) => i.id === message.itemId);
    if (!item?.login) return;
    let usernameInput = null;
    let passwordInput = null;
    document.querySelectorAll("input").forEach((inp) => {
      if (!passwordInput && inp.type === "password") passwordInput = inp;
      if (!usernameInput && classifyField(inp) === "email") usernameInput = inp;
    });
    if (usernameInput && item.login.username) fillField(usernameInput, item.login.username);
    if (passwordInput && item.login.password) fillField(passwordInput, item.login.password);
  });
});

// ─── Save-login notification ──────────────────────────────────────────────────

let saveNotifEl = null;

function closeSaveNotif() {
  if (!saveNotifEl) return;
  saveNotifEl.style.animation = "nadsafe-slideout 0.2s ease-in forwards";
  setTimeout(() => { saveNotifEl?.remove(); saveNotifEl = null; }, 200);
}

function ensureSaveStyles() {
  if (document.querySelector("#nadsafe-save-styles")) return;
  const s = document.createElement("style");
  s.id = "nadsafe-save-styles";
  s.textContent = `
    @keyframes nadsafe-slidein {
      from { transform: translateX(calc(100% + 20px)); opacity: 0; }
      to   { transform: translateX(0); opacity: 1; }
    }
    @keyframes nadsafe-slideout {
      from { transform: translateX(0); opacity: 1; }
      to   { transform: translateX(calc(100% + 20px)); opacity: 0; }
    }
  `;
  document.documentElement.appendChild(s);
}

function showSaveNotification(hostname, username, password) {
  closeSaveNotif();
  ensureSaveStyles();

  const card = document.createElement("div");
  card.setAttribute("data-nadsafe-ui", "save-notif");
  card.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "width:288px",
    "background:#1e293b", "border:1px solid #334155", "border-radius:12px",
    "box-shadow:0 12px 40px rgba(0,0,0,0.55)",
    "z-index:2147483647",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif",
    "overflow:hidden",
    "animation:nadsafe-slidein 0.25s cubic-bezier(0.34,1.56,0.64,1) forwards",
  ].join(";");

  // ── Header ──────────────────────────────────────────────────────────────────
  const hdr = document.createElement("div");
  hdr.style.cssText = "display:flex;align-items:center;gap:8px;padding:12px 14px 10px;border-bottom:1px solid #2a3a50;";

  const hdrIcon = document.createElement("div");
  hdrIcon.innerHTML = ICON_SVG;
  hdrIcon.style.cssText = "width:20px;height:20px;flex-shrink:0;";

  const hdrTitle = document.createElement("span");
  hdrTitle.style.cssText = "font-size:14px;font-weight:700;color:#f1f5f9;flex:1;";
  hdrTitle.textContent = "Save login";

  const hdrClose = document.createElement("button");
  hdrClose.type = "button";
  hdrClose.innerHTML = "&#x2715;";
  hdrClose.style.cssText = "background:none;border:none;color:#64748b;cursor:pointer;font-size:16px;line-height:1;padding:2px 4px;border-radius:4px;";
  hdrClose.addEventListener("mouseover", () => { hdrClose.style.color = "#94a3b8"; });
  hdrClose.addEventListener("mouseout",  () => { hdrClose.style.color = "#64748b"; });
  hdrClose.addEventListener("click", closeSaveNotif);

  hdr.append(hdrIcon, hdrTitle, hdrClose);
  card.appendChild(hdr);

  // ── Body rows ────────────────────────────────────────────────────────────────
  function makeRow(emoji, labelText, valueText, mono = false) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #1e3040;";

    const icon = document.createElement("div");
    icon.style.cssText = "width:34px;height:34px;background:#1a2d42;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;";
    icon.textContent = emoji;

    const text = document.createElement("div");
    text.style.cssText = "display:flex;flex-direction:column;gap:2px;min-width:0;";

    const lbl = document.createElement("span");
    lbl.style.cssText = "font-size:10px;font-weight:600;color:#475569;text-transform:uppercase;letter-spacing:0.06em;";
    lbl.textContent = labelText;

    const val = document.createElement("span");
    val.style.cssText = `font-size:13px;font-weight:500;color:#e2e8f0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${mono ? "font-family:monospace;letter-spacing:0.08em;" : ""}`;
    val.textContent = valueText;

    text.append(lbl, val);
    row.append(icon, text);
    return row;
  }

  card.appendChild(makeRow("👤", "Username / email", username || "(none)"));
  card.appendChild(makeRow("🔑", "Password", "•".repeat(Math.min(password.length, 14)), true));

  // ── Actions ──────────────────────────────────────────────────────────────────
  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;gap:8px;padding:10px 14px;";

  function makeBtn(label, primary) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.style.cssText = `flex:1;padding:8px 0;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:1px solid ${primary ? "#3b82f6" : "#334155"};background:${primary ? "#3b82f6" : "transparent"};color:${primary ? "#fff" : "#94a3b8"};transition:opacity 0.1s;`;
    b.addEventListener("mouseover", () => { b.style.opacity = "0.85"; });
    b.addEventListener("mouseout",  () => { b.style.opacity = "1"; });
    return b;
  }

  const notNowBtn = makeBtn("Not now", false);
  const addBtn = makeBtn("Add", true);

  notNowBtn.addEventListener("click", closeSaveNotif);

  addBtn.addEventListener("click", async () => {
    addBtn.textContent = "Saving…";
    addBtn.disabled = true;
    try {
      const res = await ext.runtime.sendMessage({ type: "SAVE_CREDENTIAL", hostname, username, password });
      if (res?.ok) {
        addBtn.textContent = "✓ Saved";
        addBtn.style.background = "#16a34a";
        addBtn.style.borderColor = "#16a34a";
        // Invalidate match cache so new item appears on next focus
        matchCache = null;
        setTimeout(closeSaveNotif, 1500);
      } else {
        throw new Error(res?.error ?? "Unknown error");
      }
    } catch (err) {
      addBtn.textContent = "Failed";
      addBtn.style.background = "#dc2626";
      addBtn.style.borderColor = "#dc2626";
      setTimeout(() => {
        addBtn.textContent = "Add";
        addBtn.style.background = "#3b82f6";
        addBtn.style.borderColor = "#3b82f6";
        addBtn.disabled = false;
      }, 2500);
    }
  });

  actions.append(notNowBtn, addBtn);
  card.appendChild(actions);

  document.documentElement.appendChild(card);
  saveNotifEl = card;

  // Auto-dismiss after 20 seconds
  const autoDismiss = setTimeout(closeSaveNotif, 20_000);
  addBtn.addEventListener("click", () => clearTimeout(autoDismiss));
  notNowBtn.addEventListener("click", () => clearTimeout(autoDismiss));
  hdrClose.addEventListener("click", () => clearTimeout(autoDismiss));
}

// ─── Form submission detection ────────────────────────────────────────────────

function extractCreds(root) {
  const pwField = root.querySelector('input[type="password"]');
  if (!pwField?.value) return null;
  const uField =
    root.querySelector('input[type="email"]') ||
    root.querySelector('input[autocomplete*="user"], input[autocomplete*="email"]') ||
    root.querySelector('input[type="text"]');
  return { username: uField?.value ?? "", password: pwField.value };
}

const recentlySubmitted = new WeakSet();

function maybeSave(creds) {
  if (!creds?.password) return;
  const hostname = location.hostname;
  getMatches().then((matches) => {
    const known = matches.some((m) => m.username === creds.username && m.username !== "");
    if (!known) showSaveNotification(hostname, creds.username, creds.password);
  });
}

// Standard form submit
document.addEventListener("submit", (e) => {
  const form = e.target;
  if (recentlySubmitted.has(form)) return;
  recentlySubmitted.add(form);
  maybeSave(extractCreds(form));
}, true);

// SPA: button click inside a form-like container when no submit event fires
document.addEventListener("click", (e) => {
  const btn = e.target.closest('button[type="submit"], input[type="submit"]');
  if (!btn) return;
  const form = btn.closest("form");
  if (form) return; // submit event will fire
  // Formless submit button — scan surrounding container
  const root = btn.closest('[class*="form"], [class*="login"], [class*="auth"], section, main') ?? document.body;
  maybeSave(extractCreds(root));
}, true);

// ─── Init ─────────────────────────────────────────────────────────────────────

function scanPage() {
  document.querySelectorAll('input[type="email"], input[type="password"], input[type="text"], input[type="search"], input:not([type])').forEach(setupField);
}

function init() {
  scanPage();
  const observer = new MutationObserver(() => {
    clearTimeout(window._nadsafeScanTimer);
    window._nadsafeScanTimer = setTimeout(scanPage, 400);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
