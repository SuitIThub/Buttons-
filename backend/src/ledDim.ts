/**
 * Zeitgesteuerte Button-LED-Dimmung: reine Zeitfenster-Logik, ohne MQTT.
 *
 * Zeiten werden immer in `settings.timeZone` ausgewertet (Default Europe/Berlin),
 * nicht in der Server-Lokalzeit — Docker-Images laufen sonst auf UTC.
 */

import { DEFAULT_LED_DIM, LedDimSettings, LedDimWindow } from "./model.js";

const MINUTES_PER_DAY = 24 * 60;
export const DEFAULT_LED_DIM_TZ = "Europe/Berlin";

/** Parst „HH:MM" oder „HH:MM:SS" in Minuten seit Mitternacht, sonst null. */
export function parseHHMM(value: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Normalisiert auf „HH:MM" oder null. */
export function normalizeHHMM(value: string | undefined): string | null {
  const minutes = parseHHMM(value);
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function resolveTimeZone(tz?: string): string {
  const candidate = (tz ?? "").trim() || DEFAULT_LED_DIM_TZ;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return DEFAULT_LED_DIM_TZ;
  }
}

export function zonedClock(timeZone: string, at: Date = new Date()): {
  hours: number;
  minutes: number;
  seconds: number;
  hhmm: string;
} {
  const tz = resolveTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const hours = num("hour");
  const minutes = num("minute");
  const seconds = num("second");
  return {
    hours,
    minutes,
    seconds,
    hhmm: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
  };
}

function normalizeWindow(w: Partial<LedDimWindow> | null | undefined): LedDimWindow | null {
  const start = normalizeHHMM(w?.start);
  const end = normalizeHHMM(w?.end);
  if (!start || !end) return null;
  return { start, end };
}

export function normalizeLedDim(raw?: Partial<LedDimSettings> | null): LedDimSettings {
  const brightness = Number(raw?.brightnessPercent);
  const windows = Array.isArray(raw?.windows)
    ? raw.windows.map(normalizeWindow).filter((w): w is LedDimWindow => w !== null)
    : DEFAULT_LED_DIM.windows.map((w) => ({ ...w }));
  return {
    enabled: Boolean(raw?.enabled),
    brightnessPercent: Number.isFinite(brightness)
      ? Math.max(0, Math.min(100, Math.round(brightness)))
      : DEFAULT_LED_DIM.brightnessPercent,
    timeZone: resolveTimeZone(raw?.timeZone ?? DEFAULT_LED_DIM.timeZone),
    windows,
  };
}

/**
 * Liegt `nowMinutes` (0–1439) in der Spanne? Identische Start/Ende-Zeiten gelten
 * als leer. Start > Ende überbrückt Mitternacht (z. B. 22:00–06:00).
 */
export function isInLedDimWindow(nowMinutes: number, start: string, end: string): boolean {
  const s = parseHHMM(start);
  const e = parseHHMM(end);
  if (s === null || e === null || s === e) return false;
  if (s < e) return nowMinutes >= s && nowMinutes < e;
  return nowMinutes >= s || nowMinutes < e;
}

export function isLedDimActive(settings: LedDimSettings, at: Date = new Date()): boolean {
  if (!settings.enabled) return false;
  const { hours, minutes } = zonedClock(settings.timeZone ?? DEFAULT_LED_DIM_TZ, at);
  const nowMinutes = hours * 60 + minutes;
  return (settings.windows ?? []).some((w) => isInLedDimWindow(nowMinutes, w.start, w.end));
}

/** Skala 0–1 für LED-Helligkeit (außerhalb der Fenster bzw. deaktiviert: 1). */
export function ledBrightnessScale(settings: LedDimSettings, at: Date = new Date()): number {
  if (!isLedDimActive(settings, at)) return 1;
  return Math.max(0, Math.min(100, settings.brightnessPercent)) / 100;
}

/**
 * Millisekunden bis zum nächsten Fenster-Start oder -Ende.
 * `null` wenn nichts zu überwachen ist. Obergrenze 30 min (Uhr/DST-Sprünge).
 */
export function msUntilNextLedDimChange(settings: LedDimSettings, at: Date = new Date()): number | null {
  if (!settings.enabled) return null;
  const bounds = new Set<number>();
  for (const w of settings.windows ?? []) {
    const s = parseHHMM(w.start);
    const e = parseHHMM(w.end);
    if (s === null || e === null || s === e) continue;
    bounds.add(s);
    bounds.add(e);
  }
  if (bounds.size === 0) return null;

  const clock = zonedClock(settings.timeZone ?? DEFAULT_LED_DIM_TZ, at);
  const nowMinutes = clock.hours * 60 + clock.minutes;
  const elapsedMs = clock.seconds * 1000 + at.getMilliseconds();
  let best = Number.POSITIVE_INFINITY;
  for (const bound of bounds) {
    let deltaMin = bound - nowMinutes;
    if (deltaMin < 0 || (deltaMin === 0 && elapsedMs > 0)) deltaMin += MINUTES_PER_DAY;
    if (deltaMin === 0) deltaMin = MINUTES_PER_DAY;
    const ms = deltaMin * 60_000 - elapsedMs;
    if (ms > 0 && ms < best) best = ms;
  }
  if (!Number.isFinite(best)) return null;
  return Math.max(250, Math.min(best, 30 * 60_000));
}
