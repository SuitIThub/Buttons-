/**
 * Transit Controller – Laufzeitlogik der Fahrplan-Szene.
 *
 * Zustandsmaschine über die Ansichten Übersicht → Liste → Detail/Meldungen/QR,
 * Laden der GVH-Daten (GvhClient) und periodischer Refresh, solange eine
 * Fahrplan-Seite sichtbar ist. Das eigentliche Publizieren übernimmt der
 * SceneRenderer anhand von {@link TransitController.view}.
 *
 * Button-IDs sind 0-basiert; B2..B7 der Bedienung = IDs 2..7. Die Seiten-
 * Navigation (IDs 0/1) behandelt die AutomationRuntime vorher selbst.
 */

import { Scene, TransitConfig, TRANSIT_FIRST_BUTTON, TRANSIT_ROUTE_SLOTS, normalizeTransitConfig } from "../model.js";
import { GvhClient, TransitConnection } from "../transit/GvhClient.js";
import { DEVICE_SVG_MAX_BYTES, gvhTripUrl, qrSvg } from "../transit/qr.js";
import { TransitDirections } from "../transit/directions.js";
import {
  TR_BTN,
  TR_PAGE_SIZE,
  TransitRuntimeState,
  TransitView,
  buildTransitView,
  clampScroll,
  detailLines,
  initialTransitState,
  routeStatusOf,
  selectedConnection,
  warningLines,
} from "../transit/transitView.js";

/** Refresh der sichtbaren Ansicht. */
const REFRESH_MS = 30_000;
/** Mindestabstand zwischen zwei Routen-Status-Abfragen (LEDs der Übersicht). */
const ROUTE_STATUS_MS = 2 * 60_000;
/** Zeilen pro B2/B3-Druck in Detail/Meldungen. */
const SCROLL_STEP = 5;
/** Maximal so viele Nachlade-Runden pro Refresh (Schutz der API). */
const MAX_PAGE_FETCHES = 4;

export class TransitController {
  private states = new Map<string, TransitRuntimeState>();
  private scene: Scene | null = null;
  private refreshTimer: ReturnType<typeof setInterval> | null = null;
  private routeStatusAt = new Map<string, number>();
  /** Erhöht sich bei enter/leave – verspätete Antworten werden verworfen. */
  private epoch = 0;
  /** Stadteinwärts/-auswärts der Abfahrten (Tages-Cache je Linie+Richtung). */
  private directions: TransitDirections;

  constructor(
    private client: GvhClient,
    private requestRender: () => void,
  ) {
    this.directions = new TransitDirections((jid) => this.client.journeyStops(jid));
  }

  // ==================== Lebenszyklus ====================

  /** Fahrplan-Seite wird sichtbar: Übersicht zeigen, laden, Refresh starten. */
  enter(scene: Scene): void {
    this.leave();
    this.scene = scene;
    const st = this.state(scene.id);
    this.resetToOverview(st);
    void this.loadOverview(scene, st, this.epoch);
    this.refreshTimer = setInterval(() => this.refresh(), REFRESH_MS);
    this.refreshTimer.unref?.();
  }

  /** Fahrplan-Seite verlassen: Timer stoppen, laufende Antworten verwerfen. */
  leave(): void {
    this.epoch++;
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.scene = null;
  }

  /** Runtime-Stop: zusätzlich allen State verwerfen. */
  stop(): void {
    this.leave();
    this.states.clear();
    this.routeStatusAt.clear();
  }

  view(scene: Scene): TransitView {
    return buildTransitView(this.config(scene), this.state(scene.id));
  }

  // ==================== Buttons ====================

  handleButton(scene: Scene, buttonId: number, press: "click" | "long_press"): void {
    if (press !== "click") return;
    const cfg = this.config(scene);
    const st = this.state(scene.id);

    if (st.view === "overview") {
      const slot = buttonId - TRANSIT_FIRST_BUTTON;
      if (slot < 0 || slot >= TRANSIT_ROUTE_SLOTS || !cfg.routes[slot]) return;
      this.openRoute(scene, st, slot);
      return;
    }

    if (buttonId === TR_BTN.home) {
      this.resetToOverview(st);
      this.requestRender();
      void this.loadOverview(scene, st, this.epoch);
      return;
    }

    switch (st.view) {
      case "list":
        return this.handleList(scene, cfg, st, buttonId);
      case "detail":
        return this.handleDetail(st, buttonId);
      case "warnings":
        return this.handleWarnings(st, buttonId);
      case "qr":
        if (buttonId === TR_BTN.select || buttonId === TR_BTN.qr) {
          st.view = "list";
          st.qrSvg = "";
          this.requestRender();
        }
        return;
    }
  }

