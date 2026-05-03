"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FloorPlanPdfCanvas } from "@/components/FloorPlanPdfCanvas";
import { classifyHallEmotion, useHallLiveSensors, type HallEmotion } from "@/hooks/useHallLiveSensors";
import { EXHIBIT_CAPTURE_SOURCE } from "@/lib/exhibitCaptureConfig";
import { EVENT_BUS_MAX_STORED_EVENTS, EXHIBIT_POLL_INTERVAL_MS } from "@/lib/exhibitEventBusConstants";

const HOST_REMOTE_SENSORS = EXHIBIT_CAPTURE_SOURCE === "host";

/** 에이전트 `MANUAL_SCENE_AUTO_RESUME_SEC` 기본값(초)과 맞춤 */
const MANUAL_RESUME_SEC = 120;

type EventStateResponse = {
  seq: number;
  queueSize: number;
  services: Array<{
    service: string;
    status: "ok" | "degraded" | "down";
    effectiveStatus: "ok" | "degraded" | "down";
    detail?: string;
    at: string;
    ageMs: number;
    stale: boolean;
  }>;
  latest: Partial<Record<string, { payload: Record<string, unknown>; envelope: { timestamp: string } }>>;
};

type FloorHotspot = {
  id: string;
  label: string;
  sceneId: string;
  targetZone: "zoneA" | "zoneB";
  topPct: number;
  leftPct: number;
};

/** 도면 위 위치(%). 필요하면 숫자만 조정해 배치를 옮기면 됩니다. */
const HOTSPOTS: FloorHotspot[] = [
  { id: "h1", label: "전실", sceneId: "floor_pin_1", targetZone: "zoneA", topPct: 14, leftPct: 78 },
  { id: "h2", label: "코어", sceneId: "floor_pin_2", targetZone: "zoneA", topPct: 38, leftPct: 52 },
  { id: "h3", label: "동선", sceneId: "floor_pin_3", targetZone: "zoneB", topPct: 22, leftPct: 28 },
  { id: "h4", label: "후면", sceneId: "floor_pin_4", targetZone: "zoneB", topPct: 58, leftPct: 72 },
  { id: "h5", label: "코너", sceneId: "floor_pin_5", targetZone: "zoneA", topPct: 62, leftPct: 22 },
  { id: "h6", label: "여백", sceneId: "floor_pin_6", targetZone: "zoneB", topPct: 78, leftPct: 48 },
];

