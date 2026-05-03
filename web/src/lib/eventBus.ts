import { baseEnvelopeSchema, makeEventId, topicPayloadSchemas, type BusEvent, type EventTopic, type TopicPayloadMap } from "@/lib/eventContracts";
import { EVENT_BUS_MAX_STORED_EVENTS } from "@/lib/exhibitEventBusConstants";

type ServiceHeartbeat = {
  service: string;
  status: "ok" | "degraded" | "down";
  detail?: string;
  at: string;
};

class InMemoryEventBus {
  private seq = 0;
  private events: BusEvent[] = [];
  private maxEvents = EVENT_BUS_MAX_STORED_EVENTS;
  private latestByTopic = new Map<EventTopic, BusEvent>();
  private heartbeats = new Map<string, ServiceHeartbeat>();

  publish<T extends EventTopic>(
    topic: T,
    payload: TopicPayloadMap[T],
    options?: { sessionId?: string; source?: string; ttlMs?: number },
  ): BusEvent<T> {
    const payloadSchema = topicPayloadSchemas[topic];
    const safePayload = payloadSchema.parse(payload);
    const envelope = baseEnvelopeSchema.parse({
      eventId: makeEventId(),
      sessionId: options?.sessionId,
      source: options?.source ?? "unknown",
      timestamp: new Date().toISOString(),
      ttlMs: options?.ttlMs ?? 60_000,
    });

    const event = {
      seq: ++this.seq,
      topic,
      envelope,
      payload: safePayload,
    } as BusEvent<T>;

    this.events.push(event as BusEvent);
    this.latestByTopic.set(topic, event as BusEvent);
    if (this.events.length > this.maxEvents) {
      this.events.splice(0, this.events.length - this.maxEvents);
    }

    if (topic === "ops.heartbeat") {
      const hb = safePayload as TopicPayloadMap["ops.heartbeat"];
      this.heartbeats.set(hb.service, {
        service: hb.service,
        status: hb.status,
        detail: hb.detail,
        at: envelope.timestamp,
      });
    }

    return event;
  }

  pull(after = 0, topics?: EventTopic[], limit = 50): BusEvent[] {
    const clampedLimit = Math.min(200, Math.max(1, limit));
    const topicSet = topics?.length ? new Set(topics) : null;
    const now = Date.now();
    return this.events
      .filter((e) => e.seq > after)
      .filter((e) => !topicSet || topicSet.has(e.topic))
      .filter((e) => now - Date.parse(e.envelope.timestamp) <= e.envelope.ttlMs)
      .slice(0, clampedLimit);
  }

  latestState() {
    const latest = Object.fromEntries([...this.latestByTopic.entries()].map(([k, v]) => [k, v])) as Partial<
      Record<EventTopic, BusEvent>
    >;

    const heartbeatNow = Date.now();
    const services = [...this.heartbeats.values()].map((hb) => {
      const ageMs = heartbeatNow - Date.parse(hb.at);
      const stale = ageMs > 20_000;
      return {
        ...hb,
        ageMs,
        stale,
        effectiveStatus: stale ? "down" : hb.status,
      };
    });

    return {
      seq: this.seq,
      latest,
      services,
      queueSize: this.events.length,
    };
  }
}

const globalRef = globalThis as unknown as { __exhibitEventBus?: InMemoryEventBus };

export const eventBus = globalRef.__exhibitEventBus ?? new InMemoryEventBus();
if (!globalRef.__exhibitEventBus) {
  globalRef.__exhibitEventBus = eventBus;
}
