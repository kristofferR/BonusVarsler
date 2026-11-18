/**
 * Static i18n adapter for userscript
 * Always Norwegian: the extension's Norwegian locale file, inlined at build time
 */

import type { I18nAdapter, Messages } from "./types.js";
import norwegianMessages from "../../_locales/no/messages.json";

export class StaticI18n implements I18nAdapter {
  private messages: Messages = norwegianMessages;

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
