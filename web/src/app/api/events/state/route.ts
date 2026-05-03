import { NextResponse } from "next/server";
import { eventBus } from "@/lib/eventBus";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(eventBus.latestState());
}
