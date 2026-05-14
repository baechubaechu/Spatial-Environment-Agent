"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  /** 같은 출처 경로 (예: /floor-plan.pdf) */
  src: string;
};

/**
 * iframe/embed 대신 PDF.js로 첫 페이지를 그립니다.
 * 태블릿·모바일 Chrome 등에서는 내장 PDF 뷰어가 iframe 에 안 붙는 경우가 많습니다.
 */
export function FloorPlanPdfCanvas({ src }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderSeq = useRef(0);
  const layoutRetries = useRef(0);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const renderPdf = useCallback(async () => {
    const seq = ++renderSeq.current;
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const cw = wrap.clientWidth;
    const ch = wrap.clientHeight;
    if (cw < 12 || ch < 12) {
      if (layoutRetries.current < 40) {
        layoutRetries.current += 1;
        requestAnimationFrame(() => void renderPdf());
      } else {
        setStatus("error");
        setErrorMsg("도면 영역 크기를 읽을 수 없습니다. 창 크기를 조정해 보세요.");
      }
      return;
    }
    layoutRetries.current = 0;

    setStatus("loading");

    try {
      const pdfUrl = typeof window !== "undefined" ? new URL(src, window.location.origin).href : src;
      let probe = await fetch(pdfUrl, { method: "HEAD", cache: "no-store" });
      if (probe.status === 405 || probe.status === 501) {
        probe = await fetch(pdfUrl, { method: "GET", cache: "no-store", headers: { Range: "bytes=0-0" } });
      }
      if (!probe.ok) {
        throw new Error(
          probe.status === 404
            ? `파일 없음(404): ${src} — web/public/floor-plan.pdf 이름·위치 확인`
            : `PDF 확인 실패 HTTP ${probe.status}`,
        );
      }

      const { getDocument, GlobalWorkerOptions } = await import("pdfjs-dist");
      if (typeof window !== "undefined") {
        GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
      } else {
        GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      }

      const loadingTask = getDocument(pdfUrl);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);

      if (seq !== renderSeq.current || !wrapRef.current || !canvasRef.current) return;

      const baseVp = page.getViewport({ scale: 1 });
      const fitScale = Math.min(cw / baseVp.width, ch / baseVp.height);
      const dpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
      const viewport = page.getViewport({ scale: fitScale * dpr });

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${viewport.width / dpr}px`;
      canvas.style.height = `${viewport.height / dpr}px`;

      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas 2d 컨텍스트를 열 수 없습니다.");

      ctx.fillStyle = "#f5f3ef";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await page.render({ canvasContext: ctx, viewport }).promise;

      if (seq !== renderSeq.current) return;
      setStatus("ready");
      setErrorMsg("");
    } catch (e) {
      if (seq !== renderSeq.current) return;
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }, [src]);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (!cancelled) void renderPdf();
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
    return () => {
      cancelled = true;
    };
  }, [renderPdf]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      if (t) clearTimeout(t);
      t = setTimeout(() => void renderPdf(), 100);
    });
    ro.observe(wrap);
    return () => {
      ro.disconnect();
      if (t) clearTimeout(t);
    };
  }, [renderPdf]);

  return (
    <div ref={wrapRef} className="xfloor-pdf-canvas-wrap">
      {status === "loading" && (
        <div className="xfloor-pdf-loading" aria-live="polite">
          도면 불러오는 중…
        </div>
      )}
      {status === "error" && (
        <div className="xfloor-pdf-error">
          <p>PDF를 이 화면에 표시할 수 없습니다.</p>
          <p className="xfloor-pdf-error-detail">{errorMsg}</p>
          <a className="xfloor-pdf-open-tab" href={src} target="_blank" rel="noreferrer">
            새 탭에서 열기
          </a>
        </div>
      )}
      <canvas ref={canvasRef} className="xfloor-pdf-canvas" aria-hidden={status !== "ready"} />
    </div>
  );
}
