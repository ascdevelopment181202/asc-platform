import "server-only";
import QRCode from "qrcode";

/** An SVG QR code (dark modules in the given colour), sized by the container. */
export async function qrSvg(text: string, color = "#111111") {
  const svg = await QRCode.toString(text, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: color, light: "#ffffff" } });
  return svg.replace("<svg ", '<svg width="100%" height="100%" ');
}
