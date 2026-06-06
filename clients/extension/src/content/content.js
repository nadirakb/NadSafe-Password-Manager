/**
 * NadSafe content script — autofill + web app bridge.
 *
 * Two roles:
 *   1. Detect login forms → inject autofill button
 *   2. Bridge: listen for window.postMessage from NadSafe web app
 *              → relay UNLOCK/PUSH_ITEMS to background service worker
 */

const AUTOFILL_ATTR = "data-nadsafe-autofill";
const BRIDGE_ORIGIN_ALLOW_ANY = true; // dev mode: allow any origin; prod: restrict to serverUrl

// ─── Web app bridge ───────────────────────────────────────────────────────────

window.addEventListener("message", (event) => {
  if (!event.data || typeof event.data !== "object") return;
  if (event.data.source !== "nadsafe-webapp") return;

  const { type, payload } = event.data;

  switch (type) {
    case "PUSH_SESSION":
      // Web app sends unlock credentials + decrypted items
      chrome.runtime.sendMessage({
        type: "UNLOCK",
        ...payload,
      }, (res) => {
        window.postMessage({
          source: "nadsafe-extension",
          type: "SESSION_RESULT",
          ok: res?.ok ?? false,
          error: res?.error,
        }, "*");
      });
      break;

    case "PUSH_ITEMS":
      // Web app pushes pre-decrypted items for autofill
      chrome.runtime.sendMessage({
        type: "STORE_ITEMS",
        items: payload.items,
      });
      break;

    case "PING":
      // Web app checks if extension is installed
      window.postMessage({
        source: "nadsafe-extension",
        type: "PONG",
        version: chrome.runtime.getManifest().version,
      }, "*");
      break;
  }
});

// Notify web app that extension is present (on NadSafe pages)
window.postMessage({ source: "nadsafe-extension", type: "READY" }, "*");

// ─── Autofill detection ───────────────────────────────────────────────────────

function findLoginForms() {
  const forms = [];
  const allForms = document.querySelectorAll("form");

  for (const form of allForms) {
    const passwordInput = form.querySelector('input[type="password"]');
    if (!passwordInput) continue;

    const usernameInput =
      form.querySelector('input[type="email"]') ||
      form.querySelector('input[type="text"][autocomplete*="user"]') ||
      form.querySelector('input[type="text"][autocomplete*="email"]') ||
      form.querySelector('input[type="text"]');

    forms.push({ form, usernameInput, passwordInput });
  }

  return forms;
}

async function offerAutofill() {
  const loginForms = findLoginForms();
  if (loginForms.length === 0) return;

  const status = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
  if (status?.locked) return;

  const result = await chrome.runtime.sendMessage({
    type: "AUTOFILL_QUERY",
    url: location.href,
  });

  if (!result?.matches?.length) return;

  for (const { usernameInput, passwordInput } of loginForms) {
    if (passwordInput.getAttribute(AUTOFILL_ATTR)) continue;
    injectAutofillButton(usernameInput, passwordInput, result.matches);
    passwordInput.setAttribute(AUTOFILL_ATTR, "1");
  }
}

function injectAutofillButton(usernameInput, passwordInput, matches) {
  const container = passwordInput.parentElement;
  if (!container) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "🔑 NadSafe";
  btn.style.cssText = `
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    background: #4f6ef7;
    color: white;
    border: none;
    border-radius: 4px;
    padding: 3px 8px;
    font-size: 12px;
    cursor: pointer;
    z-index: 99999;
    font-family: system-ui, sans-serif;
  `;

  // Show dropdown if multiple matches
  if (matches.length > 1) {
    btn.addEventListener("click", () => showMatchDropdown(btn, matches, usernameInput, passwordInput));
  } else {
    btn.addEventListener("click", () => fillCredential(matches[0], usernameInput, passwordInput));
  }

  const wrapper = passwordInput.parentElement;
  if (wrapper) {
    wrapper.style.position = "relative";
    wrapper.appendChild(btn);
  }
}

function fillCredential(match, usernameInput, passwordInput) {
  if (usernameInput && match.username) {
    usernameInput.value = match.username;
    usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
    usernameInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
  if (passwordInput && match.password) {
    passwordInput.value = match.password;
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
  }
}

function showMatchDropdown(btn, matches, usernameInput, passwordInput) {
  // Remove any existing dropdown
  document.querySelector(".nadsafe-dropdown")?.remove();

  const dropdown = document.createElement("div");
  dropdown.className = "nadsafe-dropdown";
  dropdown.style.cssText = `
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
    z-index: 99999;
    min-width: 220px;
    overflow: hidden;
  `;

  matches.forEach((match) => {
    const item = document.createElement("button");
    item.type = "button";
    item.style.cssText = `
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      width: 100%;
      padding: 10px 14px;
      border: none;
      background: none;
      cursor: pointer;
      text-align: left;
      transition: background 0.1s;
      border-bottom: 1px solid #f1f5f9;
    `;
    item.innerHTML = `
      <span style="font-size:13px;font-weight:600;color:#1e293b">${match.name}</span>
      <span style="font-size:11px;color:#64748b">${match.username}</span>
    `;
    item.addEventListener("mouseover", () => { item.style.background = "#f8fafc"; });
    item.addEventListener("mouseout", () => { item.style.background = ""; });
    item.addEventListener("click", () => {
      fillCredential(match, usernameInput, passwordInput);
      dropdown.remove();
    });
    dropdown.appendChild(item);
  });

  btn.parentElement.appendChild(dropdown);
  setTimeout(() => document.addEventListener("click", () => dropdown.remove(), { once: true }), 0);
}

// Listen for AUTOFILL message from popup
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "AUTOFILL") {
    chrome.runtime.sendMessage({ type: "GET_ITEMS" }, (res) => {
      const item = res?.items?.find((i) => i.id === message.itemId);
      if (!item?.login) return;
      const forms = findLoginForms();
      for (const { usernameInput, passwordInput } of forms) {
        fillCredential(item.login, usernameInput, passwordInput);
        break;
      }
    });
  }
});

// Run after page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", offerAutofill);
} else {
  offerAutofill();
}

// Re-check for forms added dynamically (SPAs)
const observer = new MutationObserver(() => {
  clearTimeout(window._nadsafeOfferTimer);
  window._nadsafeOfferTimer = setTimeout(offerAutofill, 500);
});
observer.observe(document.body, { childList: true, subtree: true });
