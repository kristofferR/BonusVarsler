/**
 * SpennID handling for the Spenn service.
 * Spenn's click URLs credit purchases to the SpennID in the URL (the 9-digit
 * number at the top of the user's profile in the Spenn app).
 */

export const SPENN_ID_PLACEHOLDER = "{spennId}";

/**
 * Normalize user input to a SpennID, or null when it isn't 9 digits.
 * Mirrors the validation in Spenn's own browser extension.
 */
export function normalizeSpennId(raw: string): string | null {
  const digits = raw.replace(/\s/g, "");
  return /^\d{9}$/.test(digits) && !/^0+$/.test(digits) ? digits : null;
}

export function needsSpennId(url: string): boolean {
  return url.includes(SPENN_ID_PLACEHOLDER);
}

export function fillSpennId(url: string, spennId: string): string {
  return url.replaceAll(SPENN_ID_PLACEHOLDER, encodeURIComponent(spennId));
}
