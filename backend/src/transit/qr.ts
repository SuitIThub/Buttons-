/**
 * QR-Code als geräte-taugliches SVG (SVG Tiny 1.2, siehe MQTT-TOPICS-REFERENCE.md §6):
 * nur `viewBox` im Root-Tag, ausschließlich gefüllte Shapes mit `fill`.
 *
 * Der Code wird als weiße Fläche mit EINEM schwarzen Pfad aus horizontalen
 * Modul-Läufen gezeichnet (relative Moves) – deutlich kompakter als ein <rect>
 * pro Modul. Für eine GVH-URL (~145 Zeichen, 45×45 Module) sind das trotzdem
 * ~6 kB und damit mehr als der 2-kB-Richtwert der Referenz; ob das Gerät das
 * annimmt, prüft test-transit-qr.ts.
 */

import qrcode from "qrcode-generator";
import { TransitStop } from "../model.js";
import { berlinParts } from "./GvhClient.js";

/** Ruhezone um den Code in Modulen (Standard wäre 4; 2 reicht auf dunklem Display mit weißer Fläche). */
const QUIET_ZONE = 2;
/**
 * Obergrenze für SVGs, die ans Gerät gehen (Richtwert der MQTT-Referenz).
 * Ein 6,4-kB-QR-SVG wurde am Gerät nur als weiße Fläche gezeichnet und die
 * LEDs reagierten danach nicht mehr (2026-09-29) – größere SVGs daher NICHT senden.
 */
export const DEVICE_SVG_MAX_BYTES = 2048;

export function qrSvg(text: string): string {
  const qr = qrcode(0, "L");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const size = n + QUIET_ZONE * 2;

  // Relative Moves: nach „z“ steht der Stift wieder am Lauf-Anfang.
  let d = "";
  let px = -QUIET_ZONE;
  let py = -QUIET_ZONE;
  for (let row = 0; row < n; row++) {
    let col = 0;
    while (col < n) {
      if (!qr.isDark(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < n && qr.isDark(row, col)) col++;
      const len = col - start;
      d += `${d ? "m" : "M"}${start - px} ${row - py}h${len}v1h-${len}z`;
      px = start;
      py = row;
    }
  }

  const svg =
    `<svg viewBox="0 0 ${size} ${size}">` +
    `<rect fill="white" x="0" y="0" width="${size}" height="${size}"/>` +
    `<path fill="black" d="${d}"/>` +
    `</svg>`;
  if (svg.length > DEVICE_SVG_MAX_BYTES) {
    console.warn(`[Transit:QR] SVG ${svg.length} B (> ${DEVICE_SVG_MAX_BYTES} B, ${n}×${n} Module)`);
  }
  return svg;
}

/**
 * Link auf die GVH-Webauskunft mit vorausgefüllter Suche (Format wie der
 * Such-Link der Webapp selbst: SID/ZID + Datum/Uhrzeit + start=yes).
 * Die Üstra-/GVH-Apps bieten keine dokumentierten Deep-Links.
 */
export function gvhTripUrl(from: TransitStop, to: TransitStop, departure: Date): string {
  const p = berlinParts(departure);
  const z = (v: number) => String(v).padStart(2, "0");
  // Bewusst ohne Prozent-Kodierung der „:“ (in Query-Werten erlaubt) – jedes
  // Zeichen weniger macht den QR-Code gröber und damit besser scanbar.
  const q = (v: string) => encodeURIComponent(v).replace(/%3A/gi, ":");
  const params: [string, string][] = [
    ["L", "vs_gvhng"],
    ["ulVersion", "1.2"],
    ["context", "TP"],
    ["SID", from.lid],
    ["ZID", to.lid],
    ["date", `${z(p.d)}.${z(p.mo)}.${p.y}`],
    ["time", `${z(p.h)}:${z(p.mi)}`],
    ["timeSel", "depart"],
    ["start", "yes"],
  ];
  return `https://gvh.hafas.de/?${params.map(([k, v]) => `${k}=${q(v)}`).join("&")}`;
}
