// WhyTab — options.js
// Manages the Anthropic API key stored in chrome.storage.local.

const input       = document.getElementById("apiKeyInput");
const saveBtn     = document.getElementById("saveBtn");
const clearBtn    = document.getElementById("clearBtn");
const toggleBtn   = document.getElementById("toggleVisibility");
const eyeIcon     = document.getElementById("eyeIcon");
const statusEl    = document.getElementById("status");

// ─── Load saved key on open ───────────────────────────────────────────────────

async function loadKey() {
  const result = await chrome.storage.local.get("anthropicApiKey");
  if (result.anthropicApiKey) {
    input.value = result.anthropicApiKey;
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

  if (!key.startsWith("sk-ant-")) {
    showStatus("That doesn't look like a valid Anthropic key.", "error");
    return;
  }

  await chrome.storage.local.set({ anthropicApiKey: key });
  showStatus("API key saved.");
});

// ─── Clear ────────────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  await chrome.storage.local.remove("anthropicApiKey");
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

// ─── Boot ─────────────────────────────────────────────────────────────────────

loadKey();
