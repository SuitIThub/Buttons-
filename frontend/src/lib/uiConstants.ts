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

export const FONT_SIZES = [0, 1, 2, 3, 4, 5, 6, 7];

/** Ungefähre Pixelgröße je Firmware-Schriftindex – nur für die Vorschau. */
export const FONT_PX = [11, 13, 16, 20, 26, 34, 44, 56];

/** Firmware-Ausrichtung 0..8 -> CSS (justify/align/text-align) für die Vorschau. */
export function alignToCss(align: number): {
  justifyContent: string;
  alignItems: string;
  textAlign: "left" | "center" | "right";
} {
  const col = align % 3;
  const row = Math.floor(align / 3);
  const justify = ["flex-start", "center", "flex-end"][col];
  const alignI = ["flex-start", "center", "flex-end"][row];
  const textAlign = (["left", "center", "right"] as const)[col];
  return { justifyContent: justify, alignItems: alignI, textAlign };
}

/** Verschiebt die Box so, dass (x,y) dem Firmware-Ankerpunkt entspricht (align). */
export function alignToAnchorTransform(align: number): string {
  const col = align % 3;
  const row = Math.floor(align / 3);
  const tx = ["0%", "-50%", "-100%"][col];
  const ty = ["0%", "-50%", "-100%"][row];
  return `translate(${tx}, ${ty})`;
}

export const VAR_TYPES: { value: string; label: string }[] = [
  { value: "string", label: "Text (string)" },
  { value: "int", label: "Ganzzahl (int)" },
  { value: "float", label: "Kommazahl (float)" },
  { value: "bool", label: "Boolean" },
  { value: "list", label: "Liste" },
  { value: "dict", label: "Dictionary" },
  { value: "enum", label: "Auswahl (enum)" },
];
