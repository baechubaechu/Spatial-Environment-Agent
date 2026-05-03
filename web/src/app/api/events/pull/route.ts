import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eventTopicSchema } from "@/lib/eventContracts";
import { eventBus } from "@/lib/eventBus";

export const runtime = "nodejs";

const querySchema = z.object({
  after: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  topics: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const parsed = querySchema.safeParse({
    after: url.searchParams.get("after") ?? 0,
    limit: url.searchParams.get("limit") ?? 50,
    topics: url.searchParams.get("topics") ?? undefined,
  });

  if (!parsed.success) {
    return NextResponse.json({ error: "invalid query" }, { status: 400 });
  }

  let topics: z.infer<typeof eventTopicSchema>[] | undefined;
  if (parsed.data.topics) {
    const split = parsed.data.topics.split(",").map((t) => t.trim()).filter(Boolean);
    const checked = z.array(eventTopicSchema).safeParse(split);
    if (!checked.success) {
      return NextResponse.json({ error: "invalid topics" }, { status: 400 });
    }
    topics = checked.data;
  }

  const events = eventBus.pull(parsed.data.after, topics, parsed.data.limit);
  const lastSeq = events.length ? events[events.length - 1]!.seq : parsed.data.after;

  return NextResponse.json({
    items: events,
    nextAfter: lastSeq,
  });
}
