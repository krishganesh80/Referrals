import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  PERMITTED_PING_FIELDS,
  PingSchema,
  isoWeekOf,
  type Ping,
} from "./payload";
import {
  K_ANONYMITY_THRESHOLD,
  RAW_RETENTION_DAYS,
  SIGNALS_ENABLED_BY_DEFAULT,
  SignalStore,
  ingestBatch,
} from "./store";
import { emptyQueue, enqueue, markSubmitted, shouldSubmit } from "./client-queue";

const token = (n: number) => n.toString(16).padStart(32, "0");
const ping = (over: Partial<Ping> = {}): Ping => ({
  surgeonId: "MED1000000000",
  outcome: "accepted",
  weekBucket: "2026-W35",
  installToken: token(1),
  ...over,
});
const AT = new Date("2026-08-28T00:00:00.000Z");

describe("the payload carries four fields and no others", () => {
  it("accepts a well-formed ping", () => {
    expect(() => PingSchema.parse(ping())).not.toThrow();
  });

  it("property: no field outside the permitted list can be serialised", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }).filter((k) => !(PERMITTED_PING_FIELDS as readonly string[]).includes(k)),
        fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null)),
        (extraKey, extraValue) => {
          const result = PingSchema.safeParse({ ...ping(), [extraKey]: extraValue });
          return result.success === false;
        },
      ),
      { numRuns: 500 },
    );
  });

  it("names the fields the founder listed, and only those", () => {
    expect([...PERMITTED_PING_FIELDS].sort()).toEqual(["installToken", "outcome", "surgeonId", "weekBucket"]);
  });

  it.each(["postcode", "criteria", "subspecialty", "patientId", "practiceId", "timestamp", "region", "payer"])(
    "rejects a ping carrying %s",
    (field) => {
      expect(PingSchema.safeParse({ ...ping(), [field]: "anything" }).success).toBe(false);
    },
  );

  it("has no time granularity finer than the ISO week", () => {
    expect(PingSchema.safeParse({ ...ping(), weekBucket: "2026-08-28" }).success).toBe(false);
    expect(PingSchema.safeParse({ ...ping(), weekBucket: "2026-W35" }).success).toBe(true);
  });

  it("rejects an install token that is not opaque 32-hex", () => {
    expect(PingSchema.safeParse({ ...ping(), installToken: "drjones@clinic.com.au" }).success).toBe(false);
  });

  it("computes the ISO week the client should send", () => {
    expect(isoWeekOf(new Date("2026-08-28T13:00:00Z"))).toMatch(/^2026-W\d{2}$/);
    expect(isoWeekOf(new Date("2026-01-01T00:00:00Z"))).toBe("2026-W01");
  });
});

describe("k-anonymity suppression", () => {
  const fill = (distinct: number) => {
    const store = new SignalStore();
    for (let i = 0; i < distinct; i++) store.record(ping({ installToken: token(i) }), AT);
    return store;
  };

  it("is enforced at five distinct installs", () => {
    expect(K_ANONYMITY_THRESHOLD).toBe(5);
  });

  it("hides a cell one install short of the threshold", () => {
    expect(fill(K_ANONYMITY_THRESHOLD - 1).read()).toEqual([]);
  });

  it("publishes a cell that reaches it", () => {
    const cells = fill(K_ANONYMITY_THRESHOLD).read();
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ surgeonId: "MED1000000000", weekBucket: "2026-W35", distinctInstalls: 5 });
  });

  it("counts distinct INSTALLS, not pings — one practice cannot unlock a cell alone", () => {
    const store = new SignalStore();
    for (let i = 0; i < 50; i++) store.record(ping({ installToken: token(7) }), AT);
    expect(store.read()).toEqual([]);
    expect(store.cellCount).toBe(1);
  });

  it("suppresses per (surgeon, week) cell, not per surgeon", () => {
    const store = new SignalStore();
    for (let i = 0; i < 5; i++) store.record(ping({ weekBucket: "2026-W35", installToken: token(i) }), AT);
    for (let i = 0; i < 2; i++) store.record(ping({ weekBucket: "2026-W36", installToken: token(i) }), AT);
    expect(store.read().map((c) => c.weekBucket)).toEqual(["2026-W35"]);
  });

  it("property: no read path ever returns an under-threshold cell", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ surgeon: fc.integer({ min: 0, max: 3 }), tok: fc.integer({ min: 0, max: 9 }) }), { maxLength: 60 }),
        (events) => {
          const store = new SignalStore();
          for (const e of events) {
            store.record(ping({ surgeonId: `MED100000000${e.surgeon}`, installToken: token(e.tok) }), AT);
          }
          return store.read().every((cell) => cell.distinctInstalls >= K_ANONYMITY_THRESHOLD);
        },
      ),
      { numRuns: 300 },
    );
  });

  it("suppresses before any downstream consumer, because there is no other accessor", () => {
    const store = fill(2);
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(store));
    expect(surface.filter((m) => m !== "constructor").sort()).toEqual([
      "cellCount", "dropExpiredRaw", "holdsRawTokens", "read", "record",
    ]);
  });
});

