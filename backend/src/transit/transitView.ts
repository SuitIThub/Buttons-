/**
 * Fahrplan-Szene: reine Ansichtslogik (ohne I/O, testbar).
 *
 * Aus Konfiguration + Laufzeit-State entsteht ein {@link TransitView}: Texte
 * für die festen Display-Elemente (tr-title/tr-body/tr-col2/tr-footer) und die
 * Belegung der Buttons B2..B7 (0-basierte IDs 2..7). Der SceneRenderer
 * publiziert das nur noch.
 */

import { TransitConfig, TransitRoute, TRANSIT_FIRST_BUTTON, TRANSIT_ROUTE_SLOTS } from "../model.js";
import {
  TransitConnection,
  TransitDeparture,
  TransitLeg,
  TransitSeverity,
  berlinParts,
  shortStopName,
} from "./GvhClient.js";

// ==================== Konstanten ====================

/** Verbindungen pro Seite der Liste. */
export const TR_PAGE_SIZE = 3;
/** Sichtbare Zeilen im tr-body (Detail/Meldungen/Übersicht). */
export const TR_BODY_LINES = 8;
/** Umbruchbreite für Meldungstexte (Zeichen). */
export const TR_LINE_WIDTH = 48;
/** Ab dieser Verspätung (min) gilt eine Route als „verspätet“ (gelbe LED). */
export const TR_DELAY_WARN_MIN = 3;

/** Button-IDs (0-basiert) in den Unteransichten – entsprechen B2..B7. */
export const TR_BTN = { up: 2, down: 3, select: 4, qr: 5, warn: 6, home: 7 } as const;

/**
 * Zeichen auf dem Display. Die Geräte-Schrift kann nur ASCII plus deutsche
 * Umlaute/ß – schon „»“, „·“, „–“, „…“ erscheinen als Kästchen (verifiziert
 * 2026-09-29). Alle Texte laufen zusätzlich durch {@link displaySafe}.
 */
const G = { cursor: ">", arrow: "->", chain: " > ", dot: "|" };

export const TR_LED = {
  ok: "#00ff00",
  warn: "#ffff00",
  bad: "#ff0000",
  action: "#00ff00",
} as const;

const ICON = {
  up: "mdi:chevron-up",
  down: "mdi:chevron-down",
  warning: "mdi:alert",
  disruption: "mdi:alert-octagon",
};

// ==================== State ====================

export type TransitViewKind = "overview" | "list" | "detail" | "warnings" | "qr";

/** LED-Status einer Route in der Übersicht. */
export type RouteStatus = "ok" | "delay" | "warning" | "disruption" | null;

export interface TransitRuntimeState {
  view: TransitViewKind;
  /** Aktive Route (Slot-Index 0..5) in Liste/Detail/Meldungen/QR. */
  routeIdx: number;
  departures: TransitDeparture[] | null;
  routeStatus: RouteStatus[];
  /** Geladene Verbindungen der aktiven Route (chronologisch, dedupliziert). */
  connections: TransitConnection[];
  ctxLater: unknown;
  ctxEarlier: unknown;
  /** Erste sichtbare Verbindung (Vielfaches von TR_PAGE_SIZE). */
  offset: number;
  /** Cursor innerhalb der sichtbaren Seite (0..TR_PAGE_SIZE-1). */
  cursor: number;
  detailScroll: number;
  warnScroll: number;
  /** Wohin „Zurück“ aus den Meldungen führt. */
  warnReturn: "list" | "detail";
  /** Verbindung, die in Detail/Meldungen/QR gezeigt wird. */
  selectedKey: string | null;
  loading: boolean;
  error: string | null;
  updatedAt: Date | null;
  qrSvg: string;
}

export function initialTransitState(): TransitRuntimeState {
  return {
    view: "overview",
    routeIdx: 0,
    departures: null,
    routeStatus: Array.from({ length: TRANSIT_ROUTE_SLOTS }, () => null),
    connections: [],
    ctxLater: null,
    ctxEarlier: null,
    offset: 0,
    cursor: 0,
    detailScroll: 0,
    warnScroll: 0,
    warnReturn: "list",
    selectedKey: null,
    loading: false,
    error: null,
    updatedAt: null,
    qrSvg: "",
  };
}

// ==================== View ====================

