/**
 * GVH-Client – Zugriff auf das HAFAS-„mgate“-Backend der GVH-Webauskunft.
 *
 * Protokoll siehe BERICHT_GVH_Datenzugang.md (§3): JSON-POST mit den
 * Anfrage-Metadaten ZUSÄTZLICH als Query-Parameter, sonst HTTP 500.
 * Unbekannte Felder im Request führen ebenfalls zu HTTP 500 – daher nur
 * geprüfte Felder senden.
 *
 * Genutzte Methoden (live geprüft 2026-09-29):
 * - LocMatch      Haltestellensuche
 * - StationBoard  Abfahrten einer Haltestelle (Echtzeit)
 * - TripSearch    Verbindungen Start → Ziel inkl. Zwischenhalten, Blättern per ctxScr
 *
 * Alle Zeiten sind lokale Zeit Europe/Berlin und werden hier unabhängig von
 * der Server-Zeitzone in echte `Date`-Werte umgerechnet.
 */

import { TransitStop } from "../model.js";

const BASE_URL = "https://gvh.hafas.de/hamm";
const CONFIG_URL = "https://gvh.hafas.de/config/webapp.config.json";
/** Bekannte AID – nur Rückfall, wenn webapp.config.json nicht lesbar ist. */
const FALLBACK_AID = "IKSEvZ1SsVdfIRSK";
const HCI_VERSION = "1.62";
const CLIENT_VERSION = 10109;
const HTTP_TIMEOUT_MS = 10_000;
const TZ = "Europe/Berlin";

// ==================== Öffentliche Typen ====================

export type TransitSeverity = "none" | "warning" | "disruption";

export interface TransitMessage {
  id: string;
  head: string;
  text: string;
  severity: Exclude<TransitSeverity, "none">;
}

/** Koordinate in Grad (HAFAS liefert Ganzzahl × 10⁶). */
export interface TransitCoord {
  lat: number;
  lon: number;
}

export interface TransitDeparture {
  line: string;
  direction: string;
  planned: Date;
  /** Verspätung in Minuten; null = keine Echtzeit. */
  delay: number | null;
  cancelled: boolean;
  /** Fahrt-ID (Eingabe für JourneyDetails). */
  jid: string;
  /**
   * Linie inkl. Linienrichtung aus der jid, z. B. „gvh:02001: :H:j26“ (H/R =
   * Hin/Rück). Alle Fahrten mit gleichem Schlüssel fahren an einer Haltestelle
   * in dieselbe Richtung.
   */
  lineKey: string;
  /** Steig-ID der Abfahrt (z. B. „de:03241:1391:6:1392“). */
  stopLid: string;
  stopCoord: TransitCoord | null;
  /** Stadteinwärts/-auswärts (TransitDirections); fehlt = unbekannt. */
  cityDir?: "in" | "out";
}

/** Halt eines Fahrtverlaufs (JourneyDetails). */
export interface TransitJourneyStop {
  lid: string;
  name: string;
  coord: TransitCoord | null;
}

export interface TransitStopEvent {
  name: string;
  arrPlanned: Date | null;
  arrDelay: number | null;
  depPlanned: Date | null;
  depDelay: number | null;
  cancelled: boolean;
}

export interface TransitLeg {
  kind: "ride" | "walk" | "transfer";
  /** Linie (nur ride), z. B. „10“, „S4“, „SEV“. */
  line: string;
  direction: string;
  from: string;
  to: string;
  depPlanned: Date;
  depDelay: number | null;
  arrPlanned: Date;
  arrDelay: number | null;
  cancelled: boolean;
  /** Alle Halte des Abschnitts inkl. Start/Ziel (nur ride). */
  stops: TransitStopEvent[];
  messages: TransitMessage[];
}

export interface TransitConnection {
  /** Stabiler Schlüssel (HAFAS cksum/cid) zum Deduplizieren beim Blättern. */
  key: string;
  depPlanned: Date;
  depDelay: number | null;
  arrPlanned: Date;
  arrDelay: number | null;
  changes: number;
  cancelled: boolean;
  legs: TransitLeg[];
  /** Alle Meldungen der Verbindung (dedupliziert). */
  messages: TransitMessage[];
  severity: TransitSeverity;
}

export interface TripResult {
  connections: TransitConnection[];
  /** Blätter-Kontexte (unverändert an TripSearch zurückgeben). */
  ctxLater: unknown;
  ctxEarlier: unknown;
}

