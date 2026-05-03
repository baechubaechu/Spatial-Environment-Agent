import { z } from "zod";

export const eventTopicSchema = z.enum([
  "sensor.state",
  "scenario.override",
  "chat.scene_hint",
  "scene.execute",
  "ops.heartbeat",
]);

export type EventTopic = z.infer<typeof eventTopicSchema>;

export const emotionStateSchema = z.enum(["calm", "neutral", "active", "stressed"]);

export const baseEnvelopeSchema = z.object({
  eventId: z.string().min(8),
  sessionId: z.string().min(1).max(200).optional(),
  source: z.string().min(1).max(120),
  timestamp: z.string().datetime(),
  ttlMs: z.number().int().min(1000).max(15 * 60_000).default(60_000),
});

export const sensorStatePayloadSchema = z.object({
  peopleCount: z.number().int().min(0).max(300),
  decibel: z.number().min(0).max(160),
  emotionState: emotionStateSchema,
  occupancyZone: z.enum(["zoneA", "zoneB", "all"]).default("all"),
});

export const scenarioOverridePayloadSchema = z.object({
  peopleCount: z.number().int().min(0).max(300).optional(),
  decibel: z.number().min(0).max(160).optional(),
  emotionState: emotionStateSchema.optional(),
  durationSec: z.number().int().min(5).max(3600).optional(),
  profileName: z.string().min(1).max(80).optional(),
  targetZone: z.enum(["zoneA", "zoneB", "all"]).optional(),
});

export const chatSceneHintPayloadSchema = z.object({
  intentTag: z.string().min(1).max(80),
  confidence: z.number().min(0).max(1),
  locale: z.enum(["ko", "en"]),
  messageSummary: z.string().min(1).max(300),
  targetZone: z.enum(["zoneA", "zoneB", "all"]).optional(),
});

export const sceneExecutePayloadSchema = z.object({
  sceneId: z.string().min(1).max(80),
  reason: z.string().min(1).max(200),
  holdSec: z.number().int().min(5).max(3600),
  targetZone: z.enum(["zoneA", "zoneB", "all"]).default("all"),
});

export const heartbeatPayloadSchema = z.object({
  service: z.string().min(1).max(80),
  status: z.enum(["ok", "degraded", "down"]).default("ok"),
  detail: z.string().max(240).optional(),
});

export type SensorStatePayload = z.infer<typeof sensorStatePayloadSchema>;
export type ScenarioOverridePayload = z.infer<typeof scenarioOverridePayloadSchema>;
export type ChatSceneHintPayload = z.infer<typeof chatSceneHintPayloadSchema>;
export type SceneExecutePayload = z.infer<typeof sceneExecutePayloadSchema>;
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;

export const topicPayloadSchemas = {
  "sensor.state": sensorStatePayloadSchema,
  "scenario.override": scenarioOverridePayloadSchema,
  "chat.scene_hint": chatSceneHintPayloadSchema,
  "scene.execute": sceneExecutePayloadSchema,
  "ops.heartbeat": heartbeatPayloadSchema,
} as const;

export type TopicPayloadMap = {
  "sensor.state": SensorStatePayload;
  "scenario.override": ScenarioOverridePayload;
  "chat.scene_hint": ChatSceneHintPayload;
  "scene.execute": SceneExecutePayload;
  "ops.heartbeat": HeartbeatPayload;
};

export type BusEvent<T extends EventTopic = EventTopic> = {
  seq: number;
  topic: T;
  envelope: z.infer<typeof baseEnvelopeSchema>;
  payload: TopicPayloadMap[T];
};

export function makeEventId(): string {
  const rnd = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${rnd}`;
}
