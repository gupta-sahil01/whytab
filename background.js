// WhyTab — background service worker (Manifest V3)
// Tracks tab open time, last activation, and fires hourly stale-tab checks.
// Phase 2: captures opening intent via injected content script.
// Phase 3: AI-powered intent inference via Anthropic API.

const ALARM_NAME = "whytab-stale-check";
const STALE_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

// URL schemes where content scripts cannot run
const SKIP_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
  "data:",
  "javascript:",
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function getTabData() {
  const result = await chrome.storage.local.get("tabData");
  return result.tabData || {};
}

async function saveTabData(tabData) {
  await chrome.storage.local.set({ tabData });
}

function shouldSkipUrl(url) {
  if (!url) return true;
  return SKIP_PREFIXES.some((p) => url.startsWith(p));
}

// ─── Tab lifecycle ───────────────────────────────────────────────────────────

// Record a newly created tab
async function onTabCreated(tab) {
  const tabData = await getTabData();
  if (tabData[tab.id]) return; // already tracked, don't overwrite openedAt
  const now = Date.now();

  tabData[tab.id] = {
    id: tab.id,
    url: tab.url || "",
    title: tab.title || "New Tab",
    openedAt: now,
    lastVisited: now,
    favIconUrl: tab.favIconUrl || "",
    userIntent: null,
    aiIntent: null,
  };

  await saveTabData(tabData);
}

// ─── Phase 2: prompt tracking (per tab, per origin) ──────────────────────────

function getOrigin(url) {
  try {
    return new URL(url).origin; // e.g. "https://www.linkedin.com"
  } catch {
    return url;
  }
}

async function hasBeenPromptedForOrigin(tabId, url) {
  const result = await chrome.storage.local.get("promptedTabs");
  const prompted = result.promptedTabs || {};
  return prompted[tabId] === getOrigin(url);
}

async function markAsPrompted(tabId, url) {
  const result = await chrome.storage.local.get("promptedTabs");
  const prompted = result.promptedTabs || {};
  prompted[tabId] = getOrigin(url);
  await chrome.storage.local.set({ promptedTabs: prompted });
}

// ─── Phase 3: AI intent inference ────────────────────────────────────────────

async function inferIntent(tabId, title, url) {
  // Don't infer if user has already provided intent
  const tabData = await getTabData();
  if (tabData[tabId]?.userIntent || tabData[tabId]?.aiIntent) return;

  const stored = await chrome.storage.local.get("anthropicApiKey");
  const apiKey = stored.anthropicApiKey;
  if (!apiKey) return; // no key configured, skip silently

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 30,
        messages: [
          {
            role: "user",
            content: `A user opened a browser tab with this title and URL. In 8 words or fewer, write a short phrase describing why they likely opened it. No punctuation. No preamble. Just the phrase.

Title: ${title}
URL: ${url}`,
          },
        ],
      }),
    });

    if (!response.ok) return;

    const data = await response.json();
    const raw = data?.content?.[0]?.text?.trim();
    if (!raw) return;

    // Sanitise: strip quotes, punctuation at start/end, limit length
    const aiIntent = raw.replace(/^["']|["']$/g, "").replace(/\.$/, "").trim();
    if (!aiIntent) return;

    // Re-fetch in case state changed while we were awaiting
    const freshTabData = await getTabData();
    if (!freshTabData[tabId]) return; // tab was closed
    if (freshTabData[tabId].userIntent) return; // user answered in the meantime

    freshTabData[tabId].aiIntent = aiIntent;
    await saveTabData(freshTabData);
  } catch (err) {
    // Network errors, parse errors — fail silently
    console.warn("WhyTab: AI inference failed:", err.message);
  }
}

// ─── Tab updated ─────────────────────────────────────────────────────────────

