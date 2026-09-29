/**
 * Stadteinwärts/-auswärts für Abfahrten einer Haltestelle.
 *
 * HAFAS liefert dafür kein Feld: das H/R der Linie ist nur die Linienrichtung
 * (Linie 1 „H“ = Sarstedt, „R“ = Langenhagen) und sagt je nach Haltestelle
 * Unterschiedliches. Deshalb geometrisch: Für jede Linie+Richtung (lineKey)
 * einmal den Fahrtverlauf holen und prüfen, ob der NÄCHSTE Halt näher am
 * Kröpcke liegt als diese Haltestelle. Ergebnis pro Tag gecacht – wenige
 * JourneyDetails-Abrufe pro Linie und Tag statt bei jedem Refresh.
 *
 * Liegt die Haltestelle selbst im Zentrum, gibt es kein „einwärts“ → keine
 * Einteilung (die Übersicht zeigt dann die normale Liste).
 */

import { TransitCoord, TransitDeparture, TransitJourneyStop, berlinParts } from "./GvhClient.js";

/** Bezugspunkt Innenstadt: Kröpcke. */
export const CITY_CENTER: TransitCoord = { lat: 52.3745, lon: 9.7386 };
/** Innerhalb dieses Radius (m) um das Zentrum keine Einteilung. */
export const CENTER_RADIUS_M = 500;
/** Höchstens so viele neue Fahrtverläufe pro Aktualisierung abrufen. */
const MAX_LOOKUPS_PER_RUN = 6;

export type CityDir = "in" | "out";

/** Näherungsweise Entfernung in Metern (für Stadtgebiet völlig ausreichend). */
export function distanceM(a: TransitCoord, b: TransitCoord): number {
  const dy = (a.lat - b.lat) * 111_320;
  const dx = (a.lon - b.lon) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

/** Haltestellen-ID ohne Steig: „de:03241:1391:6:1392“ → „de:03241:1391“. */
export function stationOf(lid: string): string {
  return lid.split(":").slice(0, 3).join(":");
}

/**
 * Richtung einer Fahrt an der Haltestelle `stopLid` anhand ihres Verlaufs.
 * null = nicht bestimmbar (Halt nicht gefunden, Endhalt, keine Koordinaten).
 */
export function directionFromStops(stops: TransitJourneyStop[], stopLid: string): CityDir | null {
  const station = stationOf(stopLid);
  const idx = stops.findIndex((s) => s.lid === stopLid || stationOf(s.lid) === station);
  if (idx < 0 || idx >= stops.length - 1) return null;
  const here = stops[idx].coord;
  const next = stops.slice(idx + 1).find((s) => s.coord)?.coord;
  if (!here || !next) return null;
  return distanceM(next, CITY_CENTER) < distanceM(here, CITY_CENTER) ? "in" : "out";
}

export class TransitDirections {
  /** `${station}|${lineKey}` → Richtung (null = nicht bestimmbar), gilt für `day`. */
  private cache = new Map<string, CityDir | null>();
  private day = "";

  constructor(private journeyStops: (jid: string) => Promise<TransitJourneyStop[]>) {}

  /** true, wenn die Haltestelle im Zentrum liegt (keine Einteilung sinnvoll). */
  static isCentral(coord: TransitCoord | null): boolean {
    return !coord || distanceM(coord, CITY_CENTER) <= CENTER_RADIUS_M;
  }

  /**
   * Setzt `cityDir` an den Abfahrten (Kopien). Unbekannte Linien werden bis
   * MAX_LOOKUPS_PER_RUN pro Aufruf nachgeschlagen; Fehler bleiben ohne Richtung.
   */
  async annotate(deps: TransitDeparture[]): Promise<TransitDeparture[]> {
    const p = berlinParts(new Date());
    const today = `${p.y}-${p.mo}-${p.d}`;
    if (today !== this.day) {
      this.cache.clear();
      this.day = today;
    }

    const central = deps.length > 0 && TransitDirections.isCentral(deps[0].stopCoord);
    if (central) return deps.map((d) => ({ ...d, cityDir: undefined }));

    const keyOf = (d: TransitDeparture) => `${stationOf(d.stopLid)}|${d.lineKey}`;
    const todo = new Map<string, TransitDeparture>();
    for (const d of deps) {
      const k = keyOf(d);
      if (!this.cache.has(k) && !todo.has(k) && d.jid && d.stopLid) todo.set(k, d);
    }
    await Promise.all(
      [...todo].slice(0, MAX_LOOKUPS_PER_RUN).map(async ([k, d]) => {
        try {
          this.cache.set(k, directionFromStops(await this.journeyStops(d.jid), d.stopLid));
        } catch {
          // Nicht cachen → nächster Refresh versucht es erneut.
        }
      }),
    );

    return deps.map((d) => ({ ...d, cityDir: this.cache.get(keyOf(d)) ?? undefined }));
  }
}
