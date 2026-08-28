// One place every adapter fetches through, so the fetching rules are a property of the system
// rather than a discipline each adapter has to remember.
//
//   robots.txt is checked before the first fetch to a host and cached for the run.
//   A descriptive User-Agent carrying a contact email goes on every request.
//   One request per 2 seconds per host, serialised per host, not globally.
//   A snapshot younger than 24 hours is reused; the network is not touched at all.
//
// The clock, the sleep and the HTTP call are injected. That is not ceremony — it is the only way
// the rate limiter and the cache window can be tested without either a network or a real wait.

import { RobotsDisallowedError, type RawSnapshot } from "./types";

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface FetchPolicyDeps {
  readonly httpGet: (url: string, headers: Record<string, string>) => Promise<HttpResponse>;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** Most recent snapshot for an adapter, if the store holds one. */
  readonly readSnapshot?: (adapterId: string) => Promise<RawSnapshot | null>;
  readonly writeSnapshot?: (snapshot: RawSnapshot) => Promise<void>;
  /** Injected so a hash is reproducible in tests; defaults to a content hash in the runner. */
  readonly hash: (body: string) => string;
}

export interface FetchPolicyOptions {
  readonly contactEmail: string;
  readonly productName?: string;
  readonly productUrl?: string;
  readonly minIntervalMsPerHost?: number;
  readonly snapshotMaxAgeMs?: number;
}

export const DEFAULT_MIN_INTERVAL_MS = 2000;
export const DEFAULT_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * A deliberately small robots.txt reader: the `User-agent: *` group plus any group naming us,
 * and `Disallow` prefixes only. It errs towards refusing — an unparseable or unreachable
 * robots.txt is treated as a disallow, never as permission.
 */
/**
 * The Crawl-delay a host asks for, in milliseconds, or null if it asks for none.
 *
 * Honouring this is not optional politeness. A host that publishes `Crawl-delay: 10` and gets a
 * request every 2 seconds is being ignored, whatever the User-Agent says about contacting us.
 * Where a host asks for more than our own floor, the host wins.
 */
export function robotsCrawlDelayMs(robotsTxt: string, userAgentToken: string): number | null {
  const groups = parseRobotsGroups(robotsTxt);
  const applicable = [
    groups.delays.get(userAgentToken.toLowerCase()),
    groups.delays.get("*"),
  ].filter((d): d is number => typeof d === "number");
  return applicable.length === 0 ? null : Math.max(...applicable) * 1000;
}

interface RobotsGroups {
  readonly rules: Map<string, string[]>;
  readonly delays: Map<string, number>;
}

/**
 * Consecutive `User-agent` lines form ONE group sharing the rules that follow — which is why a
 * Squarespace robots.txt listing two dozen AI crawlers immediately before `User-agent: *` is not
 * a site-wide block on those crawlers; they simply share everyone else's path rules.
 */
function parseRobotsGroups(robotsTxt: string): RobotsGroups {
  const rules = new Map<string, string[]>();
  const delays = new Map<string, number>();
  let agents: string[] = [];
  let expectingAgents = true;

  for (const rawLine of robotsTxt.split("\n")) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (line === "") continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey?.trim().toLowerCase() ?? "";
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      if (!expectingAgents) {
        agents = [];
        expectingAgents = true;
      }
      agents.push(value.toLowerCase());
      if (!rules.has(value.toLowerCase())) rules.set(value.toLowerCase(), []);
      continue;
    }

    expectingAgents = false;
    if (key === "disallow") {
      for (const agent of agents) rules.get(agent)?.push(value);
    } else if (key === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) {
        for (const agent of agents) delays.set(agent, seconds);
      }
    }
  }
  return { rules, delays };
}

export function robotsDisallows(robotsTxt: string, path: string, userAgentToken: string): boolean {
  const { rules } = parseRobotsGroups(robotsTxt);
  const applicable = [
    ...(rules.get(userAgentToken.toLowerCase()) ?? []),
    ...(rules.get("*") ?? []),
  ];
  return applicable.some((rule) => rule !== "" && path.startsWith(rule));
}

