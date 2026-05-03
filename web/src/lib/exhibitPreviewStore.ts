/** 태블릿→호스트 TV 프리뷰 (메모리, 단일 최신 프레임). */

export type ExhibitPreviewSlot = {
  mime: string;
  base64: string;
  updatedAt: number;
};

let slot: ExhibitPreviewSlot | null = null;

export function setExhibitPreview(mime: string, base64: string): void {
  slot = { mime, base64, updatedAt: Date.now() };
}

export function getExhibitPreview(): ExhibitPreviewSlot | null {
  return slot;
}
