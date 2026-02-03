/**
 * Merchant matching
 * Find merchants by host and compare cashback rates
 */

import type { FeedData, Merchant, MerchantOffer } from "./feed.js";
import { isUnifiedFeedFormat } from "./feed.js";
import type { Service, ServiceRegistry } from "../config/services.js";
import { SERVICES_FALLBACK } from "../config/services.js";
import { DOMAIN_ALIASES } from "../config/domain-aliases.js";

/**
 * Match result with merchant, offer, and service info
 */
export interface MatchResult {
  merchant: {
    hostName: string;
    name: string;
  };
  offer: MerchantOffer;
  service: Service;
  // Convenience accessors for backward compatibility
  name: string;
  urlName: string;
  cashbackDescription: string;
  cashbackDetails: MerchantOffer["cashbackDetails"] | null;
}

/**
 * Parsed cashback rate for comparison
 */
export interface ParsedCashbackRate {
  value: number;
  type: "percent" | "fixed";
  isVariable: boolean;
}

/**
 * Parse a cashback description into a comparable value
 * Handles: "5,4%", "Opptil 4,6%", "35kr", "Opptil 290kr", "up to 5%", "3-5%"
 */
export function parseCashbackRate(description: string | undefined): ParsedCashbackRate {
  if (!description) return { value: 0, type: "percent", isVariable: false };

  const normalized = description.toLowerCase().trim();
  // Variable rate detection: "opptil", "opp til", "up to", or numeric range (e.g., "3-5%")
  const isVariable =
    normalized.startsWith("opptil") ||
    normalized.startsWith("opp til") ||
    normalized.startsWith("up to") ||
    /\d+\s*[-\u2013]\s*\d+/.test(normalized); // Match numeric ranges like "3-5" or "3 - 5"
  const cleanDesc = description.replace(/^(opptil|opp til|up to)\s*/i, "").trim();

  // Check for percentage (e.g., "5,4%")
  // For ranges like "3-5%", use the maximum value for ranking
  const rangePercentMatch = cleanDesc.match(/(\d+[,.]?\d*)\s*[-\u2013]\s*(\d+[,.]?\d*)\s*%/);
  if (rangePercentMatch?.[2]) {
    const value = parseFloat(rangePercentMatch[2].replace(",", "."));
    return { value, type: "percent", isVariable };
  }
  const percentMatch = cleanDesc.match(/(\d+[,.]?\d*)\s*%/);
  if (percentMatch?.[1]) {
    const value = parseFloat(percentMatch[1].replace(",", "."));
    return { value, type: "percent", isVariable };
  }

  // Check for fixed amount (e.g., "35kr", "290 kr")
  const fixedMatch = cleanDesc.match(/(\d+[,.]?\d*)\s*kr/i);
  if (fixedMatch?.[1]) {
    const value = parseFloat(fixedMatch[1].replace(",", "."));
    return { value, type: "fixed", isVariable };
  }

  return { value: 0, type: "percent", isVariable: false };
}

/**
 * Compare two cashback rates for sorting (higher = better)
 * Rules:
 * - When types differ, compare monetary equivalents using avgPurchaseAmount
 * - Higher value wins
 * - Non-variable ("5%") preferred over variable ("Opptil 5%") at same value
 */
export function compareCashbackRates(
  a: ParsedCashbackRate,
  b: ParsedCashbackRate,
  avgPurchaseAmount = 500
): number {
  // When types differ, compare monetary equivalents
  if (a.type !== b.type) {
    const monetaryA = a.type === "percent" ? (a.value / 100) * avgPurchaseAmount : a.value;
    const monetaryB = b.type === "percent" ? (b.value / 100) * avgPurchaseAmount : b.value;

    if (monetaryA > monetaryB) return -1;
    if (monetaryA < monetaryB) return 1;
    // If equal monetary value, prefer percentage (more flexible)
    if (a.type === "percent") return -1;
    return 1;
  }

  // Same type: higher value wins
  if (a.value > b.value) return -1;
  if (a.value < b.value) return 1;

  // At same value, non-variable preferred over variable
  if (!a.isVariable && b.isVariable) return -1;
  if (a.isVariable && !b.isVariable) return 1;

  return 0;
}

/**
 * Try to find a merchant by host with www variations
 */
function tryHost(merchants: Record<string, Merchant>, host: string): Merchant | null {
  // Exact match
  if (merchants[host]) {
    return merchants[host];
  }

  // Try without www.
  const noWww = host.replace(/^www\./, "");
  if (noWww !== host && merchants[noWww]) {
    return merchants[noWww];
  }

  // Try with www. prefix
  if (!host.startsWith("www.")) {
    const withWww = "www." + host;
    if (merchants[withWww]) {
      return merchants[withWww];
    }
  }

  return null;
}

/**
 * Find merchant by host and return the best offer from enabled services
 */
export function findBestOffer(
  feed: FeedData,
  currentHost: string,
  enabledServices: string[],
  services: ServiceRegistry = SERVICES_FALLBACK
): MatchResult | null {
  if (!feed?.merchants) {
    return null;
  }

  const { merchants } = feed;
  const isUnified = isUnifiedFeedFormat(feed);

  // Try current host first
  let merchant = tryHost(merchants, currentHost);

  // Try domain alias if exists
  if (!merchant) {
    const aliasedHost = DOMAIN_ALIASES[currentHost];
    if (aliasedHost) {
      merchant = tryHost(merchants, aliasedHost);
    }
  }

  // Also try alias without/with www
  if (!merchant) {
    const noWwwHost = currentHost.replace(/^www\./, "");
    const aliasedNoWww = DOMAIN_ALIASES[noWwwHost];
    if (aliasedNoWww) {
      merchant = tryHost(merchants, aliasedNoWww);
    }
  }

  if (!merchant) {
    return null;
  }

  // Handle unified feed format (with offers array)
  if (isUnified && merchant.offers) {
    // Filter to enabled services only
    const availableOffers = merchant.offers.filter((offer) =>
      enabledServices.includes(offer.serviceId)
    );

    if (availableOffers.length === 0) {
      return null;
    }

    // Sort by rate (best first)
    availableOffers.sort((a, b) => {
      const rateA = parseCashbackRate(a.cashbackDescription);
      const rateB = parseCashbackRate(b.cashbackDescription);
      return compareCashbackRates(rateA, rateB);
    });

    const bestOffer = availableOffers[0];
    if (!bestOffer) {
      return null;
    }
    const service = services[bestOffer.serviceId] || services.trumf;
    if (!service) {
      return null;
    }

    return {
      merchant: {
        hostName: merchant.hostName,
        name: merchant.name,
      },
      offer: bestOffer,
      service,
      // Convenience accessors
      name: merchant.name,
      urlName: bestOffer.urlName,
      cashbackDescription: bestOffer.cashbackDescription,
      cashbackDetails: bestOffer.cashbackDetails || null,
    };
  }

  // Handle old feed format (no offers array, Trumf-only)
  const service = services.trumf;
  if (!service || !enabledServices.includes("trumf")) {
    return null;
  }

  return {
    merchant: {
      hostName: merchant.hostName,
      name: merchant.name,
    },
    offer: {
      serviceId: "trumf",
      urlName: merchant.urlName || "",
      cashbackDescription: merchant.cashbackDescription || "",
    },
    service,
    // Convenience accessors
    name: merchant.name,
    urlName: merchant.urlName || "",
    cashbackDescription: merchant.cashbackDescription || "",
    cashbackDetails: null,
  };
}
