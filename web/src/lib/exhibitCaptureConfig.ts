/** sensor.state·프리뷰 스트림을 태블릿에서 잡을지, 노트북 웹캠에서 잡을지 */
export type ExhibitCaptureSource = "tablet" | "host";

/**
 * 미설정 시 `host` — 전시 시 노트북 웹캠 + 호스트 페이지(`/host-exhibit-capture`) 사용.
 * 예전처럼 태블릿에서만 잡으려면 `NEXT_PUBLIC_EXHIBIT_CAPTURE_SOURCE=tablet`
 */
export const EXHIBIT_CAPTURE_SOURCE: ExhibitCaptureSource =
  process.env.NEXT_PUBLIC_EXHIBIT_CAPTURE_SOURCE === "tablet" ? "tablet" : "host";

const trimOrUndef = (v: string | undefined) => {
  const t = v?.trim();
  return t && t.length > 0 ? t : undefined;
};

/** 호스트 `getUserMedia` 비디오 `deviceId` (미설정이면 기본 USB 웹캠 등 시스템 기본) */
export const EXHIBIT_HOST_VIDEO_DEVICE_ID = trimOrUndef(process.env.NEXT_PUBLIC_EXHIBIT_HOST_VIDEO_DEVICE_ID);

/**
 * 호스트 마이크 `deviceId` — 거의 쓸 일 없음.
 * 기본 권장: 웹캠 내장 마이크만 쓰고, Windows/macOS에서 해당 마이크를 **기본 입력**으로 두면 `audio: true`가 그걸 탑니다.
 * 노트북 내장 마이크 등 다른 장치가 잡힐 때만 여기에 웹캠 마이크의 deviceId를 넣어 고정합니다.
 */
export const EXHIBIT_HOST_AUDIO_DEVICE_ID = trimOrUndef(process.env.NEXT_PUBLIC_EXHIBIT_HOST_AUDIO_DEVICE_ID);
