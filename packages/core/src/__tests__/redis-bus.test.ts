import { describe, it, expect, afterEach } from "vitest";
import type { DomainEvent } from "../events/types";
import { RedisEventBus } from "../events/transports/redis";

const REDIS_URL = process.env.REDIS_URL;

const describeIf = REDIS_URL ? describe : describe.skip;

describeIf("RedisEventBus", () => {
  let bus1: RedisEventBus;
  let bus2: RedisEventBus;

  afterEach(async () => {
    if (bus1) await bus1.close();
    if (bus2) await bus2.close();
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
    bus1 = await RedisEventBus.create(REDIS_URL);
    bus2 = await RedisEventBus.create(REDIS_URL);

    const received: DomainEvent[] = [];
    bus2.subscribe("SubredditAdded", (event) => {
      received.push(event);
    });

    // Allow SUBSCRIBE to establish
    await new Promise((r) => setTimeout(r, 100));

    await bus1.publish(makeEvent("SubredditAdded", "test-redis"));

    // Wait for message delivery
    await new Promise((r) => setTimeout(r, 200));

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("SubredditAdded");
    expect(received[0]?.occurredAt).toBeInstanceOf(Date);
  });

  it("close() stops receiving events", async () => {
    bus1 = await RedisEventBus.create(REDIS_URL);
    bus2 = await RedisEventBus.create(REDIS_URL);

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
