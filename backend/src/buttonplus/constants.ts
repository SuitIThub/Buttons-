/**
 * Konstanten der Button+ Firmware: Event-Typen und Connector-Typen.
 * Quelle: offizielle Firmware-Konfiguration (1.12+) und Community-Integrationen.
 */

export const EventType = {
  CLICK: 0,
  LONG_PRESS: 1,
  PAGE_STATUS: 6,
  BLUE_LED: 8,
  RED_LED: 9,
  GREEN_LED: 10,
  LABEL: 11,
  TOPLABEL: 12,
  RGB_LED: 13,
  LED: 14,
  VALUE: 15,
  UNIT: 17,
  SENSOR_VALUE: 18,
  SET_PAGE: 20,
  BRIGHTNESS_LARGE_DISPLAY: 24,
  BRIGHTNESS_MINI_DISPLAY: 25,
} as const;

export type EventTypeValue = (typeof EventType)[keyof typeof EventType];

export const ConnectorType = {
  BAR: 1,
  DISPLAY: 2,
  /** Display-Modul in Firmware V2/V3 (Connector-Typ 3). */
  DISPLAY_V2: 3,
} as const;

/** Schriftgrößen des großen Displays (Firmware unterstützt Index 0..7). */
export const FONT_SIZES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Text-Ausrichtung auf dem Display (Index -> Bedeutung). */
export const ALIGN_OPTIONS = [
  { value: 0, label: "Oben Links" },
  { value: 1, label: "Oben Mitte" },
  { value: 2, label: "Oben Rechts" },
  { value: 3, label: "Mitte Links" },
  { value: 4, label: "Mitte Mitte" },
  { value: 5, label: "Mitte Rechts" },
  { value: 6, label: "Unten Links" },
  { value: 7, label: "Unten Mitte" },
  { value: 8, label: "Unten Rechts" },
];

/** Farbe von Hex ("#rrggbb") in die von der Firmware genutzte Dezimalzahl umrechnen. */
export function hexToDecimalColor(hex: string): number {
  const clean = hex.replace("#", "").trim();
  if (clean.length !== 6) return 0;
  return parseInt(clean, 16);
}

/** Dezimalfarbe der Firmware in Hex ("#rrggbb") umrechnen. */
export function decimalToHexColor(dec: number): string {
  const clamped = Math.max(0, Math.min(0xffffff, Math.floor(dec || 0)));
  return "#" + clamped.toString(16).padStart(6, "0");
}