export interface TransitButtonView {
  label: string;
  /** Icon-Referenz (mdi:…) oder leer. */
  icon: string;
  /** Front-LED-Farbe oder null = aus. */
  led: string | null;
}

export interface TransitView {
  title: string;
  body: string;
  footer: string;
  /** Zweite Textspalte (tr-col2, nur Übersicht); fehlt = leer. */
  col2?: string;
  /** Geräte-SVG für tr-col2 oder leer. */
  qr: string;
  /** Belegung der Buttons, Key = 0-basierte Button-ID (2..7). */
  buttons: Record<number, TransitButtonView>;
}

const OFF: TransitButtonView = { label: "", icon: "", led: null };

// ==================== Formatierung ====================

export function hhmm(d: Date | null): string {
  if (!d) return "--:--";
  const p = berlinParts(d);
  return `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
}

/** „+3“ / „-1“ / „“ (pünktlich oder ohne Echtzeit). */
export function fmtDelay(delay: number | null): string {
  if (delay === null || delay === 0) return "";
  return delay > 0 ? `+${delay}` : `${delay}`;
}

function timeWithDelay(d: Date | null, delay: number | null): string {
  const dl = fmtDelay(delay);
  return dl ? `${hhmm(d)} ${dl}` : hhmm(d);
}

/** Tatsächliche (prognostizierte) Zeit = Soll + Verspätung. */
function realTime(d: Date, delay: number | null): number {
  return d.getTime() + (delay ?? 0) * 60_000;
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}.` : s;
}

/**
 * Macht Text displaytauglich: typografische Zeichen → ASCII, fremde Akzente
 * entfernen (é → e), alles außer ASCII + ÄÖÜäöüß verwerfen. HAFAS-Meldungen
 * enthalten z. B. „“ – … und würden sonst als Kästchen erscheinen.
 */
