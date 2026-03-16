import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import pg from "pg";
import type { DomainEvent } from "../events/types";
import { PgNotifyEventBus } from "../events/transports/pg-notify";

const DATABASE_URL = process.env.DATABASE_URL;

// Skip integration tests when DB not available
const describeIf = DATABASE_URL ? describe : describe.skip;

describeIf("PgNotifyEventBus", () => {
  let pool: pg.Pool;
  let bus1: PgNotifyEventBus;
  let bus2: PgNotifyEventBus;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  });

  afterEach(async () => {
    if (bus1) await bus1.close();
    if (bus2) await bus2.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  function makeEvent(
    type: "SubredditAdded",
    name: string,
  ): DomainEvent & { type: "SubredditAdded" } {
    return {
      type: "SubredditAdded",
      payload: { subredditId: `sub-${name}`, name },
      aggregateId: `sub-${name}`,
      aggregateType: "subreddit",
      version: 1,
      correlationId: null,
      causationId: null,
      metadata: {},
      occurredAt: new Date(),
    };
  }

  it("delivers events between two bus instances", async () => {
    bus1 = await PgNotifyEventBus.create(pool);
    bus2 = await PgNotifyEventBus.create(pool);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    // Allow LISTEN to establish
    await new Promise((r) => setTimeout(r, 100));

    const event = makeEvent("SubredditAdded", "test-pg");
    await bus1.publish(event);

    // Wait for notification delivery
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("SubredditAdded");
    expect(received[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("does not deliver events for unsubscribed types", async () => {
    bus1 = await PgNotifyEventBus.create(pool);
    bus2 = await PgNotifyEventBus.create(pool);

    const received: DomainEvent[] = [];
    bus2.subscribe("DigestCompleted", (event) => {
      received.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));

    await bus1.publish(makeEvent("SubredditAdded", "no-match"));

    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });

  it("close() stops receiving events", async () => {
    bus1 = await PgNotifyEventBus.create(pool);
    bus2 = await PgNotifyEventBus.create(pool);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    await new Promise((r) => setTimeout(r, 100));
    await bus2.close();

    await bus1.publish(makeEvent("SubredditAdded", "after-close"));
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(0);
  });
});
