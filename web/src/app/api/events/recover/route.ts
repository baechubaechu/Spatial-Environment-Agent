import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eventBus } from "@/lib/eventBus";

export const runtime = "nodejs";

const schema = z.object({
  targetZone: z.enum(["zoneA", "zoneB", "all"]).default("all"),
  reason: z.string().min(1).max(120).default("manual recovery"),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 본문" }, { status: 400 });
  }

  const event = eventBus.publish(
    "scene.execute",
    {
      sceneId: "safe_neutral",
      reason: body.reason,
      holdSec: 60,
      targetZone: body.targetZone,
    },
    {
      source: "ops-panel",
      ttlMs: 90_000,
    },
  );

  return NextResponse.json({ ok: true, event });
}