export class HafasError extends Error {
  constructor(method: string, detail: string) {
    super(`HAFAS ${method}: ${detail}`);
    this.name = "HafasError";
  }
}

// ==================== Zeit-Helfer ====================

/** Lokale Berlin-Zeit (Datum + Uhrzeit) eines Zeitpunkts. */
export function berlinParts(at: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const n = (t: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour"), mi: n("minute"), s: n("second") };
}

/** Berlin-Lokalzeit → Date (DST-sicher, unabhängig von der Server-Zeitzone). */
export function fromBerlin(y: number, mo: number, d: number, h: number, mi: number, s = 0): Date {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  // Offset an dieser Stelle ermitteln und zweimal anwenden (deckt DST-Grenzen ab).
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const p = berlinParts(new Date(guess));
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    guess += asUtc - shown;
  }
  return new Date(guess);
}

/**
 * HAFAS-Zeit (`HHMMSS` oder mit Tages-Offset `DDHHMMSS`) + Betriebstag
 * (`YYYYMMDD`) → Date.
 */
export function parseHafasTime(date: string, time: string | undefined): Date | null {
  if (!time || !/^\d{6}(\d{2})?$/.test(time) || !/^\d{8}$/.test(date)) return null;
  const off = time.length === 8 ? Number(time.slice(0, 2)) : 0;
  const t = time.slice(-6);
  return fromBerlin(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)),
    Number(date.slice(6, 8)) + off,
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6)),
  );
}

/** Verspätung in ganzen Minuten (Echtzeit − Soll); null ohne Echtzeit. */
function delayMinutes(planned: Date | null, real: Date | null): number | null {
  if (!planned || !real) return null;
  return Math.round((real.getTime() - planned.getTime()) / 60_000);
}

/** HAFAS-Datum/Uhrzeit für Requests (Berlin). */
export function hafasDateTime(at: Date): { date: string; time: string } {
  const p = berlinParts(at);
  const z = (v: number) => String(v).padStart(2, "0");
  return { date: `${p.y}${z(p.mo)}${z(p.d)}`, time: `${z(p.h)}${z(p.mi)}${z(p.s)}` };
}

// ==================== Rohdaten-Typen (nur genutzte Felder) ====================

interface RawCommon {
  locL?: { name?: string; lid?: string; extId?: string; type?: string; crd?: { x: number; y: number } }[];
  prodL?: { name?: string; nameS?: string; number?: string }[];
  remL?: { txtN?: string; type?: string; code?: string }[];
  himL?: { hid?: string; head?: string; text?: string; lead?: string; icoX?: number }[];
  icoL?: { res?: string }[];
}

interface RawMsg {
  type?: string;
  himX?: number;
  remX?: number;
}

interface RawStop {
  locX?: number;
  aTimeS?: string;
  aTimeR?: string;
  dTimeS?: string;
  dTimeR?: string;
  aCncl?: boolean;
  dCncl?: boolean;
}

interface RawSection {
  type?: string;
  dep: RawStop;
  arr: RawStop;
  jny?: { prodX?: number; dirTxt?: string; stopL?: RawStop[]; msgL?: RawMsg[]; isCncl?: boolean };
  gis?: { durS?: string };
}

interface RawConnection {
  date: string;
  cksum?: string;
  cid?: string;
  chg?: number;
  dep: RawStop;
  arr: RawStop;
  secL?: RawSection[];
  msgL?: RawMsg[];
}

// ==================== Parser ====================

/** Texte, die auf eine echte Störung (statt nur Hinweis) deuten. */
const DISRUPTION_RE = /(sperrung|gesperrt|ausfall|ausfälle|fällt aus|fallen aus|entfällt|entfallen|störung|unterbrochen|kein zugverkehr|ersatzverkehr)/i;

function stripHtml(s: string | undefined): string {
  return (s ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Nur HIM-Meldungen sind Warnungen/Störungen; REM sind Attribute/Infos. */
function parseMessages(msgL: RawMsg[] | undefined, common: RawCommon): TransitMessage[] {
  const out: TransitMessage[] = [];
  for (const m of msgL ?? []) {
    if (m.type !== "HIM" || typeof m.himX !== "number") continue;
    const h = common.himL?.[m.himX];
    if (!h) continue;
    const head = stripHtml(h.head);
    const text = stripHtml(h.text ?? h.lead);
    const icon = typeof h.icoX === "number" ? common.icoL?.[h.icoX]?.res ?? "" : "";
    const disruption = /stoer|disrupt|cancel|warn/i.test(icon) || DISRUPTION_RE.test(`${head} ${text}`);
    out.push({
      id: h.hid ?? `him${m.himX}`,
      head,
      text,
      severity: disruption ? "disruption" : "warning",
    });
  }
  return out;
}

function dedupeMessages(list: TransitMessage[]): TransitMessage[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)));
}

