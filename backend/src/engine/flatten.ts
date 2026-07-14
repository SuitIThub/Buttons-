/**
 * Flacht geschachtelte JSON-Strukturen zu einem einstufigen Dict ab.
 * Geschachtelte Keys werden mit "/" verbunden, Array-Indizes zählen als Keys.
 * Für Listen werden zusätzlich die Länge (".../length") und die Liste selbst
 * (".../list") als Keys eingefügt:
 *
 *   { "key1": "val1", "key2": { "key3": "val2" }, "items": ["val1", "val2"] }
 *   → {
 *       "key1": "val1", "key2/key3": "val2",
 *       "items/0": "val1", "items/1": "val2",
 *       "items/length": 2, "items/list": ["val1", "val2"],
 *     }
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

  if (Array.isArray(value)) {
    // Index-Keys wie bisher …
    value.forEach((v, i) => {
      flattenJson(v, prefix ? `${prefix}/${i}` : String(i), out);
    });
    // … plus Länge und die unveränderte Liste selbst.
    out[prefix ? `${prefix}/length` : "length"] = value.length;
    out[prefix ? `${prefix}/list` : "list"] = value as VarValue;
    return out;
  }

  if (typeof value === "object") {
    // Leere Objekte hinterlassen keinen Key.
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      flattenJson(v, prefix ? `${prefix}/${k}` : k, out);
    }
    return out;
  }

  out[prefix || "value"] = value as VarValue;
  return out;
}