export class FetchPolicy {
  private readonly lastRequestAt = new Map<string, number>();
  private readonly robotsCache = new Map<string, string | null>();
  private readonly crawlDelayMs = new Map<string, number>();
  private readonly hostChains = new Map<string, Promise<unknown>>();

  constructor(
    private readonly deps: FetchPolicyDeps,
    private readonly options: FetchPolicyOptions,
  ) {}

  get userAgent(): string {
    const name = this.options.productName ?? "ReferralSupportBot";
    const url = this.options.productUrl ? ` +${this.options.productUrl};` : "";
    return `${name}/0.1 (${url} contact: ${this.options.contactEmail})`;
  }

  private get userAgentToken(): string {
    return (this.options.productName ?? "ReferralSupportBot").split("/")[0] ?? "ReferralSupportBot";
  }

  /**
   * Returns a cached snapshot when one is younger than the window, otherwise fetches under the
   * robots and rate-limit rules and stores the result.
   */
  async snapshot(adapterId: string, url: string): Promise<RawSnapshot> {
    const maxAge = this.options.snapshotMaxAgeMs ?? DEFAULT_SNAPSHOT_MAX_AGE_MS;
    const cached = (await this.deps.readSnapshot?.(adapterId)) ?? null;
    if (cached && this.deps.now() - Date.parse(cached.fetchedAt) < maxAge) return cached;

    const body = await this.get(url);
    const snapshot: RawSnapshot = {
      adapterId,
      fetchedAt: new Date(this.deps.now()).toISOString(),
      url,
      contentHash: this.deps.hash(body),
      body,
    };
    await this.deps.writeSnapshot?.(snapshot);
    return snapshot;
  }

  /** One request, robots-checked and rate-limited. Requests to one host never overlap. */
  async get(url: string): Promise<string> {
    const target = new URL(url);
    const host = target.host;
    const chained = (this.hostChains.get(host) ?? Promise.resolve()).then(
      () => this.getSerialised(target),
      () => this.getSerialised(target),
    );
    this.hostChains.set(host, chained.catch(() => undefined));
    return chained;
  }

  private async getSerialised(target: URL): Promise<string> {
    await this.ensureAllowed(target);
    await this.waitForSlot(target.host);
    const response = await this.request(target.toString());
    if (response.status !== 200) {
      throw new Error(`${target.toString()} returned ${response.status}`);
    }
    return response.body;
  }

  private async ensureAllowed(target: URL): Promise<void> {
    const host = target.host;
    if (!this.robotsCache.has(host)) {
      await this.waitForSlot(host);
      let text: string | null;
      try {
        const response = await this.request(`${target.origin}/robots.txt`);
        // A 404 means no rules were published, which is permission. Anything else is not.
        text = response.status === 200 ? response.body : response.status === 404 ? "" : null;
      } catch {
        text = null;
      }
      this.robotsCache.set(host, text);
      if (text !== null) {
        const asked = robotsCrawlDelayMs(text, this.userAgentToken);
        if (asked !== null) this.crawlDelayMs.set(host, asked);
      }
    }
    const robots = this.robotsCache.get(host) ?? null;
    if (robots === null) throw new RobotsDisallowedError(target.toString());
    if (robotsDisallows(robots, target.pathname, this.userAgentToken)) {
      throw new RobotsDisallowedError(target.toString());
    }
  }

  private async waitForSlot(host: string): Promise<void> {
    // Our floor, or whatever the host asked for, whichever is slower.
    const interval = Math.max(
      this.options.minIntervalMsPerHost ?? DEFAULT_MIN_INTERVAL_MS,
      this.crawlDelayMs.get(host) ?? 0,
    );
    const last = this.lastRequestAt.get(host);
    if (last !== undefined) {
      const wait = last + interval - this.deps.now();
      if (wait > 0) await this.deps.sleep(wait);
    }
    this.lastRequestAt.set(host, this.deps.now());
  }

  private request(url: string): Promise<HttpResponse> {
    return this.deps.httpGet(url, {
      "User-Agent": this.userAgent,
      From: this.options.contactEmail,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    });
  }
}