  private handleList(scene: Scene, cfg: TransitConfig, st: TransitRuntimeState, id: number): void {
    const pageLen = Math.min(TR_PAGE_SIZE, Math.max(0, st.connections.length - st.offset));
    switch (id) {
      case TR_BTN.up:
        if (st.cursor > 0) st.cursor--;
        else if (st.offset > 0) {
          st.offset = Math.max(0, st.offset - TR_PAGE_SIZE);
          st.cursor = TR_PAGE_SIZE - 1;
        } else return;
        break;
      case TR_BTN.down:
        if (st.cursor < pageLen - 1) st.cursor++;
        else if (st.offset + TR_PAGE_SIZE < st.connections.length) {
          st.offset += TR_PAGE_SIZE;
          st.cursor = 0;
          // Nächste Seite unvollständig → im Hintergrund nachladen.
          if (st.connections.length < st.offset + TR_PAGE_SIZE) void this.loadMore(scene, st, this.epoch);
        } else if (st.ctxLater) {
          void this.loadMore(scene, st, this.epoch, true);
          return;
        } else return;
        break;
      case TR_BTN.select: {
        const sel = selectedConnection(st);
        if (!sel) return;
        st.selectedKey = sel.key;
        st.detailScroll = 0;
        st.view = "detail";
        break;
      }
      case TR_BTN.qr: {
        const sel = selectedConnection(st);
        const route = cfg.routes[st.routeIdx];
        if (!sel || !route) return;
        st.selectedKey = sel.key;
        const url = gvhTripUrl(route.from, route.to, sel.depPlanned);
        console.log(`[Transit] QR → ${url}`);
        const svg = qrSvg(url);
        // Zu große SVGs bringen das Gerät durcheinander → dann nicht senden
        // (die QR-Ansicht zeigt stattdessen einen Hinweis).
        st.qrSvg = svg.length <= DEVICE_SVG_MAX_BYTES ? svg : "";
        st.view = "qr";
        break;
      }
      case TR_BTN.warn:
        if (!this.openWarnings(st, "list")) return;
        break;
      default:
        return;
    }
    this.requestRender();
  }

  private handleDetail(st: TransitRuntimeState, id: number): void {
    const c = selectedConnection(st);
    const total = c ? detailLines(c).length : 0;
    switch (id) {
      case TR_BTN.up:
      case TR_BTN.down: {
        const next = clampScroll(st.detailScroll + (id === TR_BTN.down ? SCROLL_STEP : -SCROLL_STEP), total);
        if (next === st.detailScroll) return;
        st.detailScroll = next;
        break;
      }
      case TR_BTN.select:
        st.view = "list";
        break;
      case TR_BTN.warn:
        if (!this.openWarnings(st, "detail")) return;
        break;
      default:
        return;
    }
    this.requestRender();
  }

  private handleWarnings(st: TransitRuntimeState, id: number): void {
    const c = selectedConnection(st);
    const total = c ? warningLines(c).length : 0;
    switch (id) {
      case TR_BTN.up:
      case TR_BTN.down: {
        const next = clampScroll(st.warnScroll + (id === TR_BTN.down ? SCROLL_STEP : -SCROLL_STEP), total);
        if (next === st.warnScroll) return;
        st.warnScroll = next;
        break;
      }
      case TR_BTN.select:
        st.view = st.warnReturn;
        break;
      default:
        return;
    }
    this.requestRender();
  }

  /** Öffnet die Meldungen der gewählten Verbindung (nur wenn es welche gibt). */
  private openWarnings(st: TransitRuntimeState, from: "list" | "detail"): boolean {
    const sel = selectedConnection(st);
    if (!sel || sel.severity === "none") return false;
    st.selectedKey = sel.key;
    st.warnReturn = from;
    st.warnScroll = 0;
    st.view = "warnings";
    return true;
  }

  // ==================== Laden ====================

  private openRoute(scene: Scene, st: TransitRuntimeState, slot: number): void {
    st.view = "list";
    st.routeIdx = slot;
    st.connections = [];
    st.ctxLater = null;
    st.ctxEarlier = null;
    st.offset = 0;
    st.cursor = 0;
    st.selectedKey = null;
    st.error = null;
    st.updatedAt = null;
    st.loading = true;
    this.requestRender();
    void this.loadRoute(scene, st, this.epoch);
  }

