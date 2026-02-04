// BonusVarsler - Options Page

const browser = globalThis.browser || globalThis.chrome;

// Fallback service definitions - canonical source is loaded from feed cache
// These are used when feed is not yet cached.
const SERVICES_FALLBACK = {
  trumf: {
    id: "trumf",
    name: "Trumf",
    color: "#4D4DFF",
    defaultEnabled: true,
  },
  remember: {
    id: "remember",
    name: "re:member",
    color: "#f28d00",
    defaultEnabled: false,
  },
  dnb: {
    id: "dnb",
    name: "DNB",
    color: "#007272",
    defaultEnabled: false,
  },
  obos: {
    id: "obos",
    name: "OBOS",
    color: "#0047ba",
    comingSoon: true,
  },
  naf: {
    id: "naf",
    name: "NAF",
    color: "#ffd816",
    comingSoon: true,
  },
  lofavor: {
    id: "lofavor",
    name: "LOfavør",
    color: "#ff0000",
    comingSoon: true,
  },
};

// Will be populated from feed cache or fallback
let SERVICES = { ...SERVICES_FALLBACK };

// Storage keys
const KEYS = {
  hiddenSites: "BonusVarsler_HiddenSites",
  blacklistedSites: "BonusVarsler_BlacklistedSites",
  theme: "BonusVarsler_Theme",
  startMinimized: "BonusVarsler_StartMinimized",
  position: "BonusVarsler_Position",
  sitePositions: "BonusVarsler_SitePositions",
  feedData: "BonusVarsler_FeedData_v1",
  feedTime: "BonusVarsler_FeedTime_v1",
  hostIndex: "BonusVarsler_HostIndex_v1",
  language: "BonusVarsler_Language",
  enabledServices: "BonusVarsler_EnabledServices",
};

// Messages cache
let messages = {};
let currentLang = "no";

// Load messages for a specific language
async function loadMessages(lang) {
  try {
    const url = browser.runtime.getURL(`_locales/${lang}/messages.json`);
    const response = await fetch(url);
    return await response.json();
  } catch {
    return {};
  }
}

// i18n helper with placeholder support
function i18n(messageName, substitutions) {
  const entry = messages[messageName];
  if (!entry || !entry.message) {
    return messageName;
  }

  let msg = entry.message;

  // Handle substitutions
  if (substitutions !== undefined) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    subs.forEach((sub, index) => {
      const placeholder = `$${index + 1}`;
      msg = msg.replace(placeholder, sub);
      // Also handle named placeholders
      if (entry.placeholders) {
        for (const [name, config] of Object.entries(entry.placeholders)) {
          if (config.content === placeholder) {
            msg = msg.replace(new RegExp(`\\$${name.toUpperCase()}\\$`, "g"), sub);
          }
        }
      }
    });
  }

  return msg;
}

// Translate all elements with data-i18n attributes
function translatePage() {
  // Translate text content
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const message = i18n(key);
    if (message && message !== key) {
      el.textContent = message;
    }
  });

  // Translate titles
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    const message = i18n(key);
    if (message && message !== key) {
      el.title = message;
    }
  });

  // Translate aria-labels
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => {
    const key = el.getAttribute("data-i18n-aria");
    const message = i18n(key);
    if (message && message !== key) {
      el.setAttribute("aria-label", message);
    }
  });

  // Translate placeholders
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    const key = el.getAttribute("data-i18n-placeholder");
    const message = i18n(key);
    if (message && message !== key) {
      el.placeholder = message;
    }
  });

  // Update page title
  document.title = i18n("optionsTitle");
}

// Get value from storage
async function getValue(key, defaultValue) {
  try {
    const result = await browser.storage.local.get(key);
    return result[key] !== undefined ? result[key] : defaultValue;
  } catch {
    return defaultValue;
  }
}

// Set value in storage
async function setValue(key, value) {
  try {
    await browser.storage.local.set({ [key]: value });
  } catch {
    console.error("Failed to save setting:", key);
  }
}

// Show status message
function showStatus(message) {
  let statusEl = document.querySelector(".status-message");
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.className = "status-message";
    document.body.appendChild(statusEl);
  }
  statusEl.textContent = message;
  statusEl.classList.add("visible");
  setTimeout(() => {
    statusEl.classList.remove("visible");
  }, 2000);
}

// Initialize language buttons
async function initLanguage() {
  const buttons = document.querySelectorAll("#language-buttons .theme-btn");

  buttons.forEach((btn) => {
    if (btn.dataset.lang === currentLang) {
      btn.classList.add("active");
    }

    btn.addEventListener("click", async () => {
      const newLang = btn.dataset.lang;
      if (newLang === currentLang) return;

      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      await setValue(KEYS.language, newLang);
      currentLang = newLang;
      messages = await loadMessages(newLang);
      translatePage();
      showStatus(i18n("languageSaved"));
    });
  });
}

// Initialize theme buttons
async function initTheme() {
  const currentTheme = await getValue(KEYS.theme, "light");
  const buttons = document.querySelectorAll("#theme-buttons .theme-btn");

  buttons.forEach((btn) => {
    if (btn.dataset.theme === currentTheme) {
      btn.classList.add("active");
    }

    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      await setValue(KEYS.theme, btn.dataset.theme);
      showStatus(i18n("themeSaved"));
    });
  });
}