function lineName(common: RawCommon, prodX: number | undefined): string {
  const p = typeof prodX === "number" ? common.prodL?.[prodX] : undefined;
  return (p?.nameS || p?.name || p?.number || "").trim();
}

function locName(common: RawCommon, locX: number | undefined): string {
  const name = typeof locX === "number" ? common.locL?.[locX]?.name ?? "" : "";
  return shortStopName(name);
}

/**
 * Kompakter Haltestellenname fürs Display:
 * „Hannover, Kröpcke“ / „Hannover/Kröpcke“ → „Kröpcke“,
 * „Laatzen (Hannover), Eichstraße“ / „Laatzen/Eichstraße“ → „Laatzen Eichstraße“.
 * „Hannover Messe / Laatzen“ (Schrägstrich mit Leerzeichen) bleibt unverändert.
 */
export function shortStopName(name: string): string {
  const n = (name ?? "").trim();
  const m = /^([^,/()]+?)\s*(?:\([^)]*\))?(?:\s*,\s*|\/(?=\S))(.+)$/.exec(n);
  if (!m) return n;
  const city = m[1].trim();
  const stop = m[2].trim();
  return /^hannover$/i.test(city) ? stop : `${city} ${stop}`;
}

function parseStopEvent(common: RawCommon, date: string, s: RawStop): TransitStopEvent {
  const arrPlanned = parseHafasTime(date, s.aTimeS);
  const depPlanned = parseHafasTime(date, s.dTimeS);
  return {
    name: locName(common, s.locX),
    arrPlanned,
    arrDelay: delayMinutes(arrPlanned, parseHafasTime(date, s.aTimeR)),
    depPlanned,
    depDelay: delayMinutes(depPlanned, parseHafasTime(date, s.dTimeR)),
    cancelled: !!(s.aCncl || s.dCncl),
  };
}

function parseSection(common: RawCommon, date: string, sec: RawSection): TransitLeg | null {
  const depPlanned = parseHafasTime(date, sec.dep.dTimeS);
  const arrPlanned = parseHafasTime(date, sec.arr.aTimeS);
  if (!depPlanned || !arrPlanned) return null;
  const kind: TransitLeg["kind"] =
    sec.type === "JNY" ? "ride" : sec.type === "WALK" || sec.type === "GIS" ? "walk" : "transfer";
  const stops = kind === "ride" ? (sec.jny?.stopL ?? []).map((s) => parseStopEvent(common, date, s)) : [];
  return {
    kind,
    line: kind === "ride" ? lineName(common, sec.jny?.prodX) : "",
    direction: kind === "ride" ? stripHtml(sec.jny?.dirTxt) : "",
    from: locName(common, sec.dep.locX),
    to: locName(common, sec.arr.locX),
    depPlanned,
    depDelay: delayMinutes(depPlanned, parseHafasTime(date, sec.dep.dTimeR)),
    arrPlanned,
    arrDelay: delayMinutes(arrPlanned, parseHafasTime(date, sec.arr.aTimeR)),
    cancelled: !!(sec.dep.dCncl || sec.arr.aCncl || sec.jny?.isCncl),
    stops,
    messages: kind === "ride" ? parseMessages(sec.jny?.msgL, common) : [],
  };
}

