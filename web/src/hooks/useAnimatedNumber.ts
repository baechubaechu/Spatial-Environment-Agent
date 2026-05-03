import { useEffect, useRef, useState } from "react";

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 표시 숫자만 목표값으로 천천히 보간합니다.
 */
export function useAnimatedNumber(target: number, decimals: 0 | 1, durationMs = 520): number {
  const [display, setDisplay] = useState(target);
  const valueRef = useRef(target);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const from = valueRef.current;
    const to = target;
    if (decimals === 0 && Math.round(from) === Math.round(to)) return;
    if (decimals === 1 && Math.abs(from - to) < 0.02) return;

    cancelAnimationFrame(rafRef.current);
    const t0 = performance.now();

    const tick = (now: number) => {
      const p = smoothstep((now - t0) / durationMs);
      const raw = from + (to - from) * p;
      const next = decimals === 0 ? Math.round(raw) : Math.round(raw * 10) / 10;
      valueRef.current = next;
      setDisplay(next);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
      else valueRef.current = to;
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, decimals, durationMs]);

  return display;
}
