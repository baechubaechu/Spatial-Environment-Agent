"use client";

import { EXHIBIT_HOST_AUDIO_DEVICE_ID, EXHIBIT_HOST_VIDEO_DEVICE_ID } from "@/lib/exhibitCaptureConfig";
import { EXHIBIT_POLL_INTERVAL_MS } from "@/lib/exhibitEventBusConstants";
import { EXHIBIT_PREVIEW_PUSH_MS } from "@/lib/exhibitPreviewTiming";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export type HallEmotion = "calm" | "neutral" | "active" | "stressed";

const ENABLE_VISION_RUNTIME = process.env.NEXT_PUBLIC_ENABLE_VISION_RUNTIME === "true";
/** 비전 API와 별개: 태블릿 카메라만 열고 `/signage`용 JPEG 프레임만 업로드 */
const ENABLE_EXHIBIT_CAMERA_PREVIEW =
  process.env.NEXT_PUBLIC_ENABLE_EXHIBIT_CAMERA_PREVIEW === "true";
const ENABLE_TABLET_CAMERA = ENABLE_VISION_RUNTIME || ENABLE_EXHIBIT_CAMERA_PREVIEW;
const VISION_API_URL = process.env.NEXT_PUBLIC_VISION_API_URL ?? "http://localhost:8000/analyze";

export function classifyHallEmotion(inputPeople: number, inputDecibel: number): HallEmotion {
  const crowding = Math.min(inputPeople / 6, 1);
  const noiseScore = inputDecibel >= 75 ? 1 : inputDecibel >= 62 ? 0.8 : inputDecibel >= 48 ? 0.5 : 0.25;
  if (inputPeople === 0) return "calm";
  if (noiseScore >= 0.8) return "stressed";
  if (crowding < 0.35 && noiseScore <= 0.4) return "active";
  return "neutral";
}

export type HallCaptureProfile = "tablet" | "host";

