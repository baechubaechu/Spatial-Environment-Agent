"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EXHIBIT_CAPTURE_SOURCE } from "@/lib/exhibitCaptureConfig";
import { EXHIBIT_PREVIEW_PUSH_MS } from "@/lib/exhibitPreviewTiming";
import { EMOTION_KO, SCENE_DETAIL, describeReason } from "@/lib/signageCopy";

const PREVIEW_FROM_HOST = EXHIBIT_CAPTURE_SOURCE === "host";

type AgentSensor = {
  people_count?: number;
  decibel?: number;
  emotion_state?: string;
  occupancy_zone?: string;
};

type AgentDecision = {
  scene_id?: string;
  hold_sec?: number;
  target_zone?: string;
  reason?: string;
};

type AgentPayload = {
  last_sensor?: AgentSensor | null;
  last_decision?: AgentDecision | null;
  visitor_manual_lock?: boolean;
  visitor_manual_lock_remaining_sec?: number;
  last_updated?: string | null;
};

/** 캡처 쪽 `NEXT_PUBLIC_EXHIBIT_PREVIEW_INTERVAL_MS`와 동일 상수(기본 125ms) */
const PREVIEW_POLL_MS = EXHIBIT_PREVIEW_PUSH_MS;
const AGENT_POLL_MS = 1000;
const PREVIEW_STALE_MS = 15_000;

