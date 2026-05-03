import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "전시 모니터 · 환경 연동",
  description: "전시장 카메라·마이크 기반 씬 상태 표시",
};

export default function SignageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