export function useHallLiveSensors(options: {
  enabled: boolean;
  busPeopleFallback: number;
  publishSensor: (people: number, decibel: number, emotion?: HallEmotion) => Promise<void>;
  videoRef: RefObject<HTMLVideoElement | null>;
  /** 태블릿 전면카메라 vs 노트북 USB 웹캠 */
  captureProfile: HallCaptureProfile;
}) {
  const { enabled, busPeopleFallback, publishSensor, videoRef, captureProfile } = options;
  const [avgDecibel, setAvgDecibel] = useState(40);
  const [micLevel, setMicLevel] = useState(0);
  const [lineHint, setLineHint] = useState("전시장 소리·영상을 읽는 중…");

  const avgRef = useRef(40);
  const busPeopleRef = useRef(busPeopleFallback);
  const visionBusyRef = useRef(false);

  useEffect(() => {
    avgRef.current = avgDecibel;
  }, [avgDecibel]);

  useEffect(() => {
    busPeopleRef.current = busPeopleFallback;
  }, [busPeopleFallback]);

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
        emotion_state?: HallEmotion;
      };
    } finally {
      visionBusyRef.current = false;
    }
  }, [videoRef]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    let cancelled = false;
    let raf = 0;
    let stream: MediaStream | null = null;
    let ac: AudioContext | null = null;

    const stop = () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void ac?.close();
      ac = null;
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const run = async () => {
      try {
        const audioConstraint: boolean | MediaTrackConstraints =
          captureProfile === "host" && EXHIBIT_HOST_AUDIO_DEVICE_ID
            ? { deviceId: { exact: EXHIBIT_HOST_AUDIO_DEVICE_ID } }
            : true;

        const videoConstraint: boolean | MediaTrackConstraints =
          !ENABLE_TABLET_CAMERA
            ? false
            : captureProfile === "tablet"
              ? { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }
              : EXHIBIT_HOST_VIDEO_DEVICE_ID
                ? {
                    deviceId: { exact: EXHIBIT_HOST_VIDEO_DEVICE_ID },
                    width: { ideal: 1280 },
                    height: { ideal: 720 },
                  }
                : { width: { ideal: 1280 }, height: { ideal: 720 } };

        stream = await navigator.mediaDevices.getUserMedia({
          audio: audioConstraint,
          video: videoConstraint,
        });
        if (cancelled) {
          stop();
          return;
        }
        if (ENABLE_TABLET_CAMERA && videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play().catch(() => {});
        }

        ac = new AudioContext();
        if (ac.state === "suspended") {
          await ac.resume();
        }
        if (cancelled) {
          stop();
          return;
        }
        const src = ac.createMediaStreamSource(stream);
        const an = ac.createAnalyser();
        an.fftSize = 2048;
        src.connect(an);
        const buf = new Float32Array(an.fftSize);
        const loop = () => {
          if (cancelled) return;
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          const rms = Math.sqrt(s / buf.length);
          setMicLevel(rms);
          const db = 20 + Math.min(75, Math.max(0, rms * 130));
          setAvgDecibel(db);
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
        if (!cancelled) {
          setLineHint(
            !ENABLE_TABLET_CAMERA
              ? "마이크로 전시장 소음을 읽는 중입니다."
              : captureProfile === "host"
                ? "호스트 웹캠·마이크로 전시장 영상·소음을 읽는 중입니다."
                : "태블릿 마이크·카메라로 전시장을 읽는 중입니다.",
          );
        }
      } catch {
        if (!cancelled) {
          setLineHint("마이크(·카메라) 권한이 없습니다. 수동 장면을 쓰거나 브라우저 설정을 확인해 주세요.");
        }
        stop();
      }
    };

    void run();
    return stop;
  }, [enabled, videoRef, captureProfile]);

  useEffect(() => {
    if (!enabled) return;
    let dead = false;
    const id = window.setInterval(() => {
      const db = Number(avgRef.current.toFixed(1));
      const noise01 = Math.max(0, Math.min(1, (db - 20) / 75));
      void (async () => {
        try {
          let people = busPeopleRef.current;
          let emotion: HallEmotion | undefined;
          if (ENABLE_VISION_RUNTIME) {
            try {
              const analyzed = await analyzeWithVisionApi(noise01);
              if (dead) return;
              if (typeof analyzed?.people_count === "number") people = analyzed.people_count;
              emotion = analyzed?.emotion_state;
            } catch {
              /* 비전 실패 시 마이크·버스 폴백 */
            }
          }
          if (dead) return;
          const derived = classifyHallEmotion(people, db);
          await publishSensor(people, db, emotion ?? derived);
        } catch {
          /* 네트워크 등 */
        }
      })();
    }, EXHIBIT_POLL_INTERVAL_MS);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [enabled, publishSensor, analyzeWithVisionApi]);

  useEffect(() => {
    if (!enabled || !ENABLE_TABLET_CAMERA) return;
    let dead = false;
    let pushing = false;
    const pushPreview = async () => {
      if (pushing || dead) return;
      const v = videoRef.current;
      if (!v || v.videoWidth <= 0 || dead) return;
      pushing = true;
      try {
        const canvas = document.createElement("canvas");
        const w = Math.min(640, v.videoWidth);
        const h = Math.max(1, Math.round((w / v.videoWidth) * v.videoHeight));
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0, w, h);
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", 0.52);
        });
        if (!blob || dead) return;
        const fd = new FormData();
        fd.append("frame", blob, "preview.jpg");
        try {
          await fetch("/api/exhibit/preview-frame", { method: "POST", body: fd });
        } catch {
          /* 네트워크 등 — TV 프리뷰만 건너뜀 */
        }
      } finally {
        pushing = false;
      }
    };
    void pushPreview();
    const id = window.setInterval(() => void pushPreview(), EXHIBIT_PREVIEW_PUSH_MS);
    return () => {
      dead = true;
      window.clearInterval(id);
    };
  }, [enabled, videoRef]);

  return { avgDecibel, micLevel, lineHint };
}
