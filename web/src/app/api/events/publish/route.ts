import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eventTopicSchema, topicPayloadSchemas } from "@/lib/eventContracts";
import { eventBus } from "@/lib/eventBus";

export const runtime = "nodejs";

const publishSchema = z.object({
  topic: eventTopicSchema,
  payload: z.unknown(),
  sessionId: z.string().min(1).max(200).optional(),
  source: z.string().min(1).max(120).optional(),
  ttlMs: z.number().int().min(1000).max(15 * 60_000).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof publishSchema>;
  try {
    body = publishSchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 본문" }, { status: 400 });
  }

  const schema = topicPayloadSchemas[body.topic];
  const parsedPayload = schema.safeParse(body.payload);
  if (!parsedPayload.success) {
    return NextResponse.json(
      { error: "payload 형식이 topic과 맞지 않습니다.", detail: parsedPayload.error.flatten() },
      { status: 400 },
    );
  }

  const event = eventBus.publish(body.topic, parsedPayload.data as never, {
    sessionId: body.sessionId,
    source: body.source ?? "control-ui",
    ttlMs: body.ttlMs,
  });

  return NextResponse.json({ ok: true, event });
}
