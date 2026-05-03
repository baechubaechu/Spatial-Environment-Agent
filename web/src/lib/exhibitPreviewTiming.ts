/** LAN 전시 프리뷰로 현실적인 하한. 더 낮추면 JPEG 인코딩·POST가 다음 틱과 겹치기 쉬움 */
export const EXHIBIT_PREVIEW_INTERVAL_MIN_MS = 125;

const rawEnv = process.env.NEXT_PUBLIC_EXHIBIT_PREVIEW_INTERVAL_MS;
const parsed = rawEnv !== undefined && rawEnv !== "" ? Number(rawEnv) : EXHIBIT_PREVIEW_INTERVAL_MIN_MS;

/** 태블릿 업로드 간격 = `/signage` 폴링 간격과 동일하게 맞춤 */
export const EXHIBIT_PREVIEW_PUSH_MS = Math.max(
  EXHIBIT_PREVIEW_INTERVAL_MIN_MS,
  Number.isFinite(parsed) ? parsed : EXHIBIT_PREVIEW_INTERVAL_MIN_MS,
);
