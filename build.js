#!/usr/bin/env node

/**
 * Build script for BonusVarsler
 * - Runs the merchant scraper (skip with --skip-scrape) and copies the sitelist to the root
 * - Creates Firefox XPI and Chrome ZIP packages with platform-specific manifests
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// ===================
// Configuration
// ===================

const BUILD_DIR = "dist";

const EXTENSION_FILES = [
  "content.js",
  "background.js",
  "options.html",
  "options.js",
  "options.css",
  "icon.png",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
  "icons/icon-256.png",
  "_locales",
  "data",
];

const SUPPORTED_LOCALES = ["no", "en", "sv", "da", "fr", "es"];

// Extension metadata
const EXTENSION_CONFIG = {
  name: "BonusVarsler",
  shortName: "BonusVarsler",
  firefoxId: "trumf-bonusvarsler-lite@kristofferR",
};

// ===================
// Utility Functions
// ===================

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const child of fs.readdirSync(src)) {
      copyRecursive(path.join(src, child), path.join(dest, child));
    }
  } else {
    // Ensure parent directory exists for nested files
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ===================
// Main Build Steps
// ===================

function createManifest(platform) {
  const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));

  // Set extension name
  manifest.name = EXTENSION_CONFIG.name;
  manifest.action.default_title = EXTENSION_CONFIG.shortName;

  if (platform === "chrome") {
    // Chrome uses service_worker
    manifest.background = {
      service_worker: "background.js",
    };
    // Remove Firefox-specific settings
    delete manifest.browser_specific_settings;
  } else {
    // Firefox uses scripts array
    manifest.background = {
      scripts: ["background.js"],
    };
    // Firefox-specific settings
    manifest.browser_specific_settings = {
      gecko: {
        id: EXTENSION_CONFIG.firefoxId,
        strict_min_version: "142.0",
        granted_host_permissions: true,
        data_collection_permissions: {
          required: ["none"],
          optional: [],
        },
      },
    };
  }

  return manifest;
}

function createPackages() {
  console.log("\n📦 Creating extension packages...");

  // Clean and create build directory
  if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true });
  }
  fs.mkdirSync(BUILD_DIR, { recursive: true });

  // Read version from manifest
  const baseManifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
  const version = baseManifest.version;

  // Build Firefox XPI
  const firefoxDir = path.join(BUILD_DIR, "firefox");
  fs.mkdirSync(firefoxDir, { recursive: true });

  for (const file of EXTENSION_FILES) {
    if (!fs.existsSync(file)) continue;
    copyRecursive(file, path.join(firefoxDir, file));
  }
  fs.writeFileSync(
    path.join(firefoxDir, "manifest.json"),
    JSON.stringify(createManifest("firefox"), null, 2)
  );

  const xpiName = `bonusvarsler-${version}.xpi`;
  execSync(`cd "${firefoxDir}" && zip -r "../${xpiName}" .`, { stdio: "pipe" });
  console.log(`   ✓ Created ${xpiName}`);

  // Build Chrome ZIP
  const chromeDir = path.join(BUILD_DIR, "chrome");
  fs.mkdirSync(chromeDir, { recursive: true });

  for (const file of EXTENSION_FILES) {
    if (!fs.existsSync(file)) continue;
    copyRecursive(file, path.join(chromeDir, file));
  }
  fs.writeFileSync(
    path.join(chromeDir, "manifest.json"),
    JSON.stringify(createManifest("chrome"), null, 2)
  );

  const zipName = `bonusvarsler-${version}-chrome.zip`;
  execSync(`cd "${chromeDir}" && zip -r "../${zipName}" .`, { stdio: "pipe" });
  console.log(`   ✓ Created ${zipName}`);

  // Clean up temp directories
  fs.rmSync(firefoxDir, { recursive: true });
  fs.rmSync(chromeDir, { recursive: true });

  console.log(`\n✅ Build complete! Packages in ${BUILD_DIR}/`);
  console.log(`   - ${xpiName}`);
  console.log(`   - ${zipName}`);
}

function updateGitignore() {
  const gitignorePath = ".gitignore";
  let gitignore = "";
  let updated = false;

  if (fs.existsSync(gitignorePath)) {
    gitignore = fs.readFileSync(gitignorePath, "utf8");
  }

  if (!gitignore.includes(BUILD_DIR)) {
    gitignore = gitignore.trimEnd() + `\n\n# Build output\n${BUILD_DIR}/\n`;
    updated = true;
  }

  if (updated) {
    fs.writeFileSync(gitignorePath, gitignore);
    console.log("   ✓ Updated .gitignore");
  }
}

// ===================
// Main
// ===================

async function main() {
  try {
    console.log("🚀 Building BonusVarsler\n");

    // Run the scraper script to get fresh merchant data from all services.
    // --skip-scrape packages the feed the daily update-feed workflow already committed.
    if (process.argv.includes("--skip-scrape")) {
      console.log("📥 Skipping merchant scraper, using committed sitelist.json\n");
    } else {
      console.log("📥 Running merchant scraper...\n");
      try {
        execSync("bun scripts/scrape-feeds.ts", { stdio: "inherit" });
      } catch (error) {
        console.error("   ⚠ Scraper failed, continuing with existing sitelist.json");
      }
    }

    // Load the sitelist that was created/updated by the scraper
    // Try data/sitelist.json first, fall back to root sitelist.json
    let sitelist;
    if (fs.existsSync("data/sitelist.json")) {
      sitelist = JSON.parse(fs.readFileSync("data/sitelist.json", "utf8"));
      console.log(`\n   ✓ Loaded sitelist with ${Object.keys(sitelist.merchants || {}).length} merchants`);
    } else if (fs.existsSync("sitelist.json")) {
      console.log("\n   ⚠ data/sitelist.json not found, using root sitelist.json as fallback");
      sitelist = JSON.parse(fs.readFileSync("sitelist.json", "utf8"));
      console.log(`   ✓ Loaded sitelist with ${Object.keys(sitelist.merchants || {}).length} merchants`);
    } else {
      console.error("\n❌ No sitelist.json found in data/ or root. Run the scraper first.");
      process.exit(1);
    }

    // Copy to root sitelist.json (used for GitHub CDN fallback)
    fs.writeFileSync("sitelist.json", JSON.stringify(sitelist));

    // Bundle TypeScript source
    console.log("\n📦 Bundling TypeScript source...\n");
    try {
      execSync("bun run scripts/bundle.ts", { stdio: "inherit" });
    } catch (error) {
      console.error("   ⚠ TypeScript bundling failed, continuing with existing content.js");
    }

    // Update .gitignore
    updateGitignore();

    // Create packages
    createPackages();
  } catch (error) {
    console.error("\n❌ Build failed:", error.message);
    process.exit(1);
  }
}

main();
