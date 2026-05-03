import { NextRequest, NextResponse } from "next/server";
import { setExhibitPreview } from "@/lib/exhibitPreviewStore";

export const runtime = "nodejs";

/** 태블릿에서 넘어오는 카메라 미리보기 (multipart field `frame`) */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("frame");
    if (!(file instanceof Blob)) {
      return NextResponse.json({ ok: false, error: "frame 필드 필요" }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > 900_000) {
      return NextResponse.json({ ok: false, error: "이미지 너무 큼" }, { status: 413 });
    }
    const mime = file.type || "image/jpeg";
    setExhibitPreview(mime, buf.toString("base64"));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "처리 실패" }, { status: 400 });
  }
}
