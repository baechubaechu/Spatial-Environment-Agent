import { NextResponse } from "next/server";
import { getExhibitPreview } from "@/lib/exhibitPreviewStore";

export const runtime = "nodejs";

export async function GET() {
  const p = getExhibitPreview();
  if (!p) {
    return NextResponse.json({ ok: true, updatedAt: null, dataUrl: null });
  }
  return NextResponse.json({
    ok: true,
    updatedAt: p.updatedAt,
    dataUrl: `data:${p.mime};base64,${p.base64}`,
  });
}
