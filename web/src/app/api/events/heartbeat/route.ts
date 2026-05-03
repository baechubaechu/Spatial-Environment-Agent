import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eventBus } from "@/lib/eventBus";

export const runtime = "nodejs";

const schema = z.object({
  service: z.string().min(1).max(80),
  status: z.enum(["ok", "degraded", "down"]).default("ok"),
  detail: z.string().max(240).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof schema>;
  try {
    body = schema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "잘못된 본문" }, { status: 400 });
  }

  const event = eventBus.publish("ops.heartbeat", body, {
    source: body.service,
    ttlMs: 30_000,
  });

  return NextResponse.json({ ok: true, event });
}