// Initialize start minimized toggle
async function initStartMinimized() {
  const startMinimized = await getValue(KEYS.startMinimized, false);
  const toggle = document.getElementById("start-minimized");

  if (startMinimized) {
    toggle.classList.add("active");
  }

  toggle.addEventListener("click", async () => {
    const isActive = toggle.classList.toggle("active");
    await setValue(KEYS.startMinimized, isActive);
    showStatus(isActive ? i18n("startMinimizedEnabled") : i18n("startMinimizedDisabled"));
  });
}

// Initialize position buttons
async function initPosition() {
  const currentPosition = await getValue(KEYS.position, "bottom-right");
  const buttons = document.querySelectorAll("#position-buttons .position-btn");

  buttons.forEach((btn) => {
    if (btn.dataset.position === currentPosition) {
      btn.classList.add("active");
    }

    btn.addEventListener("click", async () => {
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      await setValue(KEYS.position, btn.dataset.position);
      showStatus(i18n("positionSaved"));
    });
  });
}

// Initialize hidden sites
async function initHiddenSites() {
  const hiddenSites = await getValue(KEYS.hiddenSites, []);
  const container = document.getElementById("hidden-sites-container");
  const list = document.getElementById("hidden-sites-list");
  const actions = document.getElementById("hidden-sites-actions");

  function render() {
    list.innerHTML = "";

    if (hiddenSites.length === 0) {
      container.style.display = "block";
      actions.style.display = "none";
      return;
    }

    container.style.display = "none";
    actions.style.display = "block";

    hiddenSites.forEach((site, index) => {
      const item = document.createElement("div");
      item.className = "hidden-site-item";

      const name = document.createElement("span");
      name.className = "hidden-site-name";
      name.textContent = site;

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-site-btn";
      removeBtn.textContent = "×";
      removeBtn.title = i18n("remove");
      removeBtn.addEventListener("click", async () => {
        hiddenSites.splice(index, 1);
        await setValue(KEYS.hiddenSites, hiddenSites);
        render();
        showStatus(i18n("siteRemoved", site));
      });

      item.appendChild(name);
      item.appendChild(removeBtn);
      list.appendChild(item);
    });
  }

  render();

  // Reset all hidden sites
  document.getElementById("reset-hidden-sites").addEventListener("click", async () => {
    if (confirm(i18n("confirmResetHiddenSites"))) {
      hiddenSites.length = 0;
      await setValue(KEYS.hiddenSites, []);
      render();
      showStatus(i18n("allHiddenSitesRemoved"));
    }
  });
}

// Initialize blacklisted sites
async function initBlacklistedSites() {
  const storedBlacklist = await getValue(KEYS.blacklistedSites, []);
  const blacklistedSites = Array.isArray(storedBlacklist) ? storedBlacklist : [];
  const container = document.getElementById("blacklist-container");
  const list = document.getElementById("blacklist-list");
  const actions = document.getElementById("blacklist-actions");
  const input = document.getElementById("blacklist-input");
  const addBtn = document.getElementById("blacklist-add-btn");

  function normalizeHost(host) {
    let normalized = String(host).trim().toLowerCase();
    normalized = normalized.replace(/^https?:\/\//, "");
    normalized = normalized.split("/")[0].split("?")[0].split("#")[0];
    normalized = normalized.split(":")[0];
    if (normalized.startsWith("www.")) {
      normalized = normalized.slice(4);
    }
    normalized = normalized.replace(/^\.+|\.+$/g, "");
    return normalized;
  }

  // Normalize and deduplicate stored values to keep matching consistent
  const normalizedStored = Array.from(
    new Set(
      blacklistedSites
        .map((site) => normalizeHost(site))
        .filter(Boolean)
    )
  );
  if (
    normalizedStored.length !== blacklistedSites.length ||
    normalizedStored.some((site, index) => site !== blacklistedSites[index])
  ) {
    blacklistedSites.length = 0;
    blacklistedSites.push(...normalizedStored);
    await setValue(KEYS.blacklistedSites, blacklistedSites);
  }

  function render() {
    list.innerHTML = "";

    if (blacklistedSites.length === 0) {
      container.style.display = "block";
      actions.style.display = "none";
      return;
    }

    container.style.display = "none";
    actions.style.display = "block";

    blacklistedSites.forEach((site, index) => {
      const item = document.createElement("div");
      item.className = "blacklist-item";

      const name = document.createElement("span");
      name.className = "blacklist-name";
      name.textContent = site;

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-site-btn";
      removeBtn.textContent = "×";
      removeBtn.title = i18n("remove");
      removeBtn.addEventListener("click", async () => {
        blacklistedSites.splice(index, 1);
        await setValue(KEYS.blacklistedSites, blacklistedSites);
        render();
        showStatus(i18n("siteUnblacklisted", site));
      });

      item.appendChild(name);
      item.appendChild(removeBtn);
      list.appendChild(item);
    });
  }

  render();

  // Add site to blacklist
  async function addSite() {
    const normalized = normalizeHost(input.value);

    // Basic validation - must look like a domain
    if (!normalized || normalized.includes(" ")) {
      showStatus(i18n("invalidDomain"));
      return;
    }

    if (blacklistedSites.includes(normalized)) {
      showStatus(i18n("siteAlreadyBlacklisted"));
      return;
    }

    blacklistedSites.push(normalized);
    await setValue(KEYS.blacklistedSites, blacklistedSites);
    input.value = "";
    render();
    showStatus(i18n("siteBlacklisted", normalized));
  }

  addBtn.addEventListener("click", addSite);
  input.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      addSite();
    }
  });

  // Reset all blacklisted sites
  document.getElementById("reset-blacklist").addEventListener("click", async () => {
    if (confirm(i18n("confirmResetBlacklist"))) {
      blacklistedSites.length = 0;
      await setValue(KEYS.blacklistedSites, []);
      render();
      showStatus(i18n("allBlacklistedSitesRemoved"));
    }
  });
}

