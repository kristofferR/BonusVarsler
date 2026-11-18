#!/usr/bin/env bun
/**
 * Publishes a release to addons.mozilla.org (AMO):
 * 1. Uploads the XPI with a source archive of HEAD and creates the listed version
 * 2. Sets the version's release notes from store/amo/release-notes/<version>.<locale>.md
 * 3. Syncs the listing summary and description from store/amo/
 *
 * Re-running for an already created version skips the upload and only updates the text.
 *
 * Usage: bun scripts/publish-amo.ts <path/to/bonusvarsler-X.Y.xpi> [--dry-run]
 * Env:   AMO_JWT_ISSUER, AMO_JWT_SECRET (https://addons.mozilla.org/developers/addon/api/key/)
 */

import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const STORE_DIR = join(ROOT, "store", "amo");
const API = "https://addons.mozilla.org/api/v5";
const ADDON = encodeURIComponent("trumf-bonusvarsler-lite@kristofferR");
const DEFAULT_LOCALE = "nb-NO";
const LICENSE = "GPL-3.0-only";
const SUMMARY_MAX_LENGTH = 250;
const VALIDATION_TIMEOUT_MS = 10 * 60 * 1000;
const APPROVAL_NOTES = [
  "content.js is bundled (not minified) from the TypeScript in src/ with Bun.",
  "To reproduce it from the attached source: bun install && bun run build:src",
  "background.js and options.* are hand-written and not bundled.",
].join("\n");

type Localized = Record<string, string>;

interface Upload {
  uuid: string;
  processed: boolean;
  valid: boolean;
  version: string;
  validation: { messages?: { type: string; message: string; file?: string }[] } | null;
}

interface Version {
  id: number;
  version: string;
}

/** Reads `<prefix>.<locale>.(md|txt)` files from a directory into a locale map. */
function readLocalized(dir: string, prefix: string): Localized {
  const localized: Localized = {};
  for (const file of readdirSync(dir)) {
    const match = file.match(/^(.+)\.([a-z]{2}(?:-[A-Z]{2})?)\.(?:md|txt)$/);
    if (match?.[1] === prefix && match[2]) {
      localized[match[2]] = readFileSync(join(dir, file), "utf8").trim();
    }
  }
  if (!localized[DEFAULT_LOCALE]) {
    throw new Error(`Missing ${prefix}.${DEFAULT_LOCALE}.* in ${dir}`);
  }
  return localized;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/** AMO wants a fresh HS256 JWT per request, valid for at most five minutes. */
function authHeader(issuer: string, secret: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: issuer, jti: randomUUID(), iat, exp: iat + 60 })}`;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return `JWT ${unsigned}.${signature}`;
}

function createClient(issuer: string, secret: string) {
  return async function amo<T>(method: string, path: string, body?: FormData | object): Promise<T> {
    const headers: Record<string, string> = { Authorization: authHeader(issuer, secret) };
    let payload: FormData | string | undefined;
    if (body instanceof FormData) {
      payload = body;
    } else if (body) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(`${API}${path}`, { method, headers, body: payload });
    if (!res.ok) throw new Error(`${method} ${path} failed with ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const xpiPath = args.find((arg) => !arg.startsWith("--"));
  if (!xpiPath || !existsSync(xpiPath)) {
    throw new Error("Usage: bun scripts/publish-amo.ts <path/to/bonusvarsler-X.Y.xpi> [--dry-run]");
  }

  const manifest: { version: string } = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const version = manifest.version;
  const summary = readLocalized(STORE_DIR, "summary");
  const description = readLocalized(STORE_DIR, "description");
  const releaseNotes = readLocalized(join(STORE_DIR, "release-notes"), version);

  for (const [locale, text] of Object.entries(summary)) {
    if (text.length > SUMMARY_MAX_LENGTH) {
      throw new Error(`summary.${locale} is ${text.length} characters (AMO max ${SUMMARY_MAX_LENGTH})`);
    }
  }

  console.log(`AMO release ${version} from ${xpiPath}`);
  console.log(`  listing locales: ${Object.keys(description).join(", ")}`);
  console.log(`  release notes locales: ${Object.keys(releaseNotes).join(", ")}`);
  if (dryRun) {
    console.log("Dry run, nothing sent.");
    return;
  }

  const amo = createClient(requireEnv("AMO_JWT_ISSUER"), requireEnv("AMO_JWT_SECRET"));

  const versions = await amo<{ results: Version[] }>(
    "GET",
    `/addons/addon/${ADDON}/versions/?filter=all_without_unlisted`
  );
  let created = versions.results.find((v) => v.version === version);

  if (created) {
    console.log(`Version ${version} already exists on AMO (id ${created.id}), skipping upload`);
  } else {
    const uploadForm = new FormData();
    uploadForm.append("upload", Bun.file(xpiPath), basename(xpiPath));
    uploadForm.append("channel", "listed");
    let upload = await amo<Upload>("POST", "/addons/upload/", uploadForm);
    console.log(`Uploaded ${basename(xpiPath)}, waiting for validation...`);

    const deadline = Date.now() + VALIDATION_TIMEOUT_MS;
    while (!upload.processed) {
      if (Date.now() > deadline) throw new Error(`Validation of upload ${upload.uuid} timed out`);
      await Bun.sleep(5000);
      upload = await amo<Upload>("GET", `/addons/upload/${upload.uuid}/`);
    }
    if (!upload.valid) {
      for (const message of upload.validation?.messages ?? []) {
        if (message.type === "error") console.error(`  ✗ ${message.message}${message.file ? ` (${message.file})` : ""}`);
      }
      throw new Error("AMO rejected the upload");
    }
    if (upload.version !== version) {
      throw new Error(`XPI is version ${upload.version}, but manifest.json says ${version}`);
    }

    // Reviewers need the source because content.js is bundled from TypeScript
    const sourcePath = join(dirname(xpiPath), `bonusvarsler-${version}-source.zip`);
    execFileSync("git", ["archive", "--format=zip", `--output=${sourcePath}`, "HEAD"], { cwd: ROOT });

    const versionForm = new FormData();
    versionForm.append("upload", upload.uuid);
    versionForm.append("source", Bun.file(sourcePath), basename(sourcePath));
    versionForm.append("license", LICENSE);
    versionForm.append("approval_notes", APPROVAL_NOTES);
    created = await amo<Version>("POST", `/addons/addon/${ADDON}/versions/`, versionForm);
    console.log(`Created version ${version} (id ${created.id}), submitted for review`);
  }

  await amo("PATCH", `/addons/addon/${ADDON}/versions/${created.id}/`, { release_notes: releaseNotes });
  console.log("Updated release notes");

  await amo("PATCH", `/addons/addon/${ADDON}/`, { summary, description });
  console.log("Updated listing summary and description");
}

main().catch((error: unknown) => {
  console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