  /** Frühester sinnvoller Abfahrtszeitpunkt (jetzt + Fußweg). */
  private earliest(scene: Scene, slot: number): Date {
    const walk = Math.max(0, Number(this.config(scene).routes[slot]?.walkMinutes ?? 0) || 0);
    return new Date(Date.now() + walk * 60_000);
  }

  private reachable(list: TransitConnection[], earliest: Date): TransitConnection[] {
    const t = earliest.getTime();
    return list.filter((c) => c.depPlanned.getTime() + (c.depDelay ?? 0) * 60_000 >= t);
  }

  /**
   * Lädt die Verbindungen der aktiven Route neu (auch für den Refresh). Bereits
   * weitergeblätterte Seiten werden nachgeladen und die Auswahl bleibt erhalten.
   */
  private async loadRoute(scene: Scene, st: TransitRuntimeState, epoch: number): Promise<void> {
    const slot = st.routeIdx;
    const route = this.config(scene).routes[slot];
    if (!route) return;
    const keepKey = st.selectedKey ?? st.connections[st.offset + st.cursor]?.key ?? null;
    const wantCount = st.offset + TR_PAGE_SIZE;
    st.loading = true;
    try {
      const earliest = this.earliest(scene, slot);
      const first = await this.client.trips(route.from.lid, route.to.lid, { at: earliest });
      let conns = this.reachable(first.connections, earliest);
      let ctxLater = first.ctxLater;
      for (let i = 0; i < MAX_PAGE_FETCHES && conns.length < wantCount && ctxLater; i++) {
        const more = await this.client.trips(route.from.lid, route.to.lid, { ctxScr: ctxLater });
        conns = mergeConnections(conns, more.connections);
        ctxLater = more.connections.length ? more.ctxLater : null;
      }
      if (!this.current(epoch, st, slot)) return;
      st.connections = conns;
      st.ctxLater = ctxLater;
      st.ctxEarlier = first.ctxEarlier;
      this.restoreSelection(st, keepKey);
      st.error = null;
      st.updatedAt = new Date();
      // Frische Daten auch gleich für die Routen-LED der Übersicht nutzen.
      st.routeStatus[slot] = routeStatusOf(conns[0]);
    } catch (err) {
      if (!this.current(epoch, st, slot)) return;
      st.error = (err as Error).message;
      console.warn(`[Transit] Route ${slot + 1}: ${st.error}`);
    } finally {
      if (this.current(epoch, st, slot)) {
        st.loading = false;
        this.requestRender();
      }
    }
  }

  /** Blättert über das Ende hinaus: nächste Verbindungen per ctxScr. */
  private async loadMore(scene: Scene, st: TransitRuntimeState, epoch: number, advance = false): Promise<void> {
    const slot = st.routeIdx;
    const route = this.config(scene).routes[slot];
    if (!route || !st.ctxLater || st.loading) return;
    st.loading = true;
    try {
      const more = await this.client.trips(route.from.lid, route.to.lid, { ctxScr: st.ctxLater });
      if (!this.current(epoch, st, slot)) return;
      const before = st.connections.length;
      st.connections = mergeConnections(st.connections, more.connections);
      st.ctxLater = more.connections.length ? more.ctxLater : null;
      if (advance && st.connections.length > before && st.connections.length > st.offset + TR_PAGE_SIZE) {
        st.offset += TR_PAGE_SIZE;
        st.cursor = 0;
      }
      st.error = null;
    } catch (err) {
      if (!this.current(epoch, st, slot)) return;
      st.error = (err as Error).message;
    } finally {
      if (this.current(epoch, st, slot)) {
        st.loading = false;
        this.requestRender();
      }
    }
  }