// Initialize services checkboxes
async function initServices() {
  const container = document.getElementById("services-list");
  if (!container) return;

  // Get default enabled services
  const defaultEnabled = Object.values(SERVICES)
    .filter((s) => s.defaultEnabled)
    .map((s) => s.id);

  // Load enabled services from storage
  let enabledServices = await getValue(KEYS.enabledServices, null);
  if (!enabledServices) {
    enabledServices = defaultEnabled;
  }

  // Service order: active services first, then coming soon
  const serviceOrder = ["trumf", "remember", "dnb", "obos", "naf", "lofavor"];

  // Create checkbox for each service
  serviceOrder.forEach((serviceId) => {
    const service = SERVICES[serviceId];
    if (!service) return;

    const row = document.createElement("div");
    row.className = "service-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `service-${service.id}`;
    checkbox.checked = enabledServices.includes(service.id);

    const label = document.createElement("label");
    label.htmlFor = `service-${service.id}`;
    label.className = "service-label";

    const colorDot = document.createElement("span");
    colorDot.className = "service-color";
    colorDot.style.backgroundColor = service.color;

    const nameSpan = document.createElement("span");
    nameSpan.className = "service-name";
    nameSpan.textContent = service.name;

    label.appendChild(colorDot);
    label.appendChild(nameSpan);

    // Add "coming soon" text for placeholder services
    if (service.comingSoon) {
      const comingSoon = document.createElement("span");
      comingSoon.className = "coming-soon";
      comingSoon.textContent = i18n("comingSoon");
      label.appendChild(comingSoon);
    }

    row.appendChild(checkbox);
    row.appendChild(label);
    container.appendChild(row);

    // Handle checkbox change
    checkbox.addEventListener("change", async () => {
      const checkboxes = container.querySelectorAll('input[type="checkbox"]');
      // Count only active (non-coming-soon) services
      const checkedActiveCount = Array.from(checkboxes).filter((cb) => {
        const serviceId = cb.id.replace("service-", "");
        const service = SERVICES[serviceId];
        return cb.checked && service && !service.comingSoon;
      }).length;

      // Prevent disabling all active services
      if (checkedActiveCount === 0) {
        checkbox.checked = true;
        showStatus(i18n("cannotDisableAllServices"));
        return;
      }

      // Update enabled services
      const newEnabled = Array.from(checkboxes)
        .filter((cb) => cb.checked)
        .map((cb) => cb.id.replace("service-", ""));

      await setValue(KEYS.enabledServices, newEnabled);
      showStatus(i18n("servicesSaved"));
    });
  });
}

// Initialize clear cache
function initClearCache() {
  document.getElementById("clear-cache").addEventListener("click", async () => {
    await setValue(KEYS.feedData, null);
    await setValue(KEYS.feedTime, null);
    await setValue(KEYS.hostIndex, null);
    showStatus(i18n("cacheCleared"));
  });
}

// Initialize version display
function initVersion() {
  const manifest = browser.runtime.getManifest();
  document.querySelector(".version").textContent = `v${manifest.version}`;
}

// Load services from feed cache (canonical source)
async function loadServicesFromFeed() {
  try {
    const feedData = await getValue(KEYS.feedData, null);
    if (feedData?.services && typeof feedData.services === "object") {
      // Merge feed services with fallback (feed overrides, but missing fields preserved)
      for (const [id, service] of Object.entries(feedData.services)) {
        const fallback = SERVICES[id] || {};
        SERVICES[id] = { ...fallback, ...service, id };
      }
    }
  } catch {
    // Use fallback services
  }
}

// Initialize everything
document.addEventListener("DOMContentLoaded", async () => {
  // Load language preference and messages first
  currentLang = await getValue(KEYS.language, "no");
  messages = await loadMessages(currentLang);

  // Load services from feed cache (canonical source)
  await loadServicesFromFeed();

  translatePage();
  initVersion();
  initLanguage();
  initTheme();
  initStartMinimized();
  initPosition();
  initServices();
  initHiddenSites();
  initBlacklistedSites();
  initClearCache();
});
