/**
 * NadSafe content script.
 * Detects login forms and offers autofill.
 */

const AUTOFILL_ATTR = "data-nadsafe-autofill";

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
  if (status.locked) return;

  const result = await chrome.runtime.sendMessage({
    type: "AUTOFILL_QUERY",
    url: location.href,
  });

  if (!result.matches || result.matches.length === 0) return;

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
  `;

  const wrapper = container.style.position ? container : container;
  wrapper.style.position = "relative";
  wrapper.appendChild(btn);

  btn.addEventListener("click", () => {
    const match = matches[0];
    if (usernameInput) usernameInput.value = match.username;
    // Password fill happens after decryption in background
    chrome.runtime.sendMessage({
      type: "FILL_PASSWORD",
      itemId: match.id,
    });
  });
}

// Run on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", offerAutofill);
} else {
  offerAutofill();
}
