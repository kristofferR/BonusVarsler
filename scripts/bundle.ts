#!/usr/bin/env bun
/**
 * Bundle TypeScript source into extension and userscript outputs
 * Uses esbuild for fast bundling with CSS inlining
 */

import * as esbuild from "esbuild";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const SRC = path.join(ROOT, "src");

// Plugin to resolve tsconfig path aliases (@/* -> ./src/*)
function aliasPlugin(): esbuild.Plugin {
  return {
    name: "alias",
    setup(build) {
      build.onResolve({ filter: /^@\// }, (args) => {
        const resolved = path.join(SRC, args.path.slice(2));
        return { path: resolved };
      });
    },
  };
}

// Read CSS file and return as a string for injection
// Note: No minification to avoid corrupting CSS string literals (content:, data URLs, etc.)
function inlineCSS(): esbuild.Plugin {
  return {
    name: "inline-css",
    setup(build) {
      build.onLoad({ filter: /\.css$/ }, async (args) => {
        const css = await Bun.file(args.path).text();
        return {
          contents: `export default ${JSON.stringify(css)};`,
          loader: "js",
        };
      });
    },
  };
}

// Read PNG file and return as base64 data URI (at build time)
function inlinePNG(): esbuild.Plugin {
  return {
    name: "inline-png",
    setup(build) {
      build.onLoad({ filter: /\.png$/ }, async (args) => {
        const buffer = await Bun.file(args.path).arrayBuffer();
        const base64 = Buffer.from(buffer).toString("base64");
        const dataUri = `data:image/png;base64,${base64}`;
        return {
          contents: `export default ${JSON.stringify(dataUri)};`,
          loader: "js",
        };
      });
    },
  };
}

// Plugin to read JSON files with validation
function jsonPlugin(): esbuild.Plugin {
  return {
    name: "json",
    setup(build) {
      build.onLoad({ filter: /\.json$/ }, async (args) => {
        const json = await Bun.file(args.path).text();
        // Validate JSON at build time to catch errors early
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch (err) {
          throw new Error(
            `Invalid JSON in ${args.path}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
        // Use the parsed and re-serialized value to ensure valid output
        return {
          contents: `export default ${JSON.stringify(parsed)};`,
          loader: "js",
        };
      });
    },
  };
}

// Generate userscript header
function getUserscriptHeader(): string {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")
  );
  const version = manifest.version;

  return `// ==UserScript==
// @name         BonusVarsler (for Trumf, DNB, re:member++)
// @namespace    http://tampermonkey.net/
// @version      ${version}
// @description  Varsler om bonuser og cashback fra Trumf, re:member, DNB og andre når du besøker nettsider som tilbyr dette. Norsk utvidelse.
// @author       kristofferR
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @grant        GM.getValue
// @grant        GM.setValue
// @grant        GM.deleteValue
// @grant        GM.xmlHttpRequest
// @grant        GM_setClipboard
// @connect      raw.githubusercontent.com
// @connect      wlp.tcb-cdn.com
// @run-at       document-start
// @downloadURL  https://github.com/kristofferR/BonusVarsler/raw/main/BonusVarsler.user.js
// @updateURL    https://github.com/kristofferR/BonusVarsler/raw/main/BonusVarsler.user.js
// @homepageURL  https://github.com/kristofferR/BonusVarsler
// ==/UserScript==

`;
}

// Safari userscript wrappers can reject strict directives in wrapped function bodies.
// Strip them from the userscript bundle for cross-manager compatibility.
function stripStrictDirectives(code: string): string {
  return code.replace(/^[ \t]*"use strict";\n/gm, "");
}

async function build() {
  console.log("🔨 Bundling TypeScript source...\n");

  // Check if src directory exists
  if (!fs.existsSync(SRC)) {
    console.error(`❌ Source directory not found: ${SRC}`);
    console.error("   Cannot build without source files. This would ship stale artifacts.");
    process.exit(1);
  }

  // Check if entry points exist
  const extensionEntry = path.join(SRC, "platform", "extension.ts");
  const userscriptEntry = path.join(SRC, "platform", "userscript.ts");

  const missingEntries: string[] = [];
  if (!fs.existsSync(extensionEntry)) {
    missingEntries.push(extensionEntry);
  }
  if (!fs.existsSync(userscriptEntry)) {
    missingEntries.push(userscriptEntry);
  }

  if (missingEntries.length > 0) {
    console.error("❌ Required entry points not found:");
    for (const entry of missingEntries) {
      console.error(`   - ${entry}`);
    }
    console.error("   Cannot build without entry points. This would ship stale artifacts.");
    process.exit(1);
  }

  const commonOptions: esbuild.BuildOptions = {
    bundle: true,
    format: "iife",
    target: "es2022",
    minify: false, // Keep readable for debugging
    plugins: [aliasPlugin(), inlineCSS(), inlinePNG(), jsonPlugin()],
    logLevel: "info",
  };

  // Build extension content script
  console.log("📦 Building extension content script...");
  await esbuild.build({
    ...commonOptions,
    entryPoints: [extensionEntry],
    outfile: path.join(ROOT, "content.js"),
    define: {
      "process.env.PLATFORM": '"extension"',
    },
  });
  console.log("   ✓ content.js");

  // Build userscript
  console.log("\n📦 Building userscript...");
  const userscriptResult = await esbuild.build({
    ...commonOptions,
    entryPoints: [userscriptEntry],
    outfile: path.join(ROOT, "BonusVarsler.user.js.tmp"),
    define: {
      "process.env.PLATFORM": '"userscript"',
    },
    write: false, // Don't write, we need to prepend header
  });

  // Prepend userscript header
  const rawUserscriptCode = userscriptResult.outputFiles?.[0]?.text;
  if (!rawUserscriptCode || rawUserscriptCode.trim() === "") {
    console.error("❌ Userscript build produced empty or missing output");
    console.error("   Build metadata:", JSON.stringify({
      outputFilesCount: userscriptResult.outputFiles?.length ?? 0,
      errors: userscriptResult.errors,
      warnings: userscriptResult.warnings,
    }, null, 2));
    process.exit(1);
  }
  const userscriptCode = stripStrictDirectives(rawUserscriptCode);
  const finalUserscript = getUserscriptHeader() + userscriptCode;
  fs.writeFileSync(path.join(ROOT, "BonusVarsler.user.js"), finalUserscript);
  console.log("   ✓ BonusVarsler.user.js");

  // Copy to legacy filename for backwards compatibility
  fs.writeFileSync(
    path.join(ROOT, "Trumf-Bonusvarsler-Lite.user.js"),
    finalUserscript
  );
  console.log("   ✓ Trumf-Bonusvarsler-Lite.user.js (legacy copy)");

  console.log("\n✅ Bundle complete!");
}

build().catch((err) => {
  console.error("❌ Bundle failed:", err);
  process.exit(1);
});
