// The clock, the sleep and the HTTP call are injected, so the rate limiter and the cache window
// are tested exactly — no network, no real waiting.

import { describe, expect, it, vi } from "vitest";
import { FetchPolicy, robotsCrawlDelayMs, robotsDisallows, type FetchPolicyDeps, type HttpResponse } from "./fetch-policy";
import { RobotsDisallowedError, type RawSnapshot } from "./types";

interface Harness {
  policy: FetchPolicy;
  calls: string[];
  slept: number[];
  setClock: (ms: number) => void;
  responses: Map<string, HttpResponse>;
}

function harness(options: {
  robots?: string | { status: number };
  snapshot?: RawSnapshot | null;
  minIntervalMsPerHost?: number;
  snapshotMaxAgeMs?: number;
} = {}): Harness {
  let clock = Date.parse("2026-08-28T00:00:00.000Z");
  const calls: string[] = [];
  const slept: number[] = [];
  const responses = new Map<string, HttpResponse>();

  const robots = options.robots ?? "";
  const deps: FetchPolicyDeps = {
    httpGet: async (url) => {
      calls.push(url);
      if (url.endsWith("/robots.txt")) {
        return typeof robots === "string" ? { status: 200, body: robots } : { status: robots.status, body: "" };
      }
      return responses.get(url) ?? { status: 200, body: "<html>page</html>" };
    },
    now: () => clock,
    sleep: async (ms) => {
      slept.push(ms);
      clock += ms;
    },
    readSnapshot: async () => options.snapshot ?? null,
    writeSnapshot: async () => undefined,
    hash: (body) => `hash:${body.length}`,
  };

  const policy = new FetchPolicy(deps, {
    contactEmail: "data@referral.test",
    productName: "ReferralSupportBot",
    productUrl: "https://referral.test/bot",
    ...(options.minIntervalMsPerHost !== undefined ? { minIntervalMsPerHost: options.minIntervalMsPerHost } : {}),
    ...(options.snapshotMaxAgeMs !== undefined ? { snapshotMaxAgeMs: options.snapshotMaxAgeMs } : {}),
  });

  return { policy, calls, slept, responses, setClock: (ms) => { clock = ms; } };
}

describe("robots.txt parsing", () => {
  const robots = `
User-agent: BadBot
Disallow: /

User-agent: *
Disallow: /private
Disallow: /admin
`;

  it("honours a wildcard disallow", () => {
    expect(robotsDisallows(robots, "/private/list", "ReferralSupportBot")).toBe(true);
  });

  it("allows what is not disallowed", () => {
    expect(robotsDisallows(robots, "/find-a-surgeon", "ReferralSupportBot")).toBe(false);
  });

  it("honours a rule aimed at us by name", () => {
    expect(robotsDisallows("User-agent: ReferralSupportBot\nDisallow: /members", "/members", "ReferralSupportBot")).toBe(true);
  });

  it("treats an empty Disallow as permission, per the standard", () => {
    expect(robotsDisallows("User-agent: *\nDisallow:", "/anything", "ReferralSupportBot")).toBe(false);
  });

  it("ignores comments", () => {
    expect(robotsDisallows("User-agent: *  # everyone\nDisallow: /x # no", "/x/y", "ReferralSupportBot")).toBe(true);
  });
});

