// WhyTab — popup.js
// Reads from chrome.storage.local, cross-references with live tabs, renders UI.

const STALE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// ─── Time formatting ─────────────────────────────────────────────────────────

function timeAgo(ts) {
  const diff  = Date.now() - ts;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins < 1)   return "just now";
  if (mins < 60)  return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function isStale(ts) {
  return Date.now() - ts >= STALE_MS;
}

// ─── Favicon helpers ─────────────────────────────────────────────────────────

function faviconEl(tab) {
  if (tab.favIconUrl && tab.favIconUrl.startsWith("http")) {
    const img = document.createElement("img");
    img.className = "tab-favicon";
    img.src = tab.favIconUrl;
    img.alt = "";
    img.width = 16;
    img.height = 16;
    img.onerror = () => {
      img.replaceWith(placeholderFavicon(tab.title));
    };
    return img;
  }
  return placeholderFavicon(tab.title);
}

function placeholderFavicon(title) {
  const div = document.createElement("div");
  div.className = "tab-favicon-placeholder";
  div.textContent = (title || "?").charAt(0).toUpperCase();
  return div;
}

function stripProtocol(url) {
  try {
    const u = new URL(url);
    return u.hostname + (u.pathname !== "/" ? u.pathname : "");
  } catch {
    return url;
  }
}

// ─── Intent pill builder ──────────────────────────────────────────────────────

function makeIntentPill(text, isAi = false) {
  const pill = document.createElement("div");
  pill.className = "intent-pill" + (isAi ? " intent-pill--ai" : "");

  const pillMark = document.createElement("span");
  pillMark.className = "intent-pill-mark";
  pillMark.textContent = isAi ? "✦" : "⌬";

  const pillText = document.createElement("span");
  pillText.className = "intent-pill-text";
  pillText.textContent = text;

  pill.appendChild(pillMark);
  pill.appendChild(pillText);

  if (isAi) {
    const aiLabel = document.createElement("span");
    aiLabel.className = "intent-pill-ai-label";
    aiLabel.textContent = "ai";
    pill.appendChild(aiLabel);
  }

  return pill;
}

// ─── Render a single tab row ──────────────────────────────────────────────────

function renderTabItem(tabRecord, animDelay = 0) {
  const stale = isStale(tabRecord.lastVisited);

  const item = document.createElement("div");
  item.className = "tab-item" + (stale ? " stale" : "");
  item.style.animationDelay = `${animDelay}ms`;
  item.title = tabRecord.url;

  // Click to switch to tab
  item.addEventListener("click", () => {
    chrome.tabs.update(tabRecord.id, { active: true });
    chrome.windows.update(tabRecord.windowId || chrome.windows.WINDOW_ID_CURRENT, { focused: true });
    window.close();
  });

  // Favicon
  const faviconWrap = document.createElement("div");
  faviconWrap.style.display = "flex";
  faviconWrap.style.justifyContent = "center";
  faviconWrap.appendChild(faviconEl(tabRecord));

  // Info
  const info = document.createElement("div");
  info.className = "tab-info";

  const title = document.createElement("div");
  title.className = "tab-title";
  title.textContent = tabRecord.title || "Untitled";

  const url = document.createElement("div");
  url.className = "tab-url";
  url.textContent = stripProtocol(tabRecord.url);

  info.appendChild(title);
  info.appendChild(url);

  // ── Phase 2: user intent pill ────────────────────────────────────────────
  if (tabRecord.userIntent) {
    info.appendChild(makeIntentPill(tabRecord.userIntent, false));
  }
  // ── Phase 3: AI intent pill (only shown if no user intent) ───────────────
  else if (tabRecord.aiIntent) {
    info.appendChild(makeIntentPill(tabRecord.aiIntent, true));
  }

  // Age
  const age = document.createElement("div");
  age.className = "tab-age";
  age.textContent = timeAgo(tabRecord.lastVisited);

  item.appendChild(faviconWrap);
  item.appendChild(info);
  item.appendChild(age);

  return item;
}

// ─── Main render ─────────────────────────────────────────────────────────────

let allTabs = [];
let currentFilter = "all";

function applyFilter(tabs, filter) {
  if (filter === "stale")  return tabs.filter(t => isStale(t.lastVisited));
  if (filter === "recent") return tabs.filter(t => !isStale(t.lastVisited));
  return tabs;
}

// Hide the loading spinner once on startup, before any render wipes innerHTML
const loadingEl = document.getElementById("loadingState");
if (loadingEl) loadingEl.classList.add("hidden");

function render() {
  const list  = document.getElementById("tabList");
  const empty = document.getElementById("emptyState");

  const filtered = applyFilter(allTabs, currentFilter);

  list.innerHTML = "";
  empty.classList.add("hidden");

  if (filtered.length === 0) {
    empty.classList.remove("hidden");
    return;
  }

  // Sort: stale first, then by lastVisited ascending (oldest first within each group)
  filtered.sort((a, b) => {
    const aStale = isStale(a.lastVisited);
    const bStale = isStale(b.lastVisited);
    if (aStale !== bStale) return bStale ? 1 : -1;
    return a.lastVisited - b.lastVisited;
  });

  filtered.forEach((tab, i) => {
    list.appendChild(renderTabItem(tab, i * 18));
  });
}

function updateCounts() {
  const stale = allTabs.filter(t => isStale(t.lastVisited));
  const badge = document.getElementById("staleBadge");
  document.getElementById("staleCount").textContent = stale.length;
  document.getElementById("totalCount").textContent = allTabs.length;
  badge.dataset.count = stale.length;
}

// ─── Load data ───────────────────────────────────────────────────────────────

async function init() {
  // Get live tab IDs so we can filter out closed tabs storage may still hold
  const liveTabs = await chrome.tabs.query({});
  const liveIds  = new Set(liveTabs.map(t => t.id));

  // Build a quick lookup for window IDs
  const liveMap = {};
  liveTabs.forEach(t => { liveMap[t.id] = t; });

  const result = await chrome.storage.local.get("tabData");
  const tabData = result.tabData || {};

  // Merge: only include tabs that are currently open
  allTabs = Object.values(tabData)
    .filter(t => liveIds.has(t.id))
    .map(t => ({
      ...t,
      // Enrich with live window info for focus-switching
      windowId: liveMap[t.id]?.windowId ?? undefined,
      // If title/favicon is stale in storage, prefer the live tab's values
      title: liveMap[t.id]?.title || t.title,
      favIconUrl: liveMap[t.id]?.favIconUrl || t.favIconUrl,
    }));

  updateCounts();
  render();
}

// ─── Filter buttons ───────────────────────────────────────────────────────────

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentFilter = btn.dataset.filter;
    render();
  });
});

// ─── Settings link ────────────────────────────────────────────────────────────

document.getElementById("settingsBtn")?.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

init();