/**
 * Icon Resolver - Übersetzt Icon-Referenzen in geräte-taugliches SVG.
 *
 * Das Button+ Gerät rendert ausschließlich **SVG Tiny 1.2** (siehe
 * MQTT-TOPICS-REFERENCE.md §6): nur `viewBox` im root-Tag, gefüllte Shapes mit
 * `fill`-Attribut, keine xmlns/width/height/strokes.
 *
 * Unterstützte Eingaben:
 * - `mdi:<name>`  → Material-Design-Icon (aus @mdi/js) als SVG-Path.
 * - `<svg ...>…`  → rohes SVG, wird zu SVG Tiny 1.2 gesäubert.
 * - leer/unbekannt → `undefined` (kein Icon).
 */

import * as mdiIcons from "@mdi/js";

const ICONS = mdiIcons as unknown as Record<string, string>;

/** Standard-Füllfarbe für Icons (gegen den schwarzen Gerätehintergrund gut sichtbar). */
export const DEFAULT_ICON_FILL = "white";

/** "skip-next" → "mdiSkipNext" (Export-Name in @mdi/js). */
function mdiExportName(name: string): string {
  const pascal = name
    .split(/[-_]/)
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : ""))
    .join("");
  return `mdi${pascal}`;
}

/** Wrappt eine MDI-Path-Definition in konformes SVG Tiny 1.2. */
function wrapPath(d: string, fill: string): string {
  return `<svg viewBox="0 0 24 24"><path fill="${fill}" d="${d}"/></svg>`;
}

/**
 * Säubert rohes SVG zu SVG Tiny 1.2: Entfernt alle root-Attribute außer
 * `viewBox` (also xmlns, width, height, id, class, style, …).
 */
function sanitizeSvg(svg: string): string {
  const viewBox = svg.match(/viewBox\s*=\s*"([^"]*)"/i)?.[1] ?? "0 0 24 24";
  return svg.replace(/<svg\b[^>]*>/i, `<svg viewBox="${viewBox}">`).trim();
}

/**
 * Löst eine Icon-Referenz in ein geräte-taugliches SVG auf.
 *
 * @param value Icon-Referenz (`mdi:home`, rohes SVG oder leer)
 * @param fill  Füllfarbe für MDI-Icons (Default: weiß)
 * @returns SVG-String oder `undefined`, wenn nicht auflösbar/leer.
 */
export function resolveIcon(value: string | undefined, fill: string = DEFAULT_ICON_FILL): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;

  // Bereits rohes SVG → säubern.
  if (v.toLowerCase().startsWith("<svg")) return sanitizeSvg(v);

  // Material Design Icon (mit oder ohne "mdi:"-Präfix).
  const name = v.startsWith("mdi:") ? v.slice(4) : v;
  const path = ICONS[mdiExportName(name)];
  if (typeof path === "string" && path.length > 0) {
    return wrapPath(path, normalizeFill(fill));
  }

  // Unbekannt → lieber kein Icon als Datenmüll ans Gerät senden.
  return undefined;
}

/** Erlaubt Hex- ("#rrggbb") wie benannte Farben; leere Angabe → Default. */
function normalizeFill(fill: string): string {
  const f = fill?.trim();
  return f ? f : DEFAULT_ICON_FILL;
}

// ==================== ICON-KATALOG (für den Icon-Picker) ====================

export interface IconCatalogEntry {
  /** Kebab-Case-Name, z.B. "skip-next" (im Modell als "mdi:skip-next"). */
  name: string;
  /** SVG-Path-Definition (d-Attribut) für die Vorschau im Frontend. */
  path: string;
}

/** "mdiSkipNext" → "skip-next", "mdiNumeric1Box" → "numeric-1-box". */
function kebabName(exportName: string): string {
  return exportName
    .slice(3) // "mdi"-Präfix
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .toLowerCase();
}

let catalogCache: IconCatalogEntry[] | null = null;

/** Vollständiger, alphabetisch sortierter Katalog aller MDI-Icons (lazy aufgebaut). */
function catalog(): IconCatalogEntry[] {
  if (!catalogCache) {
    catalogCache = Object.entries(ICONS)
      .filter(([key, value]) => key.startsWith("mdi") && typeof value === "string")
      .map(([key, value]) => ({ name: kebabName(key), path: value }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  return catalogCache;
}

/**
 * Durchsucht den MDI-Katalog. Präfix-Treffer werden vor Substring-Treffern
 * gelistet. Der Katalog ist die gleiche Quelle wie `resolveIcon` — jeder
 * angebotene Name ist garantiert auflösbar.
 */
export function searchIcons(query: string, limit = 100): { icons: IconCatalogEntry[]; total: number } {
  const q = query.trim().toLowerCase().replace(/^mdi:/, "");
  if (!q) return { icons: [], total: 0 };

  const prefix: IconCatalogEntry[] = [];
  const substring: IconCatalogEntry[] = [];
  for (const entry of catalog()) {
    if (entry.name.startsWith(q)) prefix.push(entry);
    else if (entry.name.includes(q)) substring.push(entry);
  }

  const all = [...prefix, ...substring];
  return { icons: all.slice(0, limit), total: all.length };
}

/**
 * Löst konkrete Icon-Namen (mit oder ohne "mdi:"-Präfix) in Katalog-Einträge
 * auf. Unbekannte Namen werden weggelassen.
 */
export function lookupIcons(names: string[]): IconCatalogEntry[] {
  const result: IconCatalogEntry[] = [];
  for (const raw of names) {
    const name = raw.trim().toLowerCase().replace(/^mdi:/, "");
    if (!name) continue;
    const path = ICONS[mdiExportName(name)];
    if (typeof path === "string" && path.length > 0) {
      result.push({ name, path });
    }
  }
  return result;
}