export default function SignageClient() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewAt, setPreviewAt] = useState<number | null>(null);
  const [agent, setAgent] = useState<AgentPayload | null>(null);
  const [staleTick, setStaleTick] = useState(0);
  const [agentErr, setAgentErr] = useState<string | null>(null);

  const pullPreview = useCallback(async () => {
    try {
      const res = await fetch("/api/exhibit/preview", { cache: "no-store" });
      const j = (await res.json()) as { ok?: boolean; dataUrl?: string | null; updatedAt?: number | null };
      if (j.dataUrl) {
        setPreviewUrl(j.dataUrl);
        setPreviewAt(typeof j.updatedAt === "number" ? j.updatedAt : Date.now());
      }
    } catch {
      /* ignore */
    }
  }, []);

  const pullAgent = useCallback(async () => {
    try {
      const res = await fetch("/api/exhibit/agent-status", { cache: "no-store" });
      const j = (await res.json()) as { ok?: boolean; agent?: AgentPayload; error?: string };
      if (j.ok && j.agent) {
        setAgent(j.agent);
        setAgentErr(null);
      } else {
        setAgentErr(j.error ?? "에이전트 응답 없음");
      }
    } catch (e) {
      setAgentErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void pullPreview();
    const i = window.setInterval(() => void pullPreview(), PREVIEW_POLL_MS);
    return () => clearInterval(i);
  }, [pullPreview]);

  useEffect(() => {
    void pullAgent();
    const i = window.setInterval(() => void pullAgent(), AGENT_POLL_MS);
    return () => clearInterval(i);
  }, [pullAgent]);

  useEffect(() => {
    const id = window.setInterval(() => setStaleTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const previewStale = useMemo(() => {
    if (previewAt === null) return true;
    return Date.now() - previewAt > PREVIEW_STALE_MS;
  }, [previewAt, staleTick]);

  const sensor = agent?.last_sensor;
  const decision = agent?.last_decision;
  const sceneId = decision?.scene_id ?? "safe_neutral";
  const detail = SCENE_DETAIL[sceneId] ?? SCENE_DETAIL.safe_neutral;

  const emotionKo = sensor?.emotion_state ? EMOTION_KO[sensor.emotion_state] ?? sensor.emotion_state : "—";

  const modeLine = agent?.visitor_manual_lock
    ? `태블릿 수동 조작 중 · 약 ${Math.ceil(agent.visitor_manual_lock_remaining_sec ?? 0)}초 뒤 자동 연동으로 복귀할 수 있음`
    : PREVIEW_FROM_HOST
      ? "전시장 웹캠·마이크 입력으로 자동 씬을 적용 중입니다."
      : "전시장 마이크·카메라 입력으로 자동 씬을 적용 중입니다.";

  return (
    <div className="signage-root">
      <header className="signage-top">
        <div>
          <p className="signage-kicker">Spatial Environment · 전시 모니터</p>
          <h1 className="signage-title">환경 연동 상태</h1>
        </div>
        <div className="signage-badge">{agent?.visitor_manual_lock ? "수동 / 존 선택" : "자동 연동"}</div>
      </header>

      <div className="signage-grid">
        <section className="signage-visual" aria-label={PREVIEW_FROM_HOST ? "호스트 웹캠 프리뷰" : "태블릿 카메라 프리뷰"}>
          <div className="signage-visual-inner">
            {previewUrl && !previewStale ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="signage-cam" />
            ) : (
              <div className="signage-cam-placeholder">
                <p>카메라 프리뷰 없음</p>
                <p className="signage-muted">
                  {PREVIEW_FROM_HOST ? (
                    <>
                      노트북에서 <code className="signage-scene-id">/host-exhibit-capture</code> 가 열려 웹캠 프리뷰가 올라오면, 약{" "}
                      {PREVIEW_POLL_MS}ms 간격으로 여기에 표시됩니다.
                    </>
                  ) : (
                    <>
                      태블릿에서 전시장 도면이 열려 카메라 프리뷰가 올라오면, 약 {PREVIEW_POLL_MS}ms 간격으로 여기에 표시됩니다.
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
          <p className="signage-caption">
            {PREVIEW_FROM_HOST
              ? "좌측: 노트북 웹캠에서 올리는 현장 프리뷰 · 호스트 부하에 따라 갱신 간격이 달라질 수 있습니다."
              : "좌측: 태블릿이 보내는 현장 카메라 프리뷰 · Wi-Fi 상황에 따라 갱신 간격이 달라질 수 있습니다."}
          </p>
        </section>

        <section className="signage-panel" aria-label="상황 설명">
          <div className="signage-panel-box">
            <h2 className="signage-h2">지금 모드</h2>
            <p className="signage-lead">{modeLine}</p>

            <h2 className="signage-h2">입력으로 파악한 전시장 상태</h2>
            <ul className="signage-metrics">
              <li>
                <span className="signage-metric-label">관람 인원(비전 추정)</span>
                <span className="signage-metric-val">{sensor?.people_count ?? "—"}</span>
              </li>
              <li>
                <span className="signage-metric-label">현장 소음(추정 dB)</span>
                <span className="signage-metric-val">
                  {sensor?.decibel !== undefined ? `${Number(sensor.decibel).toFixed(1)} dB` : "—"}
                </span>
              </li>
              <li>
                <span className="signage-metric-label">정서 신호</span>
                <span className="signage-metric-val">{emotionKo}</span>
              </li>
            </ul>

            <h2 className="signage-h2">적용 중인 씬</h2>
            <p className="signage-scene-title">{detail.title}</p>
            <p className="signage-scene-id">
              <code>{sceneId}</code>
              {decision?.target_zone ? (
                <>
                  {" "}
                  · 존 <code>{decision.target_zone}</code>
                </>
              ) : null}
            </p>

            <h3 className="signage-h3">왜 이런 씬인가요?</h3>
            <p className="signage-body">{decision?.reason ? describeReason(decision.reason) : "아직 적용 이력이 없거나 에이전트와 통신 중입니다."}</p>

            <h3 className="signage-h3">조명 · 오디오 연출</h3>
            <p className="signage-body">
              <strong>조명:</strong> {detail.light}
              <br />
              <strong>사운드:</strong> {detail.sound}
              <br />
              <strong>무드:</strong> {detail.mood}
            </p>

            {agent?.last_updated ? (
              <p className="signage-footer-meta">에이전트 마지막 갱신 · {agent.last_updated}</p>
            ) : null}
            {agentErr ? <p className="signage-error">에이전트 연결: {agentErr}</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
