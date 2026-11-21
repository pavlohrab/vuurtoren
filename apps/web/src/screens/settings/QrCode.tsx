/**
 * A QR code as an SVG, drawn from the modules `qrcode-generator` computes (MIT, no
 * dependencies; error correction M). Dark on white with a quiet zone, whatever the theme, so
 * every camera reads it.
 */
import qrcode from "qrcode-generator";
import { useMemo } from "react";

/** The dark modules of `text` as one SVG path, and the size in modules (with no margin). */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const size = qr.getModuleCount();
  let d = "";
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) if (qr.isDark(y, x)) d += `M${x} ${y}h1v1h-1z`;
  }
  return { size, d };
}

export function QrCode({ text, label, px = 224 }: { text: string; label: string; px?: number }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  const margin = 4;
  const box = size + margin * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={px}
      height={px}
      viewBox={`${-margin} ${-margin} ${box} ${box}`}
      shapeRendering="crispEdges"
      style={{ background: "#fff", borderRadius: 8, display: "block" }}
    >
      <rect x={-margin} y={-margin} width={box} height={box} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