export function parseConnection(common: RawCommon, raw: RawConnection): TransitConnection | null {
  const depPlanned = parseHafasTime(raw.date, raw.dep.dTimeS);
  const arrPlanned = parseHafasTime(raw.date, raw.arr.aTimeS);
  if (!depPlanned || !arrPlanned) return null;
  const legs = (raw.secL ?? [])
    .map((s) => parseSection(common, raw.date, s))
    .filter((l): l is TransitLeg => l !== null);
  const messages = dedupeMessages([
    ...parseMessages(raw.msgL, common),
    ...legs.flatMap((l) => l.messages),
  ]);
  const cancelled = !!(raw.dep.dCncl || raw.arr.aCncl) || legs.some((l) => l.cancelled);
  const severity: TransitSeverity =
    cancelled || messages.some((m) => m.severity === "disruption")
      ? "disruption"
      : messages.length > 0
        ? "warning"
        : "none";
  return {
    key: raw.cksum ?? raw.cid ?? `${raw.date}${raw.dep.dTimeS}`,
    depPlanned,
    depDelay: delayMinutes(depPlanned, parseHafasTime(raw.date, raw.dep.dTimeR)),
    arrPlanned,
    arrDelay: delayMinutes(arrPlanned, parseHafasTime(raw.date, raw.arr.aTimeR)),
    changes: raw.chg ?? Math.max(0, legs.filter((l) => l.kind === "ride").length - 1),
    cancelled,
    legs,
    messages,
    severity,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTripSearch(res: any): TripResult {
  const common: RawCommon = res?.common ?? {};
  const connections = ((res?.outConL ?? []) as RawConnection[])
    .map((c) => parseConnection(common, c))
    .filter((c): c is TransitConnection => c !== null);
  return { connections, ctxLater: res?.outCtxScrF ?? null, ctxEarlier: res?.outCtxScrB ?? null };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseStationBoard(res: any): TransitDeparture[] {
  const common: RawCommon = res?.common ?? {};
  const out: TransitDeparture[] = [];
  for (const j of res?.jnyL ?? []) {
    const s = j.stbStop ?? {};
    const planned = parseHafasTime(j.date, s.dTimeS);
    if (!planned) continue;
    const loc = typeof s.locX === "number" ? common.locL?.[s.locX] : undefined;
    out.push({
      line: lineName(common, j.prodX),
      direction: shortStopName(stripHtml(j.dirTxt)),
      planned,
      delay: delayMinutes(planned, parseHafasTime(j.date, s.dTimeR)),
      cancelled: !!(s.dCncl || j.isCncl),
      jid: String(j.jid ?? ""),
      lineKey: decodeJidLine(j.jid) || lineName(common, j.prodX),
      stopLid: loc?.lid ?? loc?.extId ?? "",
      stopCoord: toCoord(loc?.crd),
    });
  }
  return out;
}

/** HAFAS-Koordinate (Ganzzahl × 10⁶, x = Länge) → Grad. */
export function toCoord(crd: { x: number; y: number } | undefined): TransitCoord | null {
  return crd && Number.isFinite(crd.x) && Number.isFinite(crd.y) ? { lat: crd.y / 1e6, lon: crd.x / 1e6 } : null;
}

/** Linienschlüssel aus der Base64-jid („line“, inkl. H/R). */
export function decodeJidLine(jid: unknown): string {
  try {
    const obj = JSON.parse(Buffer.from(String(jid ?? ""), "base64").toString("utf8")) as { line?: string };
    return typeof obj.line === "string" ? obj.line : "";
  } catch {
    return "";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseJourneyStops(res: any): TransitJourneyStop[] {
  const common: RawCommon = res?.common ?? {};
  return ((res?.journey?.stopL ?? []) as RawStop[]).map((s) => {
    const loc = typeof s.locX === "number" ? common.locL?.[s.locX] : undefined;
    return { lid: loc?.lid ?? loc?.extId ?? "", name: loc?.name ?? "", coord: toCoord(loc?.crd) };
  });
}

// ==================== Client ====================

interface CacheEntry<T> {
  at: number;
  value: Promise<T>;
}

export class GvhClient {
  private aid: Promise<string> | null = null;
  private cache = new Map<string, CacheEntry<unknown>>();

  /** AID einmalig aus der Webapp-Konfig lesen (Rückfall: bekannter Wert). */
  private getAid(): Promise<string> {
    if (!this.aid) {
      this.aid = fetch(CONFIG_URL, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })
        .then((r) => r.json() as Promise<{ hciAuth?: { aid?: string } }>)
        .then((cfg) => cfg.hciAuth?.aid || FALLBACK_AID)
        .catch(() => {
          this.aid = null; // nächster Aufruf versucht es erneut
          return FALLBACK_AID;
        });
    }
    return this.aid;
  }

  /** Führt eine HAFAS-Methode aus und liefert `svcResL[0].res`. */
  async request(meth: string, req: Record<string, unknown>): Promise<unknown> {
    const aid = await this.getAid();
    const query = new URLSearchParams({
      hciMethod: meth,
      hciVersion: HCI_VERSION,
      hciClientType: "WEB",
      hciClientVersion: String(CLIENT_VERSION),
      aid,
      rnd: String(Date.now()),
    });
    const body = {
      ver: HCI_VERSION,
      lang: "deu",
      auth: { type: "AID", aid },
      client: { id: "HAFAS", type: "WEB", name: "webapp", l: "vs_webapp", v: CLIENT_VERSION },
      formatted: false,
      svcReqL: [{ meth, req, id: "1|1|" }],
    };
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}?${query}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
      });
    } catch (err) {
      throw new HafasError(meth, (err as Error).message);
    }
    if (!res.ok) throw new HafasError(meth, `HTTP ${res.status}`);
    const json = (await res.json()) as {
      svcResL?: { err?: string; errTxt?: string; res?: unknown }[];
    };
    const svc = json.svcResL?.[0];
    if (!svc) throw new HafasError(meth, "leere Antwort");
    if (svc.err && svc.err !== "OK") throw new HafasError(meth, `${svc.err} ${svc.errTxt ?? ""}`.trim());
    return svc.res;
  }

  /** Kurzzeit-Cache pro Schlüssel; Fehler werden nicht gecacht. */
  private cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key) as CacheEntry<T> | undefined;
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    this.cache.set(key, { at: Date.now(), value });
    value.catch(() => this.cache.delete(key));
    if (this.cache.size > 200) {
      const now = Date.now();
      for (const [k, e] of this.cache) if (now - e.at > 10 * 60_000) this.cache.delete(k);
    }
    return value;
  }

  /** Haltestellensuche nach Name (unscharf). */
  searchStops(q: string, max = 10): Promise<TransitStop[]> {
    const query = q.trim();
    if (!query) return Promise.resolve([]);
    return this.cached(`stops|${query.toLowerCase()}|${max}`, 5 * 60_000, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = (await this.request("LocMatch", {
        input: { field: "S", loc: { type: "S", name: `${query}?` }, maxLoc: max },
      })) as any;
      return ((res?.match?.locL ?? []) as { type?: string; lid?: string; name?: string }[])
        .filter((l) => l.type === "S" && l.lid && l.name)
        .map((l) => ({ lid: l.lid!, name: l.name! }));
    });
  }

  /** Fahrtverlauf (alle Halte mit Koordinaten) einer Fahrt aus StationBoard. */
  journeyStops(jid: string): Promise<TransitJourneyStop[]> {
    return this.cached(`jny|${jid}`, 10 * 60_000, async () =>
      parseJourneyStops(await this.request("JourneyDetails", { jid, getPolyline: false })),
    );
  }

  /** Nächste Abfahrten einer Haltestelle (Echtzeit). */
  departures(lid: string, max = 12): Promise<TransitDeparture[]> {
    return this.cached(`stb|${lid}|${max}`, 20_000, async () =>
      parseStationBoard(await this.request("StationBoard", { type: "DEP", stbLoc: { lid }, maxJny: max })),
    );
  }

  /**
   * Verbindungen Start → Ziel. Ohne `ctxScr` ab `at` (Default: jetzt);
   * mit `ctxScr` (aus einem vorherigen Ergebnis) die nächsten/vorherigen.
   */
  trips(fromLid: string, toLid: string, opts: { at?: Date; ctxScr?: unknown; count?: number } = {}): Promise<TripResult> {
    const count = opts.count ?? 6;
    const req: Record<string, unknown> = {
      depLocL: [{ lid: fromLid, type: "S" }],
      arrLocL: [{ lid: toLid, type: "S" }],
      getPasslist: true,
      numF: count,
    };
    let key: string;
    if (opts.ctxScr) {
      req.ctxScr = opts.ctxScr;
      key = `trip|${fromLid}|${toLid}|ctx|${JSON.stringify(opts.ctxScr)}`;
    } else {
      const { date, time } = hafasDateTime(opts.at ?? new Date());
      req.outDate = date;
      req.outTime = time;
      // Minutengenau cachen – mehrere Aufrufe in derselben Minute teilen sich das Ergebnis.
      key = `trip|${fromLid}|${toLid}|${date}${time.slice(0, 4)}|${count}`;
    }
    return this.cached(key, 20_000, async () => parseTripSearch(await this.request("TripSearch", req)));
  }
}

/** Gemeinsame Instanz (Cache wird zwischen Runtime und API geteilt). */
export const gvh = new GvhClient();