export default function ExhibitFloorClient() {
  const [state, setState] = useState<EventStateResponse | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string>("");
  const [lastHotspotId, setLastHotspotId] = useState<string | null>(null);
  /** 기본: 전시장 마이크·센서(환경 변수) 반영. 도면 핀 클릭 시 수동 후 타이머로 복귀 */
  const [hallSource, setHallSource] = useState<"live" | "manual">("live");
  const [manualEndsAt, setManualEndsAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearResumeTimer = useCallback(() => {
    if (resumeTimerRef.current !== null) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const tickPoll = async () => {
      try {
        const res = await fetch("/api/events/state", { cache: "no-store" });
        if (!res.ok || !mounted) return;
        setState((await res.json()) as EventStateResponse);
      } catch {
        /* ignore */
      }
    };
    void tickPoll();
    const id = setInterval(() => void tickPoll(), EXHIBIT_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (hallSource !== "manual" || manualEndsAt === null) return;
    const id = window.setInterval(() => setTick((t) => t + 1), EXHIBIT_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [hallSource, manualEndsAt]);

  const envSvc = useMemo(() => state?.services.find((s) => s.service === "exhibition-agent"), [state]);

  const envSummary = useMemo(() => {
    if (!envSvc) {
      return { pill: "unknown" as const, line: "에이전트 하트비트 없음(이벤트 브리지·에이전트 기동 확인)." };
    }
    const sec = Math.max(0, Math.round(envSvc.ageMs / 1000));
    const staleNote = envSvc.stale ? " · 신호 지연" : "";
    const detail = envSvc.detail ? ` · ${envSvc.detail}` : "";
    return {
      pill: envSvc.effectiveStatus,
      line: `마지막 보고 ${sec}초 전${staleNote}${detail}`,
    };
  }, [envSvc]);

  const manualRemainingSec = useMemo(() => {
    void tick;
    if (manualEndsAt === null) return null;
    return Math.max(0, Math.ceil((manualEndsAt - Date.now()) / 1000));
  }, [manualEndsAt, tick]);

  const busPeopleFallback = useMemo(() => {
    const s = state?.latest?.["sensor.state"]?.payload;
    if (s && typeof s.peopleCount === "number") return Math.min(300, Math.max(0, s.peopleCount));
    return 5;
  }, [state]);

  const sensorSnap = useMemo(() => {
    const p = state?.latest?.["sensor.state"]?.payload;
    if (!p) return null;
    return {
      decibel: typeof p.decibel === "number" ? p.decibel : null,
      peopleCount: typeof p.peopleCount === "number" ? p.peopleCount : null,
    };
  }, [state]);

  const publishSensor = useCallback(async (people: number, decibel: number, emotion?: HallEmotion) => {
    const derived = classifyHallEmotion(people, decibel);
    const finalEmotion = emotion ?? derived;
    const res = await fetch("/api/events/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "sensor.state",
        source: "control-exhibit-live",
        payload: {
          peopleCount: Math.min(300, Math.max(0, Math.round(people))),
          decibel: Math.min(160, Math.max(0, decibel)),
          emotionState: finalEmotion,
          occupancyZone: "all",
        },
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text);
    }
  }, []);

  const { avgDecibel, micLevel, lineHint } = useHallLiveSensors({
    enabled: hallSource === "live" && !HOST_REMOTE_SENSORS,
    busPeopleFallback,
    publishSensor,
    videoRef,
    captureProfile: "tablet",
  });

  const displayDecibel =
    HOST_REMOTE_SENSORS && hallSource === "live"
      ? sensorSnap?.decibel
      : avgDecibel;

  const resumeLiveHall = useCallback(() => {
    clearResumeTimer();
    setManualEndsAt(null);
    setHallSource("live");
    setToast("전시장 환경(마이크·센서) 기준으로 다시 반영합니다.");
  }, [clearResumeTimer]);

  const publishHotspot = useCallback(
    async (spot: FloorHotspot) => {
      setBusyId(spot.id);
      setToast("");
      setHallSource("manual");
      setLastHotspotId(spot.id);
      clearResumeTimer();
      const ends = Date.now() + MANUAL_RESUME_SEC * 1000;
      setManualEndsAt(ends);
      resumeTimerRef.current = setTimeout(() => {
        resumeTimerRef.current = null;
        setManualEndsAt(null);
        setHallSource("live");
        setToast("시간이 지나 전시장 환경 연동으로 돌아갔습니다.");
      }, MANUAL_RESUME_SEC * 1000);

      try {
        const res = await fetch("/api/events/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic: "scene.execute",
            source: "control-exhibit-floor-map",
            payload: {
              sceneId: spot.sceneId,
              reason: `floor_hotspot:${spot.id}`,
              holdSec: MANUAL_RESUME_SEC,
              targetZone: spot.targetZone,
            },
          }),
        });
        const text = await res.text();
        if (!res.ok) {
          setToast(text.slice(0, 120) || "전송에 실패했습니다.");
          clearResumeTimer();
          setManualEndsAt(null);
          setHallSource("live");
          return;
        }
        setToast(`「${spot.label}」존 조명을 보냈습니다. (${MANUAL_RESUME_SEC}초 후 자동 복귀)`);
      } catch {
        setToast("네트워크 오류입니다.");
        clearResumeTimer();
        setManualEndsAt(null);
        setHallSource("live");
      } finally {
        setBusyId(null);
      }
    },
    [clearResumeTimer],
  );

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(""), 5200);
    return () => window.clearTimeout(t);
  }, [toast]);

  useEffect(() => () => clearResumeTimer(), [clearResumeTimer]);

  return (
    <div className="xfloor-page">
      <video ref={videoRef} className="xfloor-hidden-video" playsInline muted autoPlay />

      <div className="xfloor-linear xfloor-linear--tl" aria-hidden="true" />
      <div className="xfloor-linear xfloor-linear--br" aria-hidden="true" />

      <div className="xfloor-inner xfloor-inner--wide">
        <header className="xfloor-header xfloor-header--split">
          <div>
            <p className="xfloor-kicker">Extra Space · 단면 모형</p>
            <h1 className="xfloor-title">공간 도면 · 존별 조명</h1>
            <p className="xfloor-lead">
              기본은 <strong>전시장 환경 연동</strong>
              {HOST_REMOTE_SENSORS ? (
                <>
                  (노트북 웹캠·마이크에서 올라오는 센서로 자동 씬)입니다.{" "}
                  <Link className="xfloor-devlink xfloor-devlink--header" href="/host-exhibit-capture">
                    호스트 캡처 페이지
                  </Link>
                  가 열려 있어야 합니다.
                </>
              ) : (
                <>
                  (마이크·센서로 자동 씬)입니다.
                </>
              )}{" "}
              도면의 점을 누르면 해당 구역만 하이라이트되고, <strong>{MANUAL_RESUME_SEC}초</strong> 뒤에는 다시 환경 연동으로 돌아갑니다.
            </p>
          </div>
          <Link className="xfloor-devlink xfloor-devlink--header" href="/sandbox">
            세부 테스트
          </Link>
        </header>

        <div className="xfloor-status xfloor-status--stack" aria-live="polite">
          <div className="xfloor-status-row">
            <span className="xfloor-status-label">환경 연동</span>
            <span className={`xfloor-pill xfloor-pill--${envSummary.pill}`}>{envSummary.pill}</span>
            <span className="xfloor-status-meta xfloor-status-meta--detail">{envSummary.line}</span>
          </div>
          <div className="xfloor-status-row">
            <span className="xfloor-status-meta">
              이벤트 버퍼 {state?.queueSize ?? 0}/{EVENT_BUS_MAX_STORED_EVENTS}
            </span>
            <span className="xfloor-status-meta xfloor-status-meta--dim">
              {hallSource === "live"
                ? typeof displayDecibel === "number"
                  ? `전시장 반영 중 · 약 ${displayDecibel.toFixed(0)} dB`
                  : HOST_REMOTE_SENSORS
                    ? "전시장 반영 중 · 호스트 입력 대기"
                    : `전시장 반영 중 · 약 ${avgDecibel.toFixed(0)} dB`
                : `존 수동 조명 · 자동 복귀까지 ${manualRemainingSec ?? 0}s`}
            </span>
          </div>
          {hallSource === "live" && !HOST_REMOTE_SENSORS && (
            <div className="xfloor-status-row xfloor-status-row--hint">{lineHint}</div>
          )}
          {hallSource === "live" && HOST_REMOTE_SENSORS && (
            <div className="xfloor-status-row xfloor-status-row--hint">
              영상·소음 입력은 노트북에서 <code className="xfloor-mono">/host-exhibit-capture</code> 를 연 브라우저가 보냅니다.
            </div>
          )}
        </div>

        <div className="xfloor-map-wrap">
          <FloorPlanPdfCanvas src="/floor-plan.pdf" />
          <div className="xfloor-map-overlay" role="presentation">
            {HOTSPOTS.map((spot) => (
              <button
                key={spot.id}
                type="button"
                className={`xfloor-hotspot ${lastHotspotId === spot.id ? "is-active" : ""}`}
                style={{ top: `${spot.topPct}%`, left: `${spot.leftPct}%` }}
                disabled={busyId !== null}
                aria-label={`${spot.label}, ${spot.targetZone === "zoneA" ? "A구역" : "B구역"} 조명`}
                title={`${spot.label} (${spot.targetZone})`}
                onClick={() => void publishHotspot(spot)}
              >
                <span className="xfloor-hotspot-dot" aria-hidden />
                <span className="xfloor-hotspot-label">{spot.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="xfloor-live-row">
          <button type="button" className="xfloor-live-corner" disabled={busyId !== null} onClick={resumeLiveHall}>
            지금 전시장 연동으로
          </button>
          {hallSource === "live" && !HOST_REMOTE_SENSORS && (
            <span className="xfloor-live-meter" aria-hidden="true">
              입력 {Math.min(100, Math.round(micLevel * 340))}%
            </span>
          )}
          {hallSource === "live" && HOST_REMOTE_SENSORS && (
            <span className="xfloor-live-meter">웹캠(내장 마이크) 기준 — 노트북 호스트</span>
          )}
        </div>

        <footer className="xfloor-map-caption">
          <p>
            <strong>동작 요약.</strong> 「환경 연동」은 이벤트 브리지에 등록된 <code className="xfloor-mono">exhibition-agent</code> 서비스의
            하트비트 상태입니다. 항상 <code className="xfloor-mono">ok</code>로 보일 수 있는데, 실제로는 위 줄의{" "}
            <strong>마지막 보고 N초 전</strong>·<strong>신호 지연</strong> 표시를 함께 보시면 됩니다. 버퍼 숫자는 메모리에 쌓인 최근 이벤트
            개수이며 소비 대기열 길이와는 다릅니다.
          </p>
          <p>
            <strong>도면 핀.</strong> 각 점은 미리 정해 둔 <code className="xfloor-mono">floor_pin_*</code> 씬과{" "}
            <code className="xfloor-mono">zoneA</code> 또는 <code className="xfloor-mono">zoneB</code>(모형 LED 스트립 절반)에 연결되어 있습니다.
            에이전트 쪽 타이머({MANUAL_RESUME_SEC}초)가 끝나면 <code className="xfloor-mono">sensor.state</code> 기반 자동 씬으로 덮어씁니다.
            {HOST_REMOTE_SENSORS
              ? " 센서 스트림은 노트북의 호스트 캡처 페이지에서 발행됩니다."
              : " 태블릿도 같은 시점에 「전시장 반영」으로 표시를 맞춥니다."}
          </p>
          <p className="xfloor-map-caption--muted">
            평면도 파일은 <code className="xfloor-mono">web/public/floor-plan.pdf</code> 에 두고, 표시는 브라우저 내장 PDF 대신{" "}
            <strong>PDF.js</strong>(캔버스 렌더)를 씁니다. 워커는 <code className="xfloor-mono">web/public/pdf.worker.min.mjs</code> 입니다.
            버튼 위치는 <code className="xfloor-mono">HOTSPOTS</code> 퍼센트만 수정하면 됩니다.
          </p>
        </footer>

        {toast && <p className="xfloor-toast">{toast}</p>}
      </div>
    </div>
  );
}
