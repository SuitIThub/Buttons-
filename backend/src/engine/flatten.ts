/**
 * Flacht geschachtelte JSON-Strukturen zu einem einstufigen Dict ab.
 * Geschachtelte Keys werden mit "/" verbunden, Array-Indizes zählen als Keys:
 *
 *   { "key1": "val1", "key2": { "key3": "val2" }, "list": [7, 8] }
 *   → { "key1": "val1", "key2/key3": "val2", "list/0": 7, "list/1": 8 }
 *
 * Primitive an der Wurzel landen unter dem Key "value". null → "".
 */

import { VarValue } from "../model.js";

export function flattenJson(
  value: unknown,
  prefix = "",
  out: Record<string, VarValue> = {},
): Record<string, VarValue> {
  if (value === null || value === undefined) {
    out[prefix || "value"] = "";
    return out;
  }

  if (typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [String(i), v] as const)
      : Object.entries(value as Record<string, unknown>);

    // Leere Objekte/Arrays hinterlassen keinen Key.
    for (const [k, v] of entries) {
      flattenJson(v, prefix ? `${prefix}/${k}` : k, out);
    }
    return out;
  }

  out[prefix || "value"] = value as VarValue;
  return out;
}
