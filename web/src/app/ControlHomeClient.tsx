"use client";

import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";
import { EVENT_BUS_MAX_STORED_EVENTS, EXHIBIT_POLL_INTERVAL_MS } from "@/lib/exhibitEventBusConstants";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Emotion = "calm" | "neutral" | "active" | "stressed";

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

const VISION_API_URL = process.env.NEXT_PUBLIC_VISION_API_URL ?? "http://localhost:8000/analyze";
const ENABLE_VISION_RUNTIME = process.env.NEXT_PUBLIC_ENABLE_VISION_RUNTIME === "true";
export default function ControlHomeClient() {
  const [peopleCount, setPeopleCount] = useState<number>(5);
  const [decibel, setDecibel] = useState<number>(40);
  const [emotionState, setEmotionState] = useState<Emotion>("neutral");
  const [strategyLabel, setStrategyLabel] = useState("observed_crowd");
  const [useRealInput, setUseRealInput] = useState(false);
  const [state, setState] = useState<EventStateResponse | null>(null);
  const [lastResult, setLastResult] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [avgDecibel, setAvgDecibel] = useState(40);
  const [decibelTouched, setDecibelTouched] = useState(false);
  const [visionStatus, setVisionStatus] = useState<string>("Vision 연동 대기");
  const [latestSensor, setLatestSensor] = useState<{
    peopleCount: number;
    decibel: number;
    emotionState: Emotion;
  } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const visionBusyRef = useRef(false);

  const peopleShown = useAnimatedNumber(peopleCount, 0, 560);
  const decibelShown = useAnimatedNumber(decibel, 1, 560);
  const avgDbShown = useAnimatedNumber(avgDecibel, 1, 480);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const res = await fetch("/api/events/state", { cache: "no-store" });
        if (!res.ok || !mounted) return;
        const j = (await res.json()) as EventStateResponse;
        setState(j);
        const sensor = j.latest?.["sensor.state"]?.payload;
        if (sensor) {
          const nextSensor = {
            peopleCount: typeof sensor.peopleCount === "number" ? sensor.peopleCount : 0,
            decibel: typeof sensor.decibel === "number" ? sensor.decibel : 45,
            emotionState:
              typeof sensor.emotionState === "string" &&
              ["calm", "neutral", "active", "stressed"].includes(sensor.emotionState)
                ? (sensor.emotionState as Emotion)
                : "neutral",
          };
          setLatestSensor(nextSensor);
          if (useRealInput && typeof sensor.peopleCount === "number") setPeopleCount(sensor.peopleCount);
          if (useRealInput && typeof sensor.decibel === "number") setDecibel(sensor.decibel);
          if (
            useRealInput &&
            typeof sensor.emotionState === "string" &&
            ["calm", "neutral", "active", "stressed"].includes(sensor.emotionState)
          ) {
            setEmotionState(sensor.emotionState as Emotion);
          }
        }
      } catch {
        /* ignore */
      }
    };

    void tick();
    const id = setInterval(() => {
      void tick();
    }, EXHIBIT_POLL_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [useRealInput]);

  const envHealth = useMemo(() => {
    const env = state?.services.find((s) => s.service === "exhibition-agent");
    if (!env) return "unknown";
    return env.effectiveStatus;
  }, [state]);

  const classifyStrategy = (inputPeople: number, inputDecibel: number) => {
    const crowding = Math.min(inputPeople / 6, 1);
    const noiseScore = inputDecibel >= 75 ? 1 : inputDecibel >= 62 ? 0.8 : inputDecibel >= 48 ? 0.5 : 0.25;
    if (inputPeople === 0) return { state: "idle", emotion: "calm" as Emotion };
    if (noiseScore >= 0.8) return { state: "managed_stress", emotion: "stressed" as Emotion };
    if (crowding < 0.35 && noiseScore <= 0.4) return { state: "algorithmic_activation", emotion: "active" as Emotion };
    return { state: "observed_crowd", emotion: "neutral" as Emotion };
  };

  const publishManual = async () => {
    setBusy(true);
    setLastResult("");
    try {
      const picked = classifyStrategy(peopleCount, decibel);
      setEmotionState(picked.emotion);
      setStrategyLabel(picked.state);
      const res = await fetch("/api/events/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic: "scenario.override",
          source: "control-ui",
          payload: {
            peopleCount,
            decibel,
            emotionState: picked.emotion,
            profileName: `manual-${picked.state}`,
          },
        }),
      });
      const text = await res.text();
      setLastResult(res.ok ? "값을 보냈습니다." : `Failed: ${text}`);
    } catch {
      setLastResult("Network error");
    } finally {
      setBusy(false);
    }
  };

  const publishLiveInput = useCallback(async (livePeople: number, liveDb: number, liveEmotion?: Emotion) => {
    const picked = classifyStrategy(livePeople, liveDb);
    const finalEmotion = liveEmotion ?? picked.emotion;
    setEmotionState(finalEmotion);
    setStrategyLabel(picked.state);
    const res = await fetch("/api/events/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "sensor.state",
        source: "control-ui-live-input",
        payload: {
          peopleCount: livePeople,
          decibel: liveDb,
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

  const analyzeWithVisionApi = useCallback(async (noise01: number) => {
    if (!videoRef.current || visionBusyRef.current) return null;
    visionBusyRef.current = true;
    try {
      const video = videoRef.current;
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return null;

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", 0.8);
      });
      if (!blob) return null;

      const formData = new FormData();
      formData.append("frame", blob, "frame.jpg");
      formData.append("noise_level", String(Math.max(0, Math.min(1, noise01))));

      const res = await fetch(VISION_API_URL, { method: "POST", body: formData });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `Vision API ${res.status}`);
      }
      return (await res.json()) as {
        people_count?: number;
        avg_scores?: { joy?: number; sorrow?: number; anger?: number; surprise?: number };
        emotion_state?: Emotion;
      };
    } finally {
      visionBusyRef.current = false;
    }
  }, []);

  const startSensors = useCallback(async () => {
    setMicLevel(0);
    setAvgDecibel(40);
  }, []);

  const stopSensors = useCallback(() => {
    if (rafRef.current) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close();
      audioCtxRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    void startSensors();
    return () => {
      stopSensors();
    };
  }, [startSensors, stopSensors]);

  useEffect(() => {
    if (decibelTouched || useRealInput) return;
    setDecibel(Number(avgDecibel.toFixed(1)));
  }, [avgDecibel, decibelTouched, useRealInput]);

  useEffect(() => {
    if (!useRealInput) return;
    const id = window.setInterval(() => {
      const liveDb = Number(avgDecibel.toFixed(1));
      const noise01 = Math.max(0, Math.min(1, (liveDb - 20) / 75));
      if (!ENABLE_VISION_RUNTIME) {
        const livePeople = latestSensor?.peopleCount ?? peopleCount;
        setPeopleCount(livePeople);
        setDecibel(liveDb);
        setVisionStatus("Vision 연동됨 (현재 OFF)");
        void publishLiveInput(livePeople, liveDb).catch(() => {});
        return;
      }

      void (async () => {
        try {
          const analyzed = await analyzeWithVisionApi(noise01);
          const livePeople =
            typeof analyzed?.people_count === "number"
              ? analyzed.people_count
              : (latestSensor?.peopleCount ?? peopleCount);
          setPeopleCount(livePeople);
          setDecibel(liveDb);
          setVisionStatus("Vision API 실시간 반영 중");
          void publishLiveInput(livePeople, liveDb, analyzed?.emotion_state).catch(() => {});
        } catch {
          setVisionStatus("Vision API 호출 실패 (OFF 모드로 확인 권장)");
        }
      })();
    }, EXHIBIT_POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [useRealInput, latestSensor?.peopleCount, peopleCount, avgDecibel, publishLiveInput, analyzeWithVisionApi]);

  const resetValues = async () => {
    setBusy(true);
    setLastResult("");
    try {
      const res = await fetch("/api/events/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetZone: "all", reason: "reset values" }),
      });
      const text = await res.text();
      setPeopleCount(5);
      setDecibelTouched(false);
      setDecibel(Number(avgDecibel.toFixed(1)));
      setEmotionState("neutral");
      setStrategyLabel("observed_crowd");
      setLastResult(res.ok ? "값을 초기화했습니다." : `Failed: ${text}`);
    } catch {
      setLastResult("Network error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="control-page">
      <section className="control-card">
        <header className="control-header">
          <div className="control-header-main">
            <p className="control-eyebrow">Exhibit control · dev</p>
            <h1>관람 시나리오 제어</h1>
          </div>
        </header>

        <p className="control-sub">
          전시 환경 반응을 시험하는 운영용 화면입니다. 여기서 설정한 상황값이 단면 모형(조명·향후 스피커) 쪽으로
          전달됩니다.
        </p>

        <div className="control-health">
          <span className="control-health-label">환경 서비스</span>
          <strong className={`control-health-pill control-health-pill--${envHealth}`}>{envHealth}</strong>
          <span
            className="control-health-queue"
            title={`최근 발행 이벤트가 메모리에 쌓인 건수(최대 ${EVENT_BUS_MAX_STORED_EVENTS}, 순환). 소비 대기열이 아닙니다.`}
          >
            버퍼 {state?.queueSize ?? 0}/{EVENT_BUS_MAX_STORED_EVENTS}
          </span>
        </div>

        <p className="control-helper">
          전략 상태 <span className="control-mono">{strategyLabel}</span> · 감정 판정{" "}
          <span className="control-mono">{emotionState}</span>
        </p>

        <div className="control-mode" role="tablist" aria-label="입력 모드">
          <button
            type="button"
            role="tab"
            aria-selected={!useRealInput}
            className={`control-mode-slat ${!useRealInput ? "is-active" : ""}`}
            disabled={busy}
            onClick={() => {
              if (!useRealInput) return;
              setUseRealInput(false);
              setLastResult("임의 입력 모드입니다.");
            }}
          >
            임의 입력
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={useRealInput}
            className={`control-mode-slat ${useRealInput ? "is-active" : ""}`}
            disabled={busy}
            onClick={() => {
              if (useRealInput) return;
              setUseRealInput(true);
              setLastResult(
                ENABLE_VISION_RUNTIME
                  ? "현실 입력 반영 (Vision ON)"
                  : "현실 입력 반영 (Vision 코드만 준비, OFF)",
              );
            }}
          >
            현실 입력 반영
          </button>
        </div>

        <div className="control-fields">
          <label className="control-field">
            <span className="control-field-label">관람 인원 (가정)</span>
            <span className="control-field-value">{peopleShown}</span>
            <input
              type="range"
              min={0}
              max={20}
              step={1}
              value={peopleCount}
              disabled={useRealInput}
              onChange={(e) => setPeopleCount(Number(e.target.value))}
            />
          </label>

          <label className="control-field">
            <span className="control-field-label">소음 수준 (dB, 가정)</span>
            <span className="control-field-value">{decibelShown.toFixed(1)}</span>
            <input
              type="range"
              min={20}
              max={95}
              step={0.5}
              value={decibel}
              disabled={useRealInput}
              onChange={(e) => {
                setDecibelTouched(true);
                setDecibel(Number(e.target.value));
              }}
            />
          </label>
        </div>

        <div className="control-actions">
          <button type="button" className="control-slat" onClick={publishManual} disabled={busy || useRealInput}>
            수동 값 발행
          </button>
          <button type="button" className="control-slat control-slat--ghost" onClick={resetValues} disabled={busy}>
            값 초기화
          </button>
        </div>

        <section className="control-live" aria-labelledby="control-live-heading">
          <h2 id="control-live-heading" className="control-live-title">
            센서·영상 (테스트)
          </h2>
          <div className="control-video-wrap">
            <div className="control-video control-video-placeholder">카메라 입력 비활성화 (테스트 모드)</div>
          </div>
          <div className="control-audio">
            <div className="control-audio-meta">마이크 평균 데시벨: {avgDbShown.toFixed(1)} dB</div>
            <div className="control-audio-meta">Vision: {visionStatus}</div>
            <div className="control-audio-bar">
              <span style={{ width: `${Math.min(100, Math.round(micLevel * 340))}%` }} />
            </div>
            <div className="control-audio-meta control-audio-meta--wrap">
              {!ENABLE_VISION_RUNTIME
                ? "Vision API는 배포 전 ON으로 전환하세요. 지금은 연동 코드만 준비된 상태입니다."
                : useRealInput
                  ? "영상·마이크 값을 제어 입력으로 반영 중입니다."
                  : "임의 입력 모드입니다. 필요 시 현실 입력 반영으로 전환하세요."}
            </div>
          </div>
        </section>

        {lastResult && <p className="control-result">{lastResult}</p>}
      </section>
    </main>
  );
}
