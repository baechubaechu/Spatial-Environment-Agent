"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { classifyHallEmotion, useHallLiveSensors, type HallEmotion } from "@/hooks/useHallLiveSensors";
import { EXHIBIT_CAPTURE_SOURCE } from "@/lib/exhibitCaptureConfig";
import { EXHIBIT_POLL_INTERVAL_MS } from "@/lib/exhibitEventBusConstants";

const CAPTURE_ON_HOST = EXHIBIT_CAPTURE_SOURCE === "host";

/** 노트북에서 웹캠·마이크로 sensor.state·프리뷰JPEG를 올리는 전용 페이지 */
export default function HostExhibitCaptureClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [busFallback, setBusFallback] = useState(5);

  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/events/state", { cache: "no-store" });
        if (!res.ok || !mounted) return;
        const j = (await res.json()) as {
          latest?: Partial<Record<string, { payload: Record<string, unknown> }>>;
        };
        const p = j.latest?.["sensor.state"]?.payload;
        const n = p?.peopleCount;
        if (typeof n === "number") setBusFallback(Math.min(300, Math.max(0, n)));
      } catch {
        /* ignore */
      }
    };
    void poll();
    const id = window.setInterval(() => void poll(), EXHIBIT_POLL_INTERVAL_MS);
    return () => {
      mounted = false;
      window.clearInterval(id);
    };
  }, []);

  const publishSensor = useCallback(async (people: number, decibel: number, emotion?: HallEmotion) => {
    const derived = classifyHallEmotion(people, decibel);
    const finalEmotion = emotion ?? derived;
    const res = await fetch("/api/events/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: "sensor.state",
        source: "control-exhibit-host-live",
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
    enabled: CAPTURE_ON_HOST,
    busPeopleFallback: busFallback,
    publishSensor,
    videoRef,
    captureProfile: "host",
  });

  return (
    <div className="host-cap-page">
      {!CAPTURE_ON_HOST && (
        <p className="host-cap-warn" role="alert">
          현재 <code className="xfloor-mono">NEXT_PUBLIC_EXHIBIT_CAPTURE_SOURCE=tablet</code> 입니다. 센서는 태블릿 도면 페이지에서만 올라가며, 여기서는 캡처를 시작하지 않습니다.
        </p>
      )}
      <header className="host-cap-head">
        <div>
          <p className="host-cap-kicker">내부 운영 · 호스트 PC만</p>
          <h1 className="host-cap-title">전시장 웹캠·마이크 캡처</h1>
          <p className="host-cap-lead">
            이 탭은 <strong>노트북(서버 호스트)</strong> 브라우저에서만 열어 두세요. USB 웹캠 영상으로 비전 분석·{" "}
            <code className="xfloor-mono">/signage</code> 프리뷰 JPEG가 올라갑니다. 소음 레벨도{" "}
            <strong>웹캠 내장 마이크</strong> 한 벌로 맞추는 구성을 권장합니다(OS 기본 입력을 웹캠 마이크로). 태블릿 도면 페이지는 카메라를 쓰지
            않습니다.
          </p>
        </div>
        <Link className="host-cap-link" href="/signage">
          사이니지 보기 →
        </Link>
      </header>

      <section className="host-cap-panel" aria-live="polite">
        <video ref={videoRef} className="host-cap-video" playsInline muted autoPlay />
        <div className="host-cap-meta">
          <p className="host-cap-hint">{lineHint}</p>
          <p className="host-cap-meter">
            소음 추정 <strong>{avgDecibel.toFixed(0)} dB</strong> · 마이크 레벨 {Math.min(100, Math.round(micLevel * 340))}%
          </p>
          <p className="host-cap-note">
            정리용 기본값: OS 설정에서 <strong>입력(마이크) 기본 장치 = 웹캠</strong>만 맞추면 됩니다. 브라우저가 노트북 내장 마이크를 잡는 경우에만{" "}
            <code className="xfloor-mono">NEXT_PUBLIC_EXHIBIT_HOST_AUDIO_DEVICE_ID</code> 로 웹캠 마이크를 고정하세요.
          </p>
        </div>
      </section>
    </div>
  );
}
