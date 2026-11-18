/**
 * Core module exports
 */

export { Settings, createDefaultSettings } from "./settings.js";
export type { SettingsCache } from "./settings.js";

export { FeedManager, isValidFeed, isUnifiedFeedFormat } from "./feed.js";
export type { FeedData, Merchant, MerchantOffer, CashbackDetail } from "./feed.js";

export {
  findBestOffer,
  parseCashbackRate,
  compareCashbackRates,
} from "./merchant-matching.js";
export type { MatchResult, ParsedCashbackRate } from "./merchant-matching.js";

export { detectAdblock } from "./adblock-detection.js";
