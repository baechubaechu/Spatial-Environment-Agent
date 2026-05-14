/**
 * public/pdf.worker.min.mjs 를 설치된 pdfjs-dist 버전과 항상 동일하게 맞춤 (버전 불일치 시 PDF 렌더 실패 방지).
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const src = path.join(root, "node_modules", "pdfjs-dist", "build", "pdf.worker.min.mjs");
const dest = path.join(root, "public", "pdf.worker.min.mjs");

try {
  if (!fs.existsSync(src)) {
    console.warn("[sync-pdf-worker] skip: pdfjs-dist not installed yet");
    process.exit(0);
  }
  fs.copyFileSync(src, dest);
  console.log("[sync-pdf-worker] copied pdf.worker.min.mjs");
} catch (e) {
  console.warn("[sync-pdf-worker]", e.message);
  process.exit(0);
}
