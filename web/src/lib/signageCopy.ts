/** TV 모니터용 한글 설명 — scene_id·reason 토큰 */

export const EMOTION_KO: Record<string, string> = {
  calm: "잔잔함",
  neutral: "평온·중립",
  active: "호기심·활동",
  stressed: "긴장·피로감",
};

export const SCENE_DETAIL: Record<
  string,
  { title: string; light: string; sound: string; mood: string }
> = {
  calm_gallery: {
    title: "잔잔한 갤러리",
    light: "낮은 밝기, 따뜻한 색온도로 여백과 관람에 집중",
    sound: "잔잔한 앰비언트",
    mood: "한산하거나 조용할 때의 안정적인 무드",
  },
  dense_flux: {
    title: "동선·에너지",
    light: "밝은 조도, 선명한 색온도로 활기 전달",
    sound: "사람·소음의 밀도를 느끼는 트랙",
    mood: "소음이 크거나 관람객이 많을 때",
  },
  critical_focus: {
    title: "단면·구조 집중",
    light: "단면과 도면 읽기에 맞는 차분한 집중광",
    sound: "리듬감 있는 포커스용 사운드",
    mood: "관람 중·호기심 있을 때 단면을 읽게 하는 무드",
  },
  night_reflect: {
    title: "완충·반사",
    light: "낮은 밝기, 따뜻한 톤으로 피로 완화",
    sound: "낮은 볼륨의 여운 있는 사운드",
    mood: "긴장·피로 신호가 있을 때",
  },
  safe_neutral: {
    title: "안전 기본",
    light: "중간 밝기의 안전 기본 조명",
    sound: "무음 또는 최소",
    mood: "폴백·안전 상태",
  },
  floor_pin_1: {
    title: "존 하이라이트 (핀 1)",
    light: "선택 구역만 조명 강조",
    sound: "포커스 계열",
    mood: "관람객이 도면에서 구역을 선택함",
  },
  floor_pin_2: {
    title: "존 하이라이트 (핀 2)",
    light: "선택 구역만 조명 강조",
    sound: "에너지 계열",
    mood: "관람객이 도면에서 구역을 선택함",
  },
  floor_pin_3: {
    title: "존 하이라이트 (핀 3)",
    light: "선택 구역만 조명 강조",
    sound: "잔잔한 계열",
    mood: "관람객이 도면에서 구역을 선택함",
  },
  floor_pin_4: {
    title: "존 하이라이트 (핀 4)",
    light: "선택 구역만 조명 강조",
    sound: "저반사 계열",
    mood: "관람객이 도면에서 구역을 선택함",
  },
  floor_pin_5: {
    title: "존 하이라이트 (핀 5)",
    light: "선택 구역만 조명 강조",
    sound: "에너지 계열",
    mood: "관람객이 도면에서 구역을 선택함",
  },
  floor_pin_6: {
    title: "존 하이라이트 (핀 6)",
    light: "선택 구역만 조명 강조",
    sound: "잔잔한 계열",
    mood: "관람객이 도면에서 구역을 선택함",
  },
};

export function describeReason(reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes("auto:loud")) return "전시장 소음이 설정된 기준 이상이라, 활기 있는 조명·사운드로 맞추고 있습니다.";
  if (r.includes("auto:crowd")) return "카메라 기준 관람 인원이 많아 혼잡 무드(동선·에너지)로 전환했습니다.";
  if (r.includes("auto:stressed")) return "표정·신호가 피로·긴장 쪽으로 보여 저조도·완충 무드입니다.";
  if (r.includes("auto:active")) return "호기심·활동 신호가 있어 단면 읽기에 맞는 집중광입니다.";
  if (r.includes("auto:calm_sparse")) return "한산하고 매우 조용해 갤러리형 잔잔한 무드입니다.";
  if (r.includes("auto:calm_group")) return "소규모 그룹이 여유 있게 관람 중인 것으로 보아 잔잔한 무드를 유지합니다.";
  if (r.includes("auto:neutral_browse")) return "평균적인 관람 상태로, 단면·구조를 읽도록 돕는 무드입니다.";
  if (r.includes("auto:default")) return "위 규칙에 딱 맞지 않아 기본 잔잔 무드로 유지합니다.";
  if (r.includes("sensor")) return "마이크·비전으로 갱신된 전시장 상태를 반영했습니다.";
  if (r.includes("visitor idle")) return "관람객 수동 조작 시간이 지나 다시 전시장 연동 자동 씬으로 돌아왔습니다.";
  if (r.includes("floor_hotspot") || r.includes("exhibit_floor")) return "태블릿 도면에서 특정 구역을 선택해 존별 조명을 적용 중입니다.";
  if (r.includes("manual")) return "운영자 또는 제어 화면에서 수동 값이 적용되었습니다.";
  if (r.includes("override")) return "시나리오 오버라이드가 적용되었습니다.";
  return `적용 사유: ${reason}`;
}
