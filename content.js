// WhyTab — content.js
// Injected into new tabs to capture the user's opening intent.
// Styles are fully scoped to #whytab-* to avoid polluting the host page.

(function () {
  "use strict";

  // Guard: don't inject twice in the same page
  if (document.getElementById("whytab-bubble")) return;

  // ── DOM ──────────────────────────────────────────────────────────────────

  const bubble = document.createElement("div");
  bubble.id = "whytab-bubble";
  bubble.setAttribute("role", "dialog");
  bubble.setAttribute("aria-label", "WhyTab — why did you open this tab?");

  // Header
  const header = document.createElement("div");
  header.id = "whytab-header";

  const mark = document.createElement("span");
  mark.id = "whytab-mark";
  mark.textContent = "⌬"; // matches the popup logo-mark

  const headerText = document.createElement("span");
  headerText.id = "whytab-header-text";
  headerText.textContent = "Why this tab?";

  const closeBtn = document.createElement("button");
  closeBtn.id = "whytab-close";
  closeBtn.setAttribute("aria-label", "Dismiss");
  closeBtn.textContent = "✕";

  header.appendChild(mark);
  header.appendChild(headerText);
  header.appendChild(closeBtn);

  // Body
  const body = document.createElement("div");
  body.id = "whytab-body";

  const input = document.createElement("input");
  input.id = "whytab-input";
  input.type = "text";
  input.placeholder = "e.g. Check flight prices…";
  input.maxLength = 120;
  input.autocomplete = "off";
  input.spellcheck = true;

  const saveBtn = document.createElement("button");
  saveBtn.id = "whytab-save";
  saveBtn.textContent = "Save";

  body.appendChild(input);
  body.appendChild(saveBtn);

  // Timer bar
  const timerBar = document.createElement("div");
  timerBar.id = "whytab-timer-bar";

  const timerFill = document.createElement("div");
  timerFill.id = "whytab-timer-fill";
  timerBar.appendChild(timerFill);

  bubble.appendChild(header);
  bubble.appendChild(body);
  bubble.appendChild(timerBar);

  document.body.appendChild(bubble);

  // ── Animate in ───────────────────────────────────────────────────────────

  requestAnimationFrame(() => requestAnimationFrame(() => bubble.classList.add("wt-in")));

  // ── Auto-dismiss ─────────────────────────────────────────────────────────

  let dismissTimer = setTimeout(dismiss, 10_000);

  function dismiss() {
    clearTimeout(dismissTimer);
    bubble.classList.add("wt-out");
    setTimeout(() => {
      bubble.remove();
    }, 200);
  }

  function saveIntent() {
    const intent = input.value.trim();
    if (!intent) {
      input.focus();
      // Brief shake feedback
      input.style.borderColor = "#f59e0b";
      setTimeout(() => { input.style.borderColor = ""; }, 600);
      return;
    }

    chrome.runtime.sendMessage({ type: "WHYTAB_SAVE_INTENT", intent }, () => {
      dismiss();
    });
  }

  // ── Events ───────────────────────────────────────────────────────────────

  closeBtn.addEventListener("click", dismiss);
  saveBtn.addEventListener("click", saveIntent);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter")  { e.preventDefault(); saveIntent(); }
  });

    document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { dismiss(); }
  });

  // Pause the countdown once the user engages with the input
  input.addEventListener("focus", () => {
    clearTimeout(dismissTimer);
    timerFill.classList.add("wt-paused");
  });

})();