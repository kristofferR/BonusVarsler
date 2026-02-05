// BonusVarsler - Background Service Worker
// Handles cross-origin requests to bypass CORS restrictions

const browser = globalThis.browser || globalThis.chrome;

const CONFIG = {
  // Primary: GitHub-hosted unified feed with multi-service support
  feedUrl:
    "https://raw.githubusercontent.com/kristofferR/BonusVarsler/main/sitelist.json",
  // Fallback: Trumf-only CDN feed (legacy, no re:member data)
  fallbackUrl: "https://wlp.tcb-cdn.com/trumf/notifierfeed.json",
  maxRetries: 5,
  retryDelays: [100, 500, 1000, 2000, 4000],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidFeed(feed) {
  return feed && typeof feed.merchants === "object" && feed.merchants !== null;
}

async function fetchFeedWithRetry(url, retries = CONFIG.maxRetries) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "application/json",
          "Cache-Control": "no-cache",
        },
      });
      if (response.ok) {
        const feed = await response.json();
        if (isValidFeed(feed)) {
          return feed;
        }
      }
    } catch {
      // Network error
    }
    if (attempt < retries - 1) {
      await sleep(CONFIG.retryDelays[attempt] || 4000);
    }
  }
  return null;
}

async function fetchBundledFallback() {
  try {
    const url = browser.runtime.getURL("data/sitelist.json");
    const response = await fetch(url);
    if (response.ok) {
      const feed = await response.json();
      if (isValidFeed(feed)) {
        return feed;
      }
    }
  } catch {
    // Bundled file not available
  }
  return null;
}

async function getFeed() {
  // Try primary feed (GitHub)
  let feed = await fetchFeedWithRetry(CONFIG.feedUrl);
  if (feed) {
    return feed;
  }

  // Try fallback (Trumf CDN - legacy, Trumf-only)
  feed = await fetchFeedWithRetry(CONFIG.fallbackUrl, 2);
  if (feed) {
    return feed;
  }

  // Last resort: bundled feed packaged with the extension
  return fetchBundledFallback();
}

// Handle messages from content script
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "fetchFeed") {
    getFeed().then((feed) => {
      sendResponse({ feed });
    });
    return true; // Keep the message channel open for async response
  }
});

// Handle extension icon click - open options page
browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

// Handle extension installation
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    console.log("BonusVarsler installed");
  } else if (details.reason === "update") {
    console.log(
      "BonusVarsler updated to version",
      browser.runtime.getManifest().version,
    );
  }
});