describe("robots enforcement", () => {
  it("refuses a disallowed path", async () => {
    const h = harness({ robots: "User-agent: *\nDisallow: /members" });
    await expect(h.policy.get("https://society.test/members")).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it("treats an unreachable robots.txt as a refusal, never as permission", async () => {
    const h = harness({ robots: { status: 500 } });
    await expect(h.policy.get("https://society.test/find")).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it("treats a 404 robots.txt as no rules published", async () => {
    const h = harness({ robots: { status: 404 } });
    await expect(h.policy.get("https://society.test/find")).resolves.toContain("page");
  });

  it("checks robots once per host, not once per request", async () => {
    const h = harness();
    await h.policy.get("https://society.test/a");
    await h.policy.get("https://society.test/b");
    expect(h.calls.filter((c) => c.endsWith("/robots.txt"))).toHaveLength(1);
  });
});

describe("rate limiting", () => {
  it("waits the full interval between two requests to one host", async () => {
    const h = harness({ minIntervalMsPerHost: 2000 });
    await h.policy.get("https://society.test/a");
    await h.policy.get("https://society.test/b");
    // robots then /a, then the gap before /b.
    expect(h.slept).toContain(2000);
  });

  it("keeps each host's interval to itself", async () => {
    // robots.txt is a request to the host and rightly consumes a slot, so each fresh host costs
    // one gap. The property under test is that the gaps do not compound across hosts: by the
    // time two.test has been walked, one.test's own interval has already elapsed and a further
    // request to it waits for nothing.
    const h = harness({ minIntervalMsPerHost: 2000 });
    await h.policy.get("https://one.test/a");
    await h.policy.get("https://two.test/a");
    const before = h.slept.length;
    await h.policy.get("https://one.test/b");
    expect(h.slept.length).toBe(before);
  });

  it("defaults to one request per two seconds", async () => {
    const h = harness();
    await h.policy.get("https://society.test/a");
    await h.policy.get("https://society.test/b");
    expect(Math.max(...h.slept)).toBe(2000);
  });
});

describe("the User-Agent", () => {
  it("names the product and carries a contact email", async () => {
    const h = harness();
    expect(h.policy.userAgent).toContain("ReferralSupportBot");
    expect(h.policy.userAgent).toContain("data@referral.test");
  });

  it("goes out on every request, robots.txt included", async () => {
    const spy = vi.fn(async (_url: string, _headers: Record<string, string>) => ({ status: 200, body: "" }) as HttpResponse);
    const policy = new FetchPolicy(
      { httpGet: spy, now: () => 0, sleep: async () => undefined, hash: () => "h" },
      { contactEmail: "data@referral.test" },
    );
    await policy.get("https://society.test/a");
    expect(spy.mock.calls.length).toBeGreaterThan(0);
    for (const [, headers] of spy.mock.calls) {
      expect(headers["User-Agent"]).toContain("data@referral.test");
    }
  });
});

describe("the 24-hour snapshot window", () => {
  const fresh: RawSnapshot = {
    adapterId: "society-knee",
    fetchedAt: "2026-08-27T23:00:00.000Z",
    url: "https://society.test/find",
    contentHash: "old",
    body: "cached body",
  };

  it("reuses a snapshot younger than 24 hours without touching the network", async () => {
    const h = harness({ snapshot: fresh });
    const result = await h.policy.snapshot("society-knee", "https://society.test/find");
    expect(result.body).toBe("cached body");
    expect(h.calls).toEqual([]);
  });

  it("re-fetches once the snapshot is older than the window", async () => {
    const h = harness({ snapshot: { ...fresh, fetchedAt: "2026-08-26T00:00:00.000Z" } });
    const result = await h.policy.snapshot("society-knee", "https://society.test/find");
    expect(result.body).toBe("<html>page</html>");
    expect(h.calls.some((c) => c === "https://society.test/find")).toBe(true);
  });

  it("stamps the new snapshot with a content hash and the fetch time", async () => {
    const h = harness();
    const result = await h.policy.snapshot("society-knee", "https://society.test/find");
    expect(result.contentHash).toBe(`hash:${"<html>page</html>".length}`);
    // Two seconds past the start of the run, not zero: the robots.txt request took the host's
    // first slot and the page waited out the interval. fetchedAt records when the page was
    // actually retrieved, which is what staleness has to be measured from.
    expect(result.fetchedAt).toBe("2026-08-28T00:00:02.000Z");
  });
});

describe("Crawl-delay", () => {
  const squarespace = `
User-agent: anthropic-ai
User-agent: ClaudeBot
User-agent: GPTBot
User-agent: *
Disallow: /config
Disallow: /search
`;

  it("reads a delay the host asks for", () => {
    expect(robotsCrawlDelayMs("User-agent: *\nCrawl-delay: 10", "ReferralSupportBot")).toBe(10_000);
  });

  it("is null when the host asks for none", () => {
    expect(robotsCrawlDelayMs("User-agent: *\nDisallow: /x", "ReferralSupportBot")).toBeNull();
  });

  it("slows us to the host's pace when it is slower than our floor", async () => {
    const h = harness({ robots: "User-agent: *\nCrawl-delay: 10", minIntervalMsPerHost: 2000 });
    await h.policy.get("https://slow.test/a");
    await h.policy.get("https://slow.test/b");
    expect(Math.max(...h.slept)).toBe(10_000);
  });

  it("never speeds us up below our own floor", async () => {
    const h = harness({ robots: "User-agent: *\nCrawl-delay: 1", minIntervalMsPerHost: 2000 });
    await h.policy.get("https://quick.test/a");
    await h.policy.get("https://quick.test/b");
    expect(Math.max(...h.slept)).toBe(2000);
  });

  it("treats consecutive User-agent lines as one group sharing the rules that follow", () => {
    // A Squarespace robots.txt lists two dozen AI crawlers immediately before `User-agent: *`.
    // That is not a site-wide block on those crawlers — they share everyone else's path rules.
    expect(robotsDisallows(squarespace, "/member-directory", "ClaudeBot")).toBe(false);
    expect(robotsDisallows(squarespace, "/search", "ClaudeBot")).toBe(true);
    expect(robotsDisallows(squarespace, "/member-directory", "ReferralSupportBot")).toBe(false);
  });
});