describe("raw retention", () => {
  it("drops install tokens after thirty days and keeps the counts", () => {
    const store = new SignalStore();
    for (let i = 0; i < 6; i++) store.record(ping({ installToken: token(i) }), AT);
    expect(store.holdsRawTokens()).toBe(true);

    const later = new Date(AT.getTime() + (RAW_RETENTION_DAYS + 1) * 86_400_000);
    expect(store.dropExpiredRaw(later)).toBe(1);
    expect(store.holdsRawTokens()).toBe(false);
    expect(store.read()[0]?.distinctInstalls).toBe(6);
  });

  it("keeps them inside the window", () => {
    const store = new SignalStore();
    store.record(ping(), AT);
    store.dropExpiredRaw(new Date(AT.getTime() + (RAW_RETENTION_DAYS - 1) * 86_400_000));
    expect(store.holdsRawTokens()).toBe(true);
  });

  it("is thirty days", () => {
    expect(RAW_RETENTION_DAYS).toBe(30);
  });
});

describe("the client queue", () => {
  it("is off by default — nothing is recorded until a practice opts in", () => {
    expect(SIGNALS_ENABLED_BY_DEFAULT).toBe(false);
    const state = enqueue(emptyQueue(), ping());
    expect(state.pending).toEqual([]);
  });

  it("queues once enabled", () => {
    const state = enqueue({ ...emptyQueue(), enabled: true }, ping());
    expect(state.pending).toHaveLength(1);
  });

  it("never submits on the same cycle as a match", () => {
    const state = { ...emptyQueue(), enabled: true, matchInFlight: true, pending: [ping()] };
    expect(shouldSubmit(state, AT)).toBe(false);
  });

  it("submits weekly, not sooner", () => {
    const submitted = markSubmitted({ ...emptyQueue(), enabled: true, pending: [ping()] }, AT);
    const withMore = enqueue(submitted, ping());
    expect(shouldSubmit(withMore, new Date(AT.getTime() + 6 * 86_400_000))).toBe(false);
    expect(shouldSubmit(withMore, new Date(AT.getTime() + 7 * 86_400_000))).toBe(true);
  });

  it("submitting clears the queue", () => {
    expect(markSubmitted({ ...emptyQueue(), enabled: true, pending: [ping(), ping()] }, AT).pending).toEqual([]);
  });

  it("has nothing to send when nothing is queued", () => {
    expect(shouldSubmit({ ...emptyQueue(), enabled: true }, AT)).toBe(false);
  });
});

describe("batch ingest", () => {
  it("has no bulk path that skips validation", () => {
    const store = new SignalStore();
    expect(() => ingestBatch(store, [ping(), { ...ping(), postcode: "3000" }], AT)).toThrow();
  });
});