export function displaySafe(text: string): string {
  return (text ?? "")
    .replace(/[\u2013\u2014\u2212]/g, "-")
    .replace(/[\u201c\u201d\u201e\u00ab\u00bb]/g, '"')
    .replace(/[\u2018\u2019\u201a\u00b4`]/g, "'")
    .replace(/\u2026/g, "...")
    .replace(/[\u00a0\u2009\u202f]/g, " ")
    .replace(/[\u00b7\u2022]/g, "|")
    .replace(/\u2192/g, "->")
    .replace(/[^\n\x20-\x7e\u00c4\u00d6\u00dc\u00e4\u00f6\u00fc\u00df]/g, (ch) => {
      const base = ch.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      return /^[\x20-\x7e]+$/.test(base) ? base : "";
    });
}

export function wrapText(text: string, width = TR_LINE_WIDTH): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const w of words) {
      if (!line) line = w;
      else if (line.length + 1 + w.length <= width) line += ` ${w}`;
      else {
        out.push(line);
        line = w;
      }
      while (line.length > width) {
        out.push(line.slice(0, width));
        line = line.slice(width);
      }
    }
    if (line) out.push(line);
  }
  return out;
}

function routeTitle(r: TransitRoute): string {
  return `${clip(shortStopName(r.from.name), 18)} ${G.arrow} ${clip(shortStopName(r.to.name), 18)}`;
}

/** Linienkette einer Verbindung, z. B. „1 > 470“ oder „Fußweg > S4 > SEV“. */
export function lineChain(c: TransitConnection): string {
  const parts: string[] = [];
  for (const l of c.legs) {
    if (l.kind === "ride") parts.push(l.cancelled ? `${l.line} (fällt aus)` : l.line || "?");
    else if (l.kind === "walk" && minutesBetween(l.depPlanned, l.arrPlanned) >= 1) parts.push("Fußweg");
  }
  return parts.join(G.chain);
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

function severityIcon(s: TransitSeverity): TransitButtonView {
  if (s === "disruption") return { label: "", icon: ICON.disruption, led: TR_LED.bad };
  if (s === "warning") return { label: "", icon: ICON.warning, led: TR_LED.warn };
  return OFF;
}

function footerStamp(st: TransitRuntimeState): string {
  if (st.error) return `Fehler: ${clip(st.error, 40)}`;
  if (st.loading && !st.updatedAt) return "Lade...";
  return st.updatedAt ? `Stand ${hhmm(st.updatedAt)}` : "";
}

/** Status der nächsten Verbindung → LED-Status einer Route. */
export function routeStatusOf(c: TransitConnection | undefined): RouteStatus {
  if (!c) return null;
  if (c.severity === "disruption") return "disruption";
  if (c.severity === "warning") return "warning";
  const maxDelay = Math.max(c.depDelay ?? 0, c.arrDelay ?? 0);
  return maxDelay >= TR_DELAY_WARN_MIN ? "delay" : "ok";
}

function statusLed(s: RouteStatus): string | null {
  switch (s) {
    case "ok":
      return TR_LED.ok;
    case "delay":
    case "warning":
      return TR_LED.warn;
    case "disruption":
      return TR_LED.bad;
    default:
      return null;
  }
}

/** Aktuell ausgewählte Verbindung (Cursor bzw. selectedKey). */
export function selectedConnection(st: TransitRuntimeState): TransitConnection | undefined {
  if (st.view === "list") return st.connections[st.offset + st.cursor];
  return st.connections.find((c) => c.key === st.selectedKey) ?? st.connections[st.offset + st.cursor];
}

// ==================== Detail-/Meldungszeilen ====================

/** Alle Zeilen der Detailansicht (wird gescrollt). */
export function detailLines(c: TransitConnection): string[] {
  const lines: string[] = [];
  let prevRideArr: number | null = null;
  const lastIdx = c.legs.length - 1;
  c.legs.forEach((leg: TransitLeg, i) => {
    if (leg.kind === "walk") {
      const min = minutesBetween(leg.depPlanned, leg.arrPlanned);
      if (min >= 1 || i === 0 || i === lastIdx) lines.push(`Fußweg ${Math.max(1, min)} min ${G.arrow} ${clip(leg.to, 28)}`);
      return;
    }
    if (leg.kind === "transfer") return; // Umstiegszeit steht bei der nächsten Fahrt
    const dep = realTime(leg.depPlanned, leg.depDelay);
    if (prevRideArr !== null) {
      const wait = Math.round((dep - prevRideArr) / 60_000);
      lines.push(`  Umstieg ${wait} min${wait < 2 ? " (knapp!)" : ""}`);
    }
    lines.push(`${leg.line} ${G.arrow} ${clip(leg.direction, 34)}${leg.cancelled ? " FÄLLT AUS" : ""}`);
    const stops = leg.stops.length > 0 ? leg.stops : [];
    if (stops.length === 0) {
      lines.push(`  ${timeWithDelay(leg.depPlanned, leg.depDelay)}  ${clip(leg.from, 30)}`);
      lines.push(`  ${timeWithDelay(leg.arrPlanned, leg.arrDelay)}  ${clip(leg.to, 30)}`);
    } else {
      stops.forEach((s, si) => {
        const useArr = si === stops.length - 1 || !s.depPlanned;
        const t = useArr ? timeWithDelay(s.arrPlanned, s.arrDelay) : timeWithDelay(s.depPlanned, s.depDelay);
        lines.push(`  ${t}  ${clip(s.name, 30)}${s.cancelled ? " (entfällt)" : ""}`);
      });
    }
    prevRideArr = realTime(leg.arrPlanned, leg.arrDelay);
  });
  return lines;
}

/** Alle Zeilen der Meldungsansicht. */
export function warningLines(c: TransitConnection): string[] {
  const lines: string[] = [];
  const cancelled = c.legs.filter((l) => l.kind === "ride" && l.cancelled);
  for (const l of cancelled) lines.push(...wrapText(`STÖRUNG: ${l.line} ${l.from} ${G.arrow} ${l.to} fällt aus`), "");
  for (const m of c.messages) {
    const tag = m.severity === "disruption" ? "STÖRUNG" : "HINWEIS";
    lines.push(...wrapText(`${tag}: ${m.head}`));
    if (m.text && m.text !== m.head) lines.push(...wrapText(m.text));
    lines.push("");
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.length ? lines : ["Keine Meldungen."];
}

/** Scroll-Fenster (0-basierter Start auf gültigen Bereich begrenzen). */
export function clampScroll(scroll: number, total: number, window = TR_BODY_LINES): number {
  return Math.max(0, Math.min(scroll, Math.max(0, total - window)));
}

// ==================== Hauptfunktion ====================

export function buildTransitView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  const v = rawView(cfg, st);
  const buttons: Record<number, TransitButtonView> = {};
  for (const [id, b] of Object.entries(v.buttons)) buttons[Number(id)] = { ...b, label: displaySafe(b.label) };
  return {
    ...v,
    title: displaySafe(v.title),
    body: displaySafe(v.body),
    col2: displaySafe(v.col2 ?? ""),
    footer: displaySafe(v.footer),
    buttons,
  };
}

function rawView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  switch (st.view) {
    case "list":
      return listView(cfg, st);
    case "detail":
      return detailView(cfg, st);
    case "warnings":
      return warningsView(cfg, st);
    case "qr":
      return qrView(cfg, st);
    default:
      return overviewView(cfg, st);
  }
}

function overviewView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  const buttons: Record<number, TransitButtonView> = {};
  for (let i = 0; i < TRANSIT_ROUTE_SLOTS; i++) {
    const r = cfg.routes[i];
    buttons[TRANSIT_FIRST_BUTTON + i] = r
      ? { label: r.name || routeTitle(r), icon: "", led: statusLed(st.routeStatus[i] ?? null) }
      : OFF;
  }

  if (!cfg.station) {
    return {
      title: "Fahrplan",
      body: "Keine Haltestelle konfiguriert.\nIm Button Manager unter Szenen einstellen.",
      footer: "",
      qr: "",
      buttons,
    };
  }

  const deps = (st.departures ?? []).slice(0, TR_BODY_LINES);
  const title = clip(shortStopName(cfg.station.name), 32);
  if (!deps.length) {
    const body = st.loading ? "Lade Abfahrten..." : st.error ? "" : "Keine Abfahrten.";
    return { title, body, col2: "", footer: footerStamp(st), qr: "", buttons };
  }

  // Zwei Spalten (eigene Display-Elemente): links Zeit + Verspätung, rechts
  // Linie + Ziel. Die Linie wird grob auf die längste Liniennummer aufgefüllt
  // (Proportionalschrift: eine Ziffer ≈ 2 Leerzeichen breit).
  const maxLine = Math.max(...deps.map((d) => d.line.length));
  const times = deps.map((d) => (d.cancelled ? hhmm(d.planned) : timeWithDelay(d.planned, d.delay)));
  const lines = deps.map((d) => {
    const pad = " ".repeat(Math.round((maxLine - d.line.length) * 2) + 2);
    const dest = clip(d.direction, 26);
    return `${d.line}${pad}${d.cancelled ? `${dest} - fällt aus` : dest}`;
  });

  return {
    title,
    body: times.join("\n"),
    col2: lines.join("\n"),
    footer: footerStamp(st),
    qr: "",
    buttons,
  };
}

function homeButton(): TransitButtonView {
  return { label: "Übersicht", icon: "", led: TR_LED.action };
}

function listView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  const route = cfg.routes[st.routeIdx];
  const page = st.connections.slice(st.offset, st.offset + TR_PAGE_SIZE);
  const sel = page[st.cursor];

  const lines: string[] = [];
  page.forEach((c, i) => {
    const mark = i === st.cursor ? G.cursor : " ";
    const dep = timeWithDelay(c.depPlanned, c.depDelay);
    const arr = timeWithDelay(c.arrPlanned, c.arrDelay);
    const dur = minutesBetween(new Date(realTime(c.depPlanned, c.depDelay)), new Date(realTime(c.arrPlanned, c.arrDelay)));
    const flag = c.severity === "disruption" ? "  (!!)" : c.severity === "warning" ? "  (!)" : "";
    lines.push(`${mark} ${dep}  ${G.arrow}  ${arr}   ${dur} min${flag}`);
    lines.push(`    ${clip(lineChain(c), TR_LINE_WIDTH - 4)}`);
    if (i < page.length - 1) lines.push("");
  });

  let body = lines.join("\n");
  if (!page.length) body = st.loading ? "Lade Verbindungen..." : st.error ? "" : "Keine Verbindungen gefunden.";

  const canUp = st.cursor > 0 || st.offset > 0;
  const canDown =
    st.cursor < page.length - 1 || st.offset + TR_PAGE_SIZE < st.connections.length || !!st.ctxLater;

  const from = st.offset + 1;
  const to = st.offset + page.length;
  const range = page.length ? `${from}-${to}` : "";
  const stamp = footerStamp(st);

  return {
    title: route ? routeTitle(route) : "Route",
    body,
    footer: [range && `Verbindung ${range}`, stamp].filter(Boolean).join(`  ${G.dot}  `),
    qr: "",
    buttons: {
      [TR_BTN.up]: canUp ? { label: "", icon: ICON.up, led: TR_LED.action } : OFF,
      [TR_BTN.down]: canDown ? { label: "", icon: ICON.down, led: TR_LED.action } : OFF,
      [TR_BTN.select]: sel ? { label: "Öffnen", icon: "", led: TR_LED.action } : OFF,
      [TR_BTN.qr]: sel && route ? { label: "QR", icon: "", led: TR_LED.action } : OFF,
      [TR_BTN.warn]: sel ? severityIcon(sel.severity) : OFF,
      [TR_BTN.home]: homeButton(),
    },
  };
}

function scrollButtons(scroll: number, total: number): Record<number, TransitButtonView> {
  const max = Math.max(0, total - TR_BODY_LINES);
  return {
    [TR_BTN.up]: scroll > 0 ? { label: "", icon: ICON.up, led: TR_LED.action } : OFF,
    [TR_BTN.down]: scroll < max ? { label: "", icon: ICON.down, led: TR_LED.action } : OFF,
  };
}

function scrollFooter(scroll: number, total: number, prefix: string): string {
  if (total <= TR_BODY_LINES) return prefix;
  const end = Math.min(total, scroll + TR_BODY_LINES);
  return `${prefix}  ${G.dot}  Zeile ${scroll + 1}-${end} von ${total}`;
}

function detailView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  const c = selectedConnection(st);
  if (!c) return listView(cfg, { ...st, view: "list" });
  const all = detailLines(c);
  const scroll = clampScroll(st.detailScroll, all.length);
  const dep = timeWithDelay(c.depPlanned, c.depDelay);
  const arr = timeWithDelay(c.arrPlanned, c.arrDelay);
  return {
    title: `${dep} ${G.arrow} ${arr}  ${G.dot}  ${c.changes}x Umstieg`,
    body: all.slice(scroll, scroll + TR_BODY_LINES).join("\n"),
    footer: scrollFooter(scroll, all.length, footerStamp(st)),
    qr: "",
    buttons: {
      ...scrollButtons(scroll, all.length),
      [TR_BTN.select]: { label: "Zurück", icon: "", led: TR_LED.action },
      [TR_BTN.qr]: OFF,
      [TR_BTN.warn]: severityIcon(c.severity),
      [TR_BTN.home]: homeButton(),
    },
  };
}

function warningsView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  const c = selectedConnection(st);
  const all = c ? warningLines(c) : ["Keine Meldungen."];
  const scroll = clampScroll(st.warnScroll, all.length);
  const count = c ? c.messages.length + c.legs.filter((l) => l.kind === "ride" && l.cancelled).length : 0;
  return {
    title: `Meldungen (${count})`,
    body: all.slice(scroll, scroll + TR_BODY_LINES).join("\n"),
    footer: scrollFooter(scroll, all.length, footerStamp(st)),
    qr: "",
    buttons: {
      ...scrollButtons(scroll, all.length),
      [TR_BTN.select]: { label: "Zurück", icon: "", led: TR_LED.action },
      [TR_BTN.qr]: OFF,
      [TR_BTN.warn]: OFF,
      [TR_BTN.home]: homeButton(),
    },
  };
}

function qrView(cfg: TransitConfig, st: TransitRuntimeState): TransitView {
  const route = cfg.routes[st.routeIdx];
  return {
    title: route ? routeTitle(route) : "QR-Code",
    body: st.qrSvg ? "" : "QR-Code ist zu groß für das Display.\nFunktion wird noch überarbeitet.",
    footer: st.qrSvg ? "Mit dem Handy scannen: GVH-Auskunft" : "",
    qr: st.qrSvg,
    buttons: {
      [TR_BTN.up]: OFF,
      [TR_BTN.down]: OFF,
      [TR_BTN.select]: { label: "Zurück", icon: "", led: TR_LED.action },
      [TR_BTN.qr]: { label: "Zurück", icon: "", led: TR_LED.action },
      [TR_BTN.warn]: OFF,
      [TR_BTN.home]: homeButton(),
    },
  };
}
