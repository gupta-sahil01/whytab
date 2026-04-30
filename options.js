// WhyTab — options.js
// Manages the Groq API key stored in chrome.storage.local.

const input     = document.getElementById("apiKeyInput");
const saveBtn   = document.getElementById("saveBtn");
const clearBtn  = document.getElementById("clearBtn");
const toggleBtn = document.getElementById("toggleVisibility");
const eyeIcon   = document.getElementById("eyeIcon");
const statusEl  = document.getElementById("status");

// ─── Load saved key on open ───────────────────────────────────────────────────

async function loadKey() {
  const result = await chrome.storage.local.get("groqApiKey");
  if (result.groqApiKey) {
    input.value = result.groqApiKey;
  }
}

// ─── Status helper ────────────────────────────────────────────────────────────

function showStatus(message, type = "success") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
  statusEl.classList.remove("hidden");
  setTimeout(() => statusEl.classList.add("hidden"), 3000);
}

// ─── Save ─────────────────────────────────────────────────────────────────────

saveBtn.addEventListener("click", async () => {
  const key = input.value.trim();

  if (!key) {
    showStatus("Please enter an API key.", "error");
    input.focus();
    return;
  }

  if (!key.startsWith("gsk_")) {
    showStatus("That doesn't look like a valid Groq key.", "error");
    return;
  }

  await chrome.storage.local.set({ groqApiKey: key });
  showStatus("API key saved.");
});

// ─── Clear ────────────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("groqApiKey");
  input.value = "";
  showStatus("API key cleared.");
});

// ─── Toggle visibility ────────────────────────────────────────────────────────

toggleBtn.addEventListener("click", () => {
  const isHidden = input.type === "password";
  input.type = isHidden ? "text" : "password";
  eyeIcon.textContent = isHidden ? "◎" : "◉";
  toggleBtn.setAttribute("aria-label", isHidden ? "Hide key" : "Show key");
});

// ─── Enter key saves ──────────────────────────────────────────────────────────

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") saveBtn.click();
});

// ─── Auto-close settings ──────────────────────────────────────────────────────

const autoCloseCheckbox = document.getElementById("autoCloseEnabled");
const autoCloseDaysInput = document.getElementById("autoCloseDays");
const thresholdField     = document.getElementById("thresholdField");
const autoCloseSaveBtn   = document.getElementById("autoCloseSaveBtn");
const autoCloseStatusEl  = document.getElementById("autoCloseStatus");

function showAutoCloseStatus(message, type = "success") {
  autoCloseStatusEl.textContent = message;
  autoCloseStatusEl.className = `status ${type}`;
  autoCloseStatusEl.classList.remove("hidden");
  setTimeout(() => autoCloseStatusEl.classList.add("hidden"), 3000);
}

function syncThresholdVisibility() {
  thresholdField.classList.toggle("hidden", !autoCloseCheckbox.checked);
}

autoCloseCheckbox.addEventListener("change", syncThresholdVisibility);

async function loadAutoCloseSettings() {
  const result = await chrome.storage.local.get(["autoCloseEnabled", "autoCloseDays"]);
  autoCloseCheckbox.checked = !!result.autoCloseEnabled;
  if (result.autoCloseDays) autoCloseDaysInput.value = result.autoCloseDays;
  syncThresholdVisibility();
}

autoCloseSaveBtn.addEventListener("click", async () => {
  const days = parseInt(autoCloseDaysInput.value);
  if (!Number.isFinite(days) || days < 1) {
    showAutoCloseStatus("Enter a number of days (minimum 1).", "error");
    autoCloseDaysInput.focus();
    return;
  }

  await chrome.storage.local.set({
    autoCloseEnabled: autoCloseCheckbox.checked,
    autoCloseDays: days,
  });
  showAutoCloseStatus("Auto-close settings saved.");
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadKey();
loadAutoCloseSettings();