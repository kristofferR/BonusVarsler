import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";

const FEED_HEALTH_FILE = join(import.meta.dir, "..", ".feed-health.json");
const ALERT_FAILURE_THRESHOLD = 2;

const SERVICE_NAMES: Record<string, string> = {
  trumf: "Trumf",
  remember: "re:member",
  dnb: "DNB",
  obos: "OBOS",
  naf: "NAF",
  lofavor: "LOfavør",
};

interface ServiceHealthEntry {
  consecutiveFailureDays: number;
  lastFailureReason: string | null;
}

interface FeedHealthState {
  services: Record<string, ServiceHealthEntry>;
}

function setGithubOutput(name: string, value: string): void {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  if (value.includes("\n")) {
    const delimiter = `bonusvarsler_${name}_${Date.now()}`;
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `${name}<<${delimiter}\n${value}\n${delimiter}\n`
    );
  } else {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}

if (!existsSync(FEED_HEALTH_FILE)) {
  console.log("No .feed-health.json file found.");
  setGithubOutput("has_alerts", "false");
  setGithubOutput("alert_count", "0");
  setGithubOutput("alert_services", "");
  process.exit(0);
}

const feedHealth = JSON.parse(
  readFileSync(FEED_HEALTH_FILE, "utf-8")
) as FeedHealthState;

const alertServices = Object.entries(feedHealth.services)
  .filter(
    ([, health]) => health.consecutiveFailureDays >= ALERT_FAILURE_THRESHOLD
  )
  .map(([serviceId, health]) => {
    const serviceName = SERVICE_NAMES[serviceId] || serviceId;
    const reason = health.lastFailureReason || "unknown failure";
    return `${serviceName} (${health.consecutiveFailureDays} days: ${reason})`;
  });

if (alertServices.length === 0) {
  console.log("No repeated scraper failures detected.");
} else {
  console.log(`Repeated scraper failures: ${alertServices.join(", ")}`);
}

setGithubOutput("has_alerts", alertServices.length > 0 ? "true" : "false");
setGithubOutput("alert_count", String(alertServices.length));
setGithubOutput("alert_services", alertServices.join(", "));
