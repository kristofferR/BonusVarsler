/**
 * Static i18n adapter for userscript
 * Contains hardcoded Norwegian strings
 */

import type { I18nAdapter, Messages } from "./types.js";

/**
 * Norwegian messages for userscript
 */
const NORWEGIAN_MESSAGES: Messages = {
  // Notification
  cashbackAt: { message: "bonus hos $STORE$", placeholders: { store: { content: "$1" } } },
  serviceBonusAt: {
    message: "$SERVICE$-bonus hos $STORE$",
    placeholders: {
      service: { content: "$1" },
      store: { content: "$2" },
    },
  },
  clickToGetBonus: { message: "Få $SERVICE$ bonus", placeholders: { service: { content: "$1" } } },
  getServiceBonus: { message: "Få $SERVICE$-bonus", placeholders: { service: { content: "$1" } } },
  thisStore: { message: "denne butikken" },
  rememberTo: { message: "Husk å:" },
  disableAdblockers: { message: "Deaktivere uBlock/AdGuard Home/Pi-Hole" },
  acceptAllCookies: { message: "Akseptere alle cookies" },
  emptyCart: { message: "Tømme handlevognen" },
  rememberToUse: { message: "Husk å bruke lenken under før du handler!" },
  dontShowOnThisSite: { message: "Ikke vis på denne siden" },
  hideOnThisSite: { message: "Skjul på denne siden" },
  aboutExtension: { message: "Om denne utvidelsen" },
  purchaseRegistered: { message: "Hvis alt ble gjort riktig, skal kjøpet ha blitt registrert." },
  adblockerDetected: { message: "Adblocker funnet!" },
  checkingAdblock: { message: "Sjekker..." },
  checkAdblockAgain: { message: "Sjekk på nytt" },
  adblockWarning: { message: "Adblock oppdaget!" },
  adblockNote: { message: "Du må skru av adblock for at sporingen skal fungere." },

  // DNB code-based
  dnbCodeLabel: { message: "Rabattkode:" },
  dnbInstruction1: { message: "Kopier rabattkoden over" },
  dnbInstruction2: { message: "Gå til handlekurven og skriv inn koden" },
  dnbInstruction3: { message: "Handelen registreres automatisk" },
  codeCopied: { message: "Kopiert!" },
  copyCode: { message: "Kopier kode" },
  copyFailed: { message: "Kopiering feilet" },
  openLink: { message: "Åpne lenke" },

  // Reminder
  importantReminder: { message: "Viktig påminnelse!" },
  reminderMessage: { message: "Husk å deaktivere adblock før du handler. Sporingen kan blokkeres hvis adblock er aktivert." },
  reminderAdblockWarning: { message: "Hvis handelen ikke registreres kan det skyldes adblock." },
  reminderTip: { message: "Tips: Test at lenken fungerer ved å klikke og se at du blir sendt videre." },

  // Settings
  settings: { message: "Innstillinger" },
  appearance: { message: "Utseende" },
  theme: { message: "Tema" },
  themeLight: { message: "Lys" },
  themeDark: { message: "Mørk" },
  themeSystem: { message: "Auto" },
  position: { message: "Posisjon" },
  defaultPosition: { message: "Posisjon" },
  startMinimized: { message: "Start minimert" },
  hiddenSites: { message: "Skjulte sider" },
  noHiddenSites: { message: "Ingen skjulte sider" },
  hiddenSitesCount: { message: "$COUNT$ skjulte sider", placeholders: { count: { content: "$1" } } },
  hiddenSitesCountPlural: {
    message: "$COUNT$ sider skjult",
    placeholders: { count: { content: "$1" } },
  },
  reset: { message: "Nullstill" },
  resetHiddenSites: { message: "Tilbakestill" },
  back: { message: "← Tilbake" },
  services: { message: "Tjenester" },
  selectServices: { message: "Velg bonustjenester" },
  saveServices: { message: "Lagre" },
  comingSoon: { message: "(kommer snart)" },

  // Aria labels
  ariaNotificationLabel: { message: "Bonusvarsel" },
  ariaReminderLabel: { message: "Påminnelse" },
  ariaClose: { message: "Lukk" },
  ariaMinimize: { message: "Minimer" },

  // Confirmation
  siteHidden: { message: "Varsler skjult for $SITE$", placeholders: { site: { content: "$1" } } },
};

export class StaticI18n implements I18nAdapter {
  private messages: Messages = NORWEGIAN_MESSAGES;

  async loadMessages(_lang: string): Promise<void> {
    // No-op for static i18n, always uses Norwegian
  }

  getMessage(key: string, substitutions?: string | string[]): string {
    const entry = this.messages[key];
    if (!entry || !entry.message) {
      return key;
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
}

// Singleton instance
let instance: StaticI18n | null = null;

export function getStaticI18n(): StaticI18n {
  if (!instance) {
    instance = new StaticI18n();
  }
  return instance;
}
