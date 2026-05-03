import Link from "next/link";
import ControlHomeClient from "../ControlHomeClient";

export default function ControlSandboxPage() {
  return (
    <>
      <div className="xfloor-devbanner">
        <Link href="/">← 전시 제어(분위기)로 돌아가기</Link>
        <span>센서·슬라이더 테스트용</span>
      </div>
      <ControlHomeClient />
    </>
  );
}
