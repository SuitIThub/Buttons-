import { VarValue } from "./types";

function toStr(v: VarValue): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

/**
 * Vereinfachte Vorschau-Interpolation für den Designer. Ersetzt {name} durch den
 * aktuellen Wert, falls es eine bekannte Variable ist; komplexe Ausdrücke bleiben
 * als {…} sichtbar. Das echte Rendern übernimmt die Backend-Runtime.
 */
export function previewInterpolate(template: string | undefined, vars: Record<string, VarValue>): string {
  if (!template) return "";
  const trimmed = template.trim();
  // Statischer Text ohne {…}; reiner Variablenname ohne Klammern.
  if (trimmed && !/\{[^}]*\}/.test(trimmed)) {
    if (Object.prototype.hasOwnProperty.call(vars, trimmed)) {
      return toStr(vars[trimmed]);
    }
    return trimmed;
  }
  return template.replace(/\{([^}]*)\}/g, (_m, expr: string) => {
    const key = expr.trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) return toStr(vars[key]);
    return `{${expr}}`;
  });
}

/**
 * Vorschau des Display-Werts. Entspricht der Geräte-Runtime: reine
 * {…}-Interpolation, kein numerisches Umformatieren – der String kommt
 * genau so an, wie er zusammengesetzt wird.
 */
export function previewFormatValue(
  template: string | undefined,
  vars: Record<string, VarValue>,
): string {
  return previewInterpolate(template, vars);
}