  /** Abfahrten der Haltestelle + (gedrosselt) Status aller Routen. */
  private async loadOverview(scene: Scene, st: TransitRuntimeState, epoch: number): Promise<void> {
    const cfg = this.config(scene);
    const tasks: Promise<void>[] = [];

    if (cfg.station) {
      st.loading = true;
      const lid = cfg.station.lid;
      tasks.push(
        this.client
          // Mehr als eine Seite laden: die Übersicht teilt nach Richtung auf
          // und braucht je Richtung genug Abfahrten.
          .departures(lid, 20)
          .then((deps) => this.directions.annotate(deps.filter((d) => !isPast(d.planned, d.delay))))
          .then((deps) => {
            if (epoch !== this.epoch) return;
            st.departures = deps;
            st.error = null;
            st.updatedAt = new Date();
          })
          .catch((err: Error) => {
            if (epoch !== this.epoch) return;
            st.error = err.message;
            console.warn(`[Transit] Abfahrten: ${err.message}`);
          }),
      );
    }

    const lastStatus = this.routeStatusAt.get(scene.id) ?? 0;
    if (Date.now() - lastStatus >= ROUTE_STATUS_MS) {
      this.routeStatusAt.set(scene.id, Date.now());
      cfg.routes.forEach((route, slot) => {
        if (!route) {
          st.routeStatus[slot] = null;
          return;
        }
        const earliest = this.earliest(scene, slot);
        tasks.push(
          this.client
            .trips(route.from.lid, route.to.lid, { at: earliest, count: 3 })
            .then((res) => {
              if (epoch !== this.epoch) return;
              st.routeStatus[slot] = routeStatusOf(this.reachable(res.connections, earliest)[0]);
            })
            .catch(() => {
              if (epoch === this.epoch) st.routeStatus[slot] = null;
            }),
        );
      });
    }

    if (!tasks.length) return;
    this.requestRender();
    await Promise.all(tasks);
    if (epoch !== this.epoch) return;
    st.loading = false;
    if (st.view === "overview") this.requestRender();
  }

  private refresh(): void {
    const scene = this.scene;
    if (!scene) return;
    const st = this.state(scene.id);
    if (st.loading) return;
    switch (st.view) {
      case "overview":
        void this.loadOverview(scene, st, this.epoch);
        break;
      case "list":
      case "detail":
      case "warnings":
        void this.loadRoute(scene, st, this.epoch);
        break;
      default:
        break; // QR: statisch
    }
  }

  // ==================== Helfer ====================

  private state(sceneId: string): TransitRuntimeState {
    let s = this.states.get(sceneId);
    if (!s) {
      s = initialTransitState();
      this.states.set(sceneId, s);
    }
    return s;
  }

  private config(scene: Scene): TransitConfig {
    return normalizeTransitConfig(scene.transit);
  }

  private resetToOverview(st: TransitRuntimeState): void {
    st.view = "overview";
    st.qrSvg = "";
    st.error = null;
    st.loading = false;
    st.selectedKey = null;
  }

  /** Antwort noch relevant? (gleiche Aktivierung, gleiche Route, nicht in der Übersicht) */
  private current(epoch: number, st: TransitRuntimeState, slot: number): boolean {
    return epoch === this.epoch && st.routeIdx === slot && st.view !== "overview";
  }

  private restoreSelection(st: TransitRuntimeState, key: string | null): void {
    const idx = key ? st.connections.findIndex((c) => c.key === key) : -1;
    if (idx >= 0) {
      st.offset = Math.floor(idx / TR_PAGE_SIZE) * TR_PAGE_SIZE;
      st.cursor = idx % TR_PAGE_SIZE;
      return;
    }
    // Auswahl nicht mehr vorhanden (abgefahren) → vorne beginnen bzw. begrenzen.
    const max = Math.max(0, st.connections.length - 1);
    const pos = Math.min(st.offset + st.cursor, max);
    st.offset = Math.floor(pos / TR_PAGE_SIZE) * TR_PAGE_SIZE;
    st.cursor = pos % TR_PAGE_SIZE;
    if (st.view !== "list" && st.selectedKey) {
      // Detail/Meldungen einer abgefahrenen Verbindung → zurück zur Liste.
      st.view = "list";
      st.selectedKey = null;
    }
  }
}

function isPast(planned: Date, delay: number | null): boolean {
  return planned.getTime() + (delay ?? 0) * 60_000 < Date.now() - 30_000;
}

/** Hängt neue Verbindungen an (Duplikate per key verworfen), chronologisch sortiert. */
export function mergeConnections(a: TransitConnection[], b: TransitConnection[]): TransitConnection[] {
  const seen = new Set(a.map((c) => c.key));
  const merged = [...a];
  for (const c of b) if (!seen.has(c.key)) (seen.add(c.key), merged.push(c));
  return merged.sort((x, y) => x.depPlanned.getTime() - y.depPlanned.getTime());
}
