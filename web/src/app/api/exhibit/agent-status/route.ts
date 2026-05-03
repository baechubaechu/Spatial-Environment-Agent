import { NextResponse } from "next/server";

export const runtime = "nodejs";

const AGENT_BASE = process.env.EXHIBITION_AGENT_BASE_URL ?? "http://127.0.0.1:8000";

/** 호스트에서 uvicorn /status 를 서버 사이드로 가져와 TV 페이지가 쓰도록 함 */
export async function GET() {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 4000);
  try {
    const r = await fetch(`${AGENT_BASE.replace(/\/$/, "")}/status`, {
      cache: "no-store",
      signal: ctrl.signal,
    });
    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `agent ${r.status}`, agentBase: AGENT_BASE },
        { status: 502 },
      );
    }
    const body = (await r.json()) as Record<string, unknown>;
    return NextResponse.json({ ok: true, agent: body, agentBase: AGENT_BASE });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, agentBase: AGENT_BASE }, { status: 503 });
  } finally {
    clearTimeout(to);
  }
}