// Update metadata when a tab's URL/title/favicon changes, OR when it finishes
// loading (Phase 2 + 3 injection point).
async function onTabUpdated(tabId, changeInfo, tab) {
  // ── Phase 2: inject bubble when page finishes loading ───────────────────
  if (changeInfo.status === "complete") {
    const url = tab.url || "";
    if (!shouldSkipUrl(url) && !(await hasBeenPromptedForOrigin(tabId, url))) {
      await markAsPrompted(tabId, url);

      const tabData = await getTabData();
      if (!tabData[tabId]?.userIntent) {
        try {
          await Promise.all([
            chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] }),
            chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }),
          ]);
        } catch (err) {
          console.warn(`WhyTab: could not inject into tab ${tabId}:`, err.message);
        }

        // ── Phase 3: schedule AI inference after bubble window closes ──────
        // We wait AI_INFERENCE_DELAY_MS to give the user a chance to respond.
        // The inferIntent function checks userIntent again before calling the API.
        inferIntent(tabId, tab.title || "", url);
      }
    }
  }

  // ── Existing Phase 1: update stored metadata ─────────────────────────────
  if (!changeInfo.url && !changeInfo.title && !changeInfo.favIconUrl) return;

  const tabData = await getTabData();
  if (!tabData[tabId]) {
    // Tab was opened before the extension was installed — backfill it
    const now = Date.now();
    tabData[tabId] = {
      id: tabId,
      url: tab.url || "",
      title: tab.title || "Loading…",
      openedAt: now,
      lastVisited: now,
      favIconUrl: tab.favIconUrl || "",
      userIntent: null,
      aiIntent: null,
    };
  }

  if (changeInfo.url)        tabData[tabId].url        = changeInfo.url;
  if (changeInfo.title)      tabData[tabId].title      = changeInfo.title;
  if (changeInfo.favIconUrl) tabData[tabId].favIconUrl = changeInfo.favIconUrl;

  await saveTabData(tabData);
}

// Update lastVisited when the user switches to a tab
async function onTabActivated(activeInfo) {
  const tabData = await getTabData();
  const { tabId } = activeInfo;

  if (!tabData[tabId]) {
    // Fetch live tab info for tabs opened before extension was active
    try {
      const tab = await chrome.tabs.get(tabId);
      const now = Date.now();
      tabData[tabId] = {
        id: tabId,
        url: tab.url || "",
        title: tab.title || "Unknown",
        openedAt: now,
        lastVisited: now,
        favIconUrl: tab.favIconUrl || "",
        userIntent: null,
        aiIntent: null,
      };
    } catch (_) {
      return; // Tab may have already closed
    }
  } else {
    tabData[tabId].lastVisited = Date.now();
  }

  await saveTabData(tabData);
}

// Remove tab record when the tab is closed
async function onTabRemoved(tabId) {
  const tabData = await getTabData();
  delete tabData[tabId];
  await saveTabData(tabData);

  const result = await chrome.storage.local.get("promptedTabs");
  const prompted = result.promptedTabs || {};
  delete prompted[tabId];
  await chrome.storage.local.set({ promptedTabs: prompted });
}

// ─── Phase 2: receive intent from content script ─────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "WHYTAB_SAVE_INTENT") return false;
  if (!sender.tab?.id) return false;

  const tabId  = sender.tab.id;
  const intent = (message.intent || "").trim();
  if (!intent) { sendResponse({ ok: false }); return false; }

  // Async save — return true to keep channel open
  (async () => {
    const tabData = await getTabData();
    if (tabData[tabId]) {
      tabData[tabId].userIntent = intent;
      // Clear any AI intent now that the user has provided their own
      tabData[tabId].aiIntent = null;
      await saveTabData(tabData);
    }
    sendResponse({ ok: true });
  })();

  return true; // keep message channel open for async response
});

// ─── Stale tab alarm ─────────────────────────────────────────────────────────

async function checkStaleTabs() {
  const tabData = await getTabData();
  const now = Date.now();
  const stale = Object.values(tabData).filter(
    (t) => now - t.lastVisited >= STALE_THRESHOLD_MS
  );

  if (stale.length > 0) {
    await chrome.storage.local.set({ staleCount: stale.length });
  } else {
    await chrome.storage.local.set({ staleCount: 0 });
  }
}

// ─── Startup: backfill tabs already open ─────────────────────────────────────

async function backfillExistingTabs() {
  const tabs = await chrome.tabs.query({});
  const tabData = await getTabData();
  const now = Date.now();
  let changed = false;

  for (const tab of tabs) {
    if (!tabData[tab.id]) {
      tabData[tab.id] = {
        id: tab.id,
        url: tab.url || "",
        title: tab.title || "Unknown",
        openedAt: now,
        lastVisited: now,
        favIconUrl: tab.favIconUrl || "",
        userIntent: null,
        aiIntent: null,
      };
      changed = true;
    }
  }

  if (changed) await saveTabData(tabData);
}

// ─── Event listeners ─────────────────────────────────────────────────────────

chrome.tabs.onCreated.addListener(onTabCreated);
chrome.tabs.onUpdated.addListener(onTabUpdated);
chrome.tabs.onActivated.addListener(onTabActivated);
chrome.tabs.onRemoved.addListener(onTabRemoved);

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkStaleTabs();
  }
});

// On service worker startup
chrome.runtime.onStartup.addListener(async () => {
  await backfillExistingTabs();
  await checkStaleTabs();
});

chrome.runtime.onInstalled.addListener(async () => {
  await backfillExistingTabs();
  await checkStaleTabs();

  // Create alarm: fire every 60 minutes
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
});
