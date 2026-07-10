/**
 * Automation Runtime - Orchestriert die gesamte Button+ Automations-Logik.
 *
 * **Modell:** Trigger (Button-Druck, Seitenwechsel, Intervall, …) lösen benannte
 * Event-Gruppen aus. Jede Gruppe ist eine prozedurale **Timeline** aus Befehlen,
 * die von oben nach unten läuft; Struktur-Befehle (if/while/repeat/forEach)
 * bilden Blöcke.
 *
 * **NICHT verantwortlich für:** MQTT-Publishing/Topics (→ DeviceService),
 * Variablen-Interpolation (→ SceneRenderer).
 */

import { EventEmitter } from "node:events";
import { DeviceService } from "./DeviceService.js";
import { SceneRenderer, SceneRenderConfig, SceneOverrides, emptyOverrides, CookBookRuntimeState } from "./SceneRenderer.js";
import { DeviceConfigOutput } from "./DeviceConfigBuilder.js";
import { VariableState, coerce } from "../engine/variables.js";
import { XMLParser } from "fast-xml-parser";
import { flattenJson } from "../engine/flatten.js";
import { parseTimeline, TimelineNode } from "../engine/timeline.js";
import {
  Scene,
  Command,
  CommandResult,
  Trigger,
  TriggerType,
  EventGroup,
  NavSettings,
  Page,
  VarValue,
  VariableDef,
  DEFAULT_NAV,
  cookbookApiName,
  formatNumberMask,
} from "../model.js";
import { evaluate, interpolate, toBool, toNum, toStr } from "../engine/expr.js";

/** Timeout für httpRequest-Befehle. */
const HTTP_TIMEOUT_MS = 10_000;
/** Sicherheits-Obergrenze für ausgeführte Befehle pro Timeline-Lauf. */
const MAX_STEPS = 100_000;
/** Default-Obergrenze für while-Schleifen ohne eigenes Limit. */
const DEFAULT_WHILE_CAP = 10_000;

/** Kontrollfluss-Signal beim Interpretieren einer Timeline. */
type Flow = "normal" | "break" | "continue" | "return";

/** Laufkontext einer Timeline-Ausführung. */
interface ExecCtx {
  sceneId: string;
  epoch: number;
  steps: number;
  groupStack: Set<string>;
}

export interface RuntimeState {
  active: boolean;
  currentPage: number;
  pageCount: number;
  pageName: string;
  variables: Record<string, VarValue>;
  system: Record<string, VarValue>;
  /** Letztes Ausführungsergebnis pro Befehl-ID (für UI-Feedback). */
  commandResults: Record<string, CommandResult>;
}

export class AutomationRuntime extends EventEmitter {
  private active = false;
  private config: DeviceConfigOutput | null = null;
  private renderConfig: SceneRenderConfig | null = null;
  private scenes = new Map<string, Scene>();
  private scenesByPage: Scene[] = [];
  private nav: NavSettings = DEFAULT_NAV;
  private currentPage = 0;
  private overrides: SceneOverrides = emptyOverrides();

  /** Erhöht sich bei jeder (De-)Aktivierung; laufende Timelines brechen ab. */
  private epoch = 0;
  /** >0 während eine Timeline läuft (unterdrückt Render-Sturm & Trigger-Kaskaden). */
  private timelineDepth = 0;

  private static readonly PUSHBUTTON_RE = /\/button\/(\d+)-(\d+)\/pushbutton$/;

  private intervalTimers: ReturnType<typeof setInterval>[] = [];
  private timeCheckTimer: ReturnType<typeof setInterval> | null = null;

  // ---- Hauptseite / Idle-Rücksprung ----
  /** Seiten-Index der Hauptseite (-1 = keine gesetzt). */
  private homePageIndex = -1;
  /** Idle-Timeout bis zum Rücksprung in ms (0 = aus). */
  private homeTimeoutMs = 0;
  /** Timer für den Idle-Rücksprung; wird bei jeder Eingabe/Seitenwechsel erneuert. */
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private lastVarValues = new Map<string, VarValue>();
  /** Letztes Ergebnis pro Befehl-ID. */
  private lastResults = new Map<string, CommandResult>();

  /** Zuletzt empfangener MQTT-Payload pro Topic (für mqttRead/sensorRead). */
  private mqttLastValues = new Map<string, string>();
  /** Sensor-Slot (z.B. „sens1“) → konfiguriertes Publish-Topic. */
  private sensorTopics = new Map<string, string>();

  // ---- CookBook-Szenen-State ----
  private cookbookStates = new Map<string, CookBookRuntimeState>();
  /** Läuft gerade eine Löschung? Verhindert Doppel-DELETE bei Long-Press-Repeat. */
  private cookbookRemoving = new Set<string>();
  /** Auto-Off-Timer der Wall-LED (rote Long-Press-Anzeige) je Button. */
  private wallLedTimers = new Map<number, ReturnType<typeof setTimeout>>();

  /** Gibt den CookBook-State für eine Szene zurück (lazy init). */
  private getCookBookState(sceneId: string): CookBookRuntimeState {
    let s = this.cookbookStates.get(sceneId);
    if (!s) {
      s = { itemPage: 0, listItems: [], itemIds: {} };
      this.cookbookStates.set(sceneId, s);
    }
    return s;
  }

  constructor(
    private device: DeviceService,
    private renderer: SceneRenderer,
    private vars: VariableState,
  ) {
    super();
    this.vars.on("change", () => {
      // Variable-Changed-Trigger nur bei externen Änderungen (nicht aus einer
      // laufenden Timeline heraus) — verhindert Endlos-Kaskaden.
      if (this.timelineDepth === 0) {
        this.fireVariableChangedTriggers();
        this.render();
      }
      this.trackVarValues();
      // Live-Werte IMMER an die UI spiegeln – auch während einer Timeline und
      // auch wenn render() (mangels Szene) nichts publiziert.
      this.scheduleStateEmit();
    });
  }

  // ==================== LIFECYCLE ====================

  activate(
    config: DeviceConfigOutput,
    scenes: Scene[],
    nav: NavSettings,
    pages: Page[] = [],
    opts: { resetPage?: boolean } = {},
  ): void {
    this.deactivate();
    this.device.resetPublishCache();

    this.config = config;
    this.scenes = new Map(scenes.map((s) => [s.id, s]));
    this.nav = nav;
    this.active = true;
    this.overrides = emptyOverrides();
    this.lastResults.clear();

    this.scenesByPage = config.displayMappings.reduce((acc, m) => {
      if (!acc[m.pageIndex] && this.scenes.has(m.sceneId)) {
        acc[m.pageIndex] = this.scenes.get(m.sceneId)!;
      }
      return acc;
    }, [] as Scene[]);

    // Hauptseite (per ID) auf ihren Seiten-Index (= order) auflösen + Idle-Timeout.
    const homePage = nav.homePageId ? pages.find((p) => p.id === nav.homePageId) : undefined;
    this.homePageIndex = homePage ? homePage.order : -1;
    this.homeTimeoutMs = Math.max(0, (nav.homeTimeoutSeconds ?? 0)) * 1000;

    // Nach einem Deploy immer auf der ersten Seite starten (die Hauptseite muss
    // nicht die erste sein). Sonst den aktuellen Seiten-Index beibehalten.
    if (opts.resetPage) this.currentPage = 0;
    if (this.currentPage >= this.scenesByPage.length) this.currentPage = 0;

    this.renderConfig = this.buildRenderConfig();
    this.updateSystemVars();
    this.trackVarValues();

    // Sensor-Slot → Publish-Topic aus der Gerätekonfig ableiten (für sensorRead).
    this.sensorTopics = this.buildSensorTopicMap(config);

    // Abonnieren: MQTT-Quell-Variablen + statische mqttRead-Topics + Sensor-Topics.
    // (Geräte-Topics unter {prefix}/# werden ohnehin per Wildcard mitgelesen; die
    //  Extra-Abos decken Topics außerhalb des Präfixes ab.)
    this.device.setExtraSubscriptions([
      ...this.vars.mqttSources().map((d) => d.mqttTopic!),
      ...this.collectReadTopics(scenes),
      ...this.collectTriggerTopics(scenes),
      ...this.sensorTopics.values(),
    ].filter(Boolean));

    // Startup-Trigger über alle Szenen.
    this.fireGlobalTriggers("startup");

    this.setupTimers();
    this.scheduleIdleReset();

    const scene = this.currentScene();
    if (scene) {
      this.fireTriggers(scene, "page_enter");
      if (scene.category === "cookbook") void this.fetchCookBookList(scene);
    }

    this.render();
    this.emit("activated");
  }

  deactivate(): void {
    this.clearTimers();
    for (const t of this.wallLedTimers.values()) clearTimeout(t);
    this.wallLedTimers.clear();
    this.epoch++; // laufende Timelines abbrechen
    this.active = false;
    this.config = null;
    this.renderConfig = null;
    this.cookbookStates.clear();
    this.emit("deactivated");
  }

  getState(): RuntimeState {
    const pageName = this.scenesByPage[this.currentPage]?.name ?? "";
    return {
      active: this.active,
      currentPage: this.currentPage,
      pageCount: this.scenesByPage.length,
      pageName,
      variables: this.vars.snapshot(),
      system: this.vars.systemSnapshot(),
      commandResults: Object.fromEntries(this.lastResults),
    };
  }

  /** Merkt das Ergebnis eines Befehls und stößt ein UI-Update an. */
  private recordResult(id: string, status: CommandResult["status"], message: string): void {
    this.lastResults.set(id, { status, message, ts: Date.now() });
    this.scheduleStateEmit();
  }

  /** Kurzform eines Werts für Ergebnismeldungen. */
  private short(v: unknown): string {
    let s: string;
    try {
      s = typeof v === "string" ? v : JSON.stringify(v);
    } catch {
      s = String(v);
    }
    s = s ?? "";
    return s.length > 80 ? s.slice(0, 77) + "…" : s;
  }

  // ==================== RENDERING ====================

  render(): void {
    if (!this.active || !this.renderConfig) return;
    const scene = this.currentScene();
    if (!scene) return;
    const cbState = scene.category === "cookbook" ? this.getCookBookState(scene.id) : undefined;
    this.renderer.renderScene(scene, this.renderConfig, cbState);
    this.emit("state", this.getState());
  }

  private stateEmitScheduled = false;
  /** Gekoppelte, gedrosselte State-Emission (für Live-Variablenanzeige in der UI). */
  private scheduleStateEmit(): void {
    if (this.stateEmitScheduled) return;
    this.stateEmitScheduled = true;
    setTimeout(() => {
      this.stateEmitScheduled = false;
      if (this.active) this.emit("state", this.getState());
    }, 80);
  }

  syncDevicePage(): void {
    if (!this.active) return;
    this.device.setPage(this.currentPage);
  }

  // ==================== EVENT HANDLING ====================

  handleMessage(topic: string, payload: string): void {
    if (!this.active) return;

    // Letzten Wert je Topic cachen – ermöglicht synchrones mqttRead/sensorRead.
    this.mqttLastValues.set(topic, payload);

    // MQTT-Quell-Variablen aktualisieren (unabhängig vom Button-Handling).
    this.applyMqttSources(topic, payload);

    // mqtt_message-Trigger (szenenübergreifend) auf passende Topics feuern.
    this.fireMqttMessageTriggers(topic, payload);

    const match = AutomationRuntime.PUSHBUTTON_RE.exec(topic);
    if (!match) return;

    const position = Number(match[1]);
    const buttonId = position - 1;

    const press = this.parsePress(payload);
    if (!press) return;

    this.adoptDevicePage(Number(match[2]));
    console.log(`[Runtime] 🔘 Button ${buttonId} (pos ${position}) → ${press}`);
    this.handleButton(buttonId, press);
    // Eingabe registriert → Idle-Timer für den Hauptseiten-Rücksprung zurücksetzen.
    this.scheduleIdleReset();
  }

  /** Setzt MQTT-Quell-Variablen aus einer eingehenden Nachricht. */
  private applyMqttSources(topic: string, payload: string): void {
    for (const def of this.vars.mqttSources()) {
      if (!topicMatches(def.mqttTopic!, topic)) continue;
      const value = this.extractMqttValue(def, payload);
      if (value !== undefined) this.vars.set(def.name, value);
    }
  }

  private extractMqttValue(def: VariableDef, payload: string): VarValue | undefined {
    const path = def.mqttJsonPath?.trim();
    if (def.type === "dict") {
      try {
        return flattenJson(JSON.parse(payload));
      } catch {
        return undefined;
      }
    }
    if (path) {
      try {
        const flat = flattenJson(JSON.parse(payload));
        return flat[path];
      } catch {
        return undefined;
      }
    }
    return payload;
  }

  private adoptDevicePage(devicePage: number): void {
    if (!Number.isFinite(devicePage)) return;
    const idx = this.config?.firmwareV2 ? devicePage - 1 : devicePage;
    if (idx === this.currentPage) return;
    if (idx < 0 || idx >= this.scenesByPage.length) return;
    console.warn(`[Runtime] ⚠️ Page desync → adopting device page ${idx}`);
    this.setPage(idx);
  }

  private parsePress(payload: string): "click" | "long_press" | null {
    try {
      const data = JSON.parse(payload) as { event_type?: string };
      if (data.event_type === "shortpress") return "click";
      if (data.event_type === "longpress") return "long_press";
      return null;
    } catch {
      return payload.trim() === "press" ? "click" : null;
    }
  }

  private handleButton(buttonId: number, press: "click" | "long_press"): void {
    // Navigations-Buttons (fest verdrahtet, keine Trigger nötig).
    const nav = this.config?.navButtons;
    if (nav && (buttonId === nav.prev || buttonId === nav.next)) {
      if (press === "click") this.navigateRelative(buttonId === nav.next ? 1 : -1);
      return;
    }

    const scene = this.currentScene();
    if (!scene) return;

    // CookBook-Szenen: eigene Button-Logik (Klick = hinzufügen, Long = entfernen).
    if (scene.category === "cookbook" && scene.cookbook) {
      this.handleCookBookButton(scene, buttonId, press);
      return;
    }

    // Alle passenden Button-Trigger der aktuellen Szene ausführen.
    for (const t of scene.triggers ?? []) {
      if (t.type !== "button" || t.buttonId !== buttonId) continue;
      if ((t.press ?? "click") !== press) continue;
      if (!this.triggerConditionOk(t)) continue;
      this.executeGroup(scene, t.groupId);
    }
  }

  // ==================== TRIGGERS ====================

  private triggerConditionOk(t: Trigger): boolean {
    return !t.condition || !t.condition.trim() || this.evalBool(t.condition);
  }

  /** Führt alle Trigger eines Typs in einer Szene aus. */
  private fireTriggers(scene: Scene, type: TriggerType): void {
    for (const t of scene.triggers ?? []) {
      if (t.type !== type) continue;
      if (!this.triggerConditionOk(t)) continue;
      this.executeGroup(scene, t.groupId);
    }
  }

  /** Führt Trigger eines Typs über ALLE Szenen aus (startup, mqtt_*). */
  private fireGlobalTriggers(type: TriggerType): void {
    for (const scene of this.scenes.values()) this.fireTriggers(scene, type);
  }

  /**
   * Feuert mqtt_message-Trigger (szenenübergreifend), deren Topic-Filter auf die
   * eingehende Nachricht passt. Vor der Ausführung werden `$mqttTopic` und
   * `$mqttPayload` gesetzt, damit die Gruppe (und die Bedingung) sie nutzen kann.
   */
  private fireMqttMessageTriggers(topic: string, payload: string): void {
    const matches: Array<{ scene: Scene; trigger: Trigger }> = [];
    for (const scene of this.scenes.values()) {
      for (const t of scene.triggers ?? []) {
        if (t.type !== "mqtt_message") continue;
        const filter = (t.mqttTopic ?? "").trim();
        if (filter && topicMatches(filter, topic)) matches.push({ scene, trigger: t });
      }
    }
    if (matches.length === 0) return;

    this.vars.setSystem("$mqttTopic", topic);
    this.vars.setSystem("$mqttPayload", payload);
    for (const { scene, trigger } of matches) {
      if (this.triggerConditionOk(trigger)) this.executeGroup(scene, trigger.groupId);
    }
  }

  /** Von DeviceManager bei MQTT-Verbindungswechsel aufgerufen. */
  onMqttConnected(): void {
    if (this.active) this.fireGlobalTriggers("mqtt_connected");
  }
  onMqttDisconnected(): void {
    if (this.active) this.fireGlobalTriggers("mqtt_disconnected");
  }

  private fireVariableChangedTriggers(): void {
    const scene = this.currentScene();
    if (!scene?.triggers) return;
    const current = this.vars.snapshot();

    for (const t of scene.triggers) {
      if (t.type !== "variable_changed" || !t.variableName) continue;
      const oldValue = this.lastVarValues.get(t.variableName);
      const newValue = current[t.variableName];
      if (oldValue === undefined || jsonEq(oldValue, newValue)) continue;
      if (!this.triggerConditionOk(t)) continue;
      this.executeGroup(scene, t.groupId);
    }
  }

  private trackVarValues(): void {
    const current = this.vars.snapshot();
    for (const [k, v] of Object.entries(current)) this.lastVarValues.set(k, v);
  }

  /**
   * Führt eine Gruppe manuell aus (API/Test). Gibt zurück, ob die Gruppe
   * existiert; die Ausführung selbst läuft asynchron.
   */
  runGroupById(sceneId: string, groupId: string): boolean {
    const scene = this.scenes.get(sceneId);
    if (!scene) return false;
    const group = scene.groups?.find((g) => g.id === groupId);
    if (!group) return false;
    this.executeGroup(scene, groupId);
    return true;
  }

  // ==================== TIMELINE EXECUTION ====================

  /** Startet die Timeline einer Gruppe (fire-and-forget) und rendert am Ende. */
  private executeGroup(scene: Scene, groupId: string): void {
    const group = scene.groups?.find((g) => g.id === groupId);
    if (!group) {
      console.warn(`[Runtime] ⚠️ Gruppe ${groupId} nicht gefunden`);
      return;
    }
    const ctx: ExecCtx = { sceneId: scene.id, epoch: this.epoch, steps: 0, groupStack: new Set() };
    this.timelineDepth++;
    void this.runGroup(group, ctx)
      .catch((err: Error) => console.warn(`[Runtime] ⚠️ Timeline „${group.name}“: ${err.message}`))
      .finally(() => {
        this.timelineDepth--;
        this.trackVarValues();
        this.render();
      });
  }

  private async runGroup(group: EventGroup, ctx: ExecCtx): Promise<Flow> {
    if (ctx.groupStack.has(group.id)) {
      console.warn(`[Runtime] ⚠️ Rekursion in Gruppe „${group.name}“ verhindert`);
      return "normal";
    }
    const parsed = parseTimeline(group.commands ?? []);
    if (parsed.error) {
      console.warn(`[Runtime] ⚠️ Gruppe „${group.name}“ ungültig: ${parsed.error}`);
      return "normal";
    }
    ctx.groupStack.add(group.id);
    try {
      return await this.execNodes(parsed.nodes, ctx);
    } finally {
      ctx.groupStack.delete(group.id);
    }
  }

  private async execNodes(nodes: TimelineNode[], ctx: ExecCtx): Promise<Flow> {
    for (const node of nodes) {
      if (!this.stillRunning(ctx)) return "return";
      if (++ctx.steps > MAX_STEPS) {
        console.warn(`[Runtime] ⚠️ Timeline-Limit (${MAX_STEPS} Befehle) erreicht — Abbruch`);
        return "return";
      }
      const flow = await this.execNode(node, ctx);
      if (flow !== "normal") return flow;
    }
    return "normal";
  }

  private async execNode(node: TimelineNode, ctx: ExecCtx): Promise<Flow> {
    switch (node.kind) {
      case "leaf":
        return this.execLeaf(node.cmd, ctx);

      case "if": {
        for (let bi = 0; bi < node.branches.length; bi++) {
          const branch = node.branches[bi];
          if (!branch.cmd || this.evalBool(branch.cmd.condition ?? "")) {
            const label = !branch.cmd ? "Sonst-Zweig" : bi === 0 ? "Bedingung erfüllt" : "Sonst-wenn erfüllt";
            this.recordResult(node.branches[0].cmd!.id, "ok", label);
            return this.execNodes(branch.body, ctx);
          }
        }
        this.recordResult(node.branches[0].cmd!.id, "ok", "keine Bedingung erfüllt");
        return "normal";
      }

      case "while": {
        const cap = node.cmd.maxIterations && node.cmd.maxIterations > 0
          ? node.cmd.maxIterations
          : DEFAULT_WHILE_CAP;
        let i = 0;
        let hitCap = false;
        while (this.stillRunning(ctx) && this.evalBool(node.cmd.condition ?? "")) {
          if (i++ >= cap) {
            console.warn(`[Runtime] ⚠️ while-Schleife nach ${cap} Iterationen abgebrochen`);
            hitCap = true;
            break;
          }
          const flow = await this.execNodes(node.body, ctx);
          if (flow === "break") break;
          if (flow === "return") return "return";
        }
        this.recordResult(node.cmd.id, hitCap ? "warn" : "ok", hitCap ? `nach ${cap} Iterationen abgebrochen (Limit)` : `${i} Iteration(en)`);
        return "normal";
      }

      case "repeat": {
        const n = Math.max(0, Math.trunc(toNum(this.evalExpr(node.cmd.count ?? "0"))));
        let done = 0;
        for (let i = 0; i < n; i++) {
          if (!this.stillRunning(ctx)) break;
          const flow = await this.execNodes(node.body, ctx);
          done++;
          if (flow === "break") break;
          if (flow === "return") return "return";
        }
        this.recordResult(node.cmd.id, "ok", `${done}/${n} Durchlauf(e)`);
        return "normal";
      }

      case "forEach": {
        if (node.cmd.listVar && this.vars.getType(node.cmd.listVar) !== "list") {
          this.recordResult(node.cmd.id, "warn", `„${node.cmd.listVar}" ist keine Liste`);
          return "normal";
        }
        const list = node.cmd.listVar ? this.vars.getList(node.cmd.listVar) : [];
        for (let i = 0; i < list.length; i++) {
          if (!this.stillRunning(ctx)) break;
          if (node.cmd.itemVar) this.vars.set(node.cmd.itemVar, list[i]);
          if (node.cmd.indexVar) this.vars.set(node.cmd.indexVar, i);
          const flow = await this.execNodes(node.body, ctx);
          if (flow === "break") break;
          if (flow === "return") return "return";
        }
        this.recordResult(node.cmd.id, "ok", `${list.length} Element(e)`);
        return "normal";
      }
    }
  }

  private async execLeaf(c: Command, ctx: ExecCtx): Promise<Flow> {
    try {
      return await this.execLeafInner(c, ctx);
    } catch (err) {
      this.recordResult(c.id, "error", `Fehler: ${(err as Error).message}`);
      console.warn(`[Runtime] ⚠️ Befehl ${c.type}: ${(err as Error).message}`);
      return "normal";
    }
  }

  private async execLeafInner(c: Command, ctx: ExecCtx): Promise<Flow> {
    const ok = (msg: string) => this.recordResult(c.id, "ok", msg);
    const warn = (msg: string) => this.recordResult(c.id, "warn", msg);

    switch (c.type) {
      case "break":
        ok("Schleife abgebrochen");
        return "break";
      case "continue":
        ok("nächste Iteration");
        return "continue";
      case "return":
        ok("Gruppe beendet");
        return "return";
      case "label":
        return "normal";

      case "log": {
        const text = interpolate(c.text ?? "", this.vars.scope());
        console.log(`[Timeline] 📝 ${text}`);
        ok(text || "(leer)");
        return "normal";
      }

      case "pause": {
        const ms = Math.max(0, toNum(this.evalExpr(c.durationMs ?? "0")));
        await this.sleep(ms);
        ok(`${ms} ms gewartet`);
        return "normal";
      }

      case "runGroup": {
        const group = this.scenes.get(ctx.sceneId)?.groups?.find((g) => g.id === c.group);
        if (!group) {
          warn("Gruppe nicht gefunden");
          return "normal";
        }
        ok(`Gruppe „${group.name}" ausgeführt`);
        return this.runGroup(group, ctx);
      }

      case "setVar":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const v = this.evalExpr(c.expression);
          this.vars.set(c.variable, v);
          ok(`${c.variable} = ${this.short(this.vars.get(c.variable))}`);
        }
        return "normal";

      case "incVar":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const vt = this.vars.getType(c.variable);
          if (vt !== "int" && vt !== "float") { warn(`„${c.variable}" ist keine Zahl`); return "normal"; }
        }
        {
          const step = c.expression && c.expression.trim()
            ? toNum(this.evalExpr(c.expression))
            : (this.vars.getDef(c.variable)?.step ?? 1);
          this.vars.increment(c.variable, step);
          ok(`${c.variable} = ${this.short(this.vars.get(c.variable))} (${step >= 0 ? "+" : ""}${step})`);
        }
        return "normal";

      case "toggleVar":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        if (this.vars.getType(c.variable) !== "bool") { warn(`„${c.variable}" ist kein Boolean`); return "normal"; }
        this.vars.toggle(c.variable);
        ok(`${c.variable} = ${this.short(this.vars.get(c.variable))}`);
        return "normal";

      case "getVar":
        if (!c.variable || !c.from) { warn("Ziel oder Quelle fehlt"); return "normal"; }
        {
          let v = this.vars.get(c.from) ?? "";
          if (c.asType) v = coerce(c.asType, v);
          this.vars.set(c.variable, v);
          ok(`${c.variable} = ${this.short(this.vars.get(c.variable))}`);
        }
        return "normal";

      case "randomVar":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const lo = Math.trunc(toNum(this.evalExpr(c.min ?? "0")));
          const hi = Math.trunc(toNum(this.evalExpr(c.max ?? "0")));
          const [a, b] = lo <= hi ? [lo, hi] : [hi, lo];
          const r = a + Math.floor(Math.random() * (b - a + 1));
          this.vars.set(c.variable, r);
          ok(`${c.variable} = ${r} (aus ${a}…${b})`);
        }
        return "normal";

      case "mathOp":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const vt = this.vars.getType(c.variable);
          if (vt !== "int" && vt !== "float") { warn(`„${c.variable}" ist keine Zahl`); return "normal"; }
          const n = toNum(this.vars.get(c.variable));
          let out: number;
          if (c.mathMode === "floor") out = Math.floor(n);
          else if (c.mathMode === "ceil") out = Math.ceil(n);
          else {
            const d = c.expression && c.expression.trim() ? Math.trunc(toNum(this.evalExpr(c.expression))) : 0;
            const f = Math.pow(10, Math.max(0, d));
            out = Math.round(n * f) / f;
          }
          this.vars.set(c.variable, out);
          ok(`${c.mathMode ?? "round"}: ${c.variable} = ${this.vars.get(c.variable)}`);
        }
        return "normal";

      case "formatNumber":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const n = toNum(this.evalExpr(c.expression ?? ""));
          const text = formatNumberMask(n, c.pattern ?? "");
          this.vars.set(c.variable, text);
          ok(`${c.variable} = "${text}"`);
        }
        return "normal";

      case "strReplace":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const scope = this.vars.scope();
          const cur = toStr(this.vars.get(c.variable));
          const find = interpolate(c.find ?? "", scope);
          const repl = interpolate(c.replace ?? "", scope);
          const out = find === "" ? cur : c.all === false ? cur.replace(find, repl) : cur.split(find).join(repl);
          this.vars.set(c.variable, out);
          if (find === "") warn("Suchtext leer — unverändert");
          else ok(`${c.variable} = ${this.short(out)}`);
        }
        return "normal";

      case "strSplit":
        if (!c.variable) { warn("keine Ziel-Liste"); return "normal"; }
        {
          const scope = this.vars.scope();
          const src = interpolate(c.from ?? "", scope);
          const sep = interpolate(c.separator ?? "", scope);
          const parts = sep === "" ? [src] : src.split(sep);
          this.vars.set(c.variable, parts);
          ok(`${c.variable} = ${parts.length} Teile ${this.short(parts)}`);
        }
        return "normal";

      case "listOp":
        this.recordResult(c.id, c.variable ? "ok" : "warn", this.execListOp(c));
        return "normal";

      case "range":
        this.recordResult(c.id, c.variable ? "ok" : "warn", this.execRange(c));
        return "normal";

      case "dictSet":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        if (this.vars.getType(c.variable) !== "dict") { warn(`„${c.variable}" ist kein Dict`); return "normal"; }
        {
          const key = this.resolveKey(c.key);
          this.vars.dictSet(c.variable, key, this.evalExpr(c.expression));
          ok(`${c.variable}["${key}"] gesetzt`);
        }
        return "normal";

      case "dictRemove":
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        {
          const key = this.resolveKey(c.key);
          this.vars.dictRemove(c.variable, key);
          ok(`${c.variable}["${key}"] entfernt`);
        }
        return "normal";

      case "dictGet": {
        if (!c.target || !c.from) { warn("Ziel oder Dict-Quelle fehlt"); return "normal"; }
        const dict = this.vars.get(c.from);
        if (dict === undefined) { warn(`Quelle „${c.from}" ist leer/undefiniert`); return "normal"; }
        if (typeof dict !== "object" || Array.isArray(dict)) { warn(`Quelle „${c.from}" ist kein Dict`); return "normal"; }
        const key = this.resolveKey(c.key);
        const obj = dict as Record<string, VarValue>;
        const has = Object.prototype.hasOwnProperty.call(obj, key);
        this.vars.set(c.target, has ? obj[key] : "");
        if (has) {
          ok(`${c.target} = ${this.short(obj[key])}`);
        } else {
          const keys = Object.keys(obj);
          warn(`Schlüssel „${key}" fehlt. Vorhanden: ${keys.length ? this.short(keys) : "(keine)"}`);
        }
        return "normal";
      }

      case "navigate":
        if (c.navTarget === "prev") this.navigateRelative(-1);
        else if (c.navTarget === "goto") this.gotoPage(toNum(this.evalExpr(c.page ?? "0")));
        else this.navigateRelative(1);
        ok(`Seite ${this.currentPage + 1}/${this.scenesByPage.length}`);
        return "normal";

      case "setBrightness": {
        const b = toNum(this.evalExpr(c.expression ?? "100"));
        this.device.setBrightness(b);
        ok(`Helligkeit ${Math.max(0, Math.min(100, Math.round(b)))}`);
        return "normal";
      }

      case "setDisplay":
        if (!c.elementId) { warn("kein Ziel-Element"); return "normal"; }
        this.applyOverride(this.overrides.display, `${ctx.sceneId}:${c.elementId}`, c);
        ok(c.reset ? "zurückgesetzt" : `gesetzt: ${Object.keys(c.props ?? {}).join(", ") || "(nichts)"}`);
        return "normal";

      case "setButton":
        if (c.buttonId === undefined) { warn("kein Ziel-Button"); return "normal"; }
        this.applyOverride(this.overrides.buttons, `${ctx.sceneId}:${c.buttonId}`, c);
        ok(c.reset ? "zurückgesetzt" : `gesetzt: ${Object.keys(c.props ?? {}).join(", ") || "(nichts)"}`);
        return "normal";

      case "mqttPublish": {
        if (!c.topic) { warn("kein Topic"); return "normal"; }
        const scope = this.vars.scope();
        const topic = interpolate(c.topic, scope);
        const payload = interpolate(c.payload ?? "", scope);
        const sent = this.device.publishRaw(topic, payload, c.retain ?? false);
        if (sent) ok(`${topic} = ${this.short(payload)}`);
        else warn("MQTT nicht verbunden — nicht gesendet");
        return "normal";
      }

      case "httpRequest":
        await this.runHttpRequest(c);
        return "normal";

      case "mqttRead": {
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        const topic = interpolate(c.topic ?? "", this.vars.scope()).trim();
        if (!topic) { warn("kein Topic"); return "normal"; }
        const payload = this.mqttLastValues.get(topic);
        if (payload === undefined) { warn(`noch kein Wert auf „${topic}" empfangen`); return "normal"; }
        const value = this.extractPayloadValue(payload, c.jsonPath);
        this.vars.set(c.variable, value);
        ok(`${c.variable} = ${this.short(toStr(value))}`);
        return "normal";
      }

      case "sensorRead": {
        if (!c.variable) { warn("keine Zielvariable"); return "normal"; }
        if (!c.sensorId) { warn("kein Sensor gewählt"); return "normal"; }
        const topic = this.sensorTopics.get(c.sensorId);
        if (!topic) { warn(`Sensor „${c.sensorId}" hat kein Publish-Topic (Deploy nötig)`); return "normal"; }
        const payload = this.mqttLastValues.get(topic);
        if (payload === undefined) { warn(`noch kein Wert von „${c.sensorId}" empfangen`); return "normal"; }
        const value = this.extractPayloadValue(payload, c.jsonPath);
        this.vars.set(c.variable, value);
        ok(`${c.sensorId} → ${c.variable} = ${this.short(toStr(value))}`);
        return "normal";
      }

      default:
        return "normal";
    }
  }

  /** Führt einen Listenbefehl aus und liefert eine Ergebnismeldung zurück. */
  private execListOp(c: Command): string {
    const name = c.variable;
    if (!name) return "keine Liste angegeben";
    if (this.vars.getType(name) !== "list") return `„${name}" ist keine Liste`;
    const list = this.vars.getList(name);
    const idx = (raw: number) => (c.oneBased ? raw - 1 : raw);
    const readTarget = (): string | null => (c.target ? null : "kein Ziel für Lesemodus");

    switch (c.listMode) {
      case "append":
        list.push(this.evalExpr(c.value));
        this.vars.set(name, list);
        return `${name}: angehängt → ${list.length} Elemente`;
      case "prepend":
        list.unshift(this.evalExpr(c.value));
        this.vars.set(name, list);
        return `${name}: vorangestellt → ${list.length} Elemente`;
      case "insertAt": {
        const i = Math.max(0, Math.min(list.length, idx(Math.trunc(toNum(this.evalExpr(c.index ?? "0"))))));
        list.splice(i, 0, this.evalExpr(c.value));
        this.vars.set(name, list);
        return `${name}: eingefügt an ${i} → ${list.length} Elemente`;
      }
      case "set": {
        const i = idx(Math.trunc(toNum(this.evalExpr(c.index ?? "0"))));
        if (i < 0 || i >= list.length) return `Index ${i} außerhalb (0…${list.length - 1})`;
        list[i] = this.evalExpr(c.value);
        this.vars.set(name, list);
        return `${name}[${i}] gesetzt`;
      }
      case "extend": {
        const other = c.from ? this.vars.getList(c.from) : [];
        this.vars.set(name, [...list, ...other]);
        return `${name}: +${other.length} → ${list.length + other.length} Elemente`;
      }
      case "removeAt": {
        const i = idx(Math.trunc(toNum(this.evalExpr(c.index ?? "0"))));
        if (i < 0 || i >= list.length) return `Index ${i} außerhalb (0…${list.length - 1})`;
        list.splice(i, 1);
        this.vars.set(name, list);
        return `${name}: entfernt an ${i} → ${list.length} Elemente`;
      }
      case "removeValue": {
        const v = this.evalExpr(c.value);
        const i = list.findIndex((x) => jsonEq(x, v));
        if (i < 0) return `Wert ${this.short(v)} nicht in Liste`;
        list.splice(i, 1);
        this.vars.set(name, list);
        return `${name}: Wert entfernt → ${list.length} Elemente`;
      }
      case "clear":
        this.vars.set(name, []);
        return `${name} geleert`;
      // Lese-Modi → Ergebnis nach target
      case "first": {
        const err = readTarget(); if (err) return err;
        this.vars.set(c.target!, list[0] ?? "");
        return `${c.target} = ${this.short(list[0] ?? "")}`;
      }
      case "last": {
        const err = readTarget(); if (err) return err;
        this.vars.set(c.target!, list[list.length - 1] ?? "");
        return `${c.target} = ${this.short(list[list.length - 1] ?? "")}`;
      }
      case "get": {
        const err = readTarget(); if (err) return err;
        const i = idx(Math.trunc(toNum(this.evalExpr(c.index ?? "0"))));
        if (i < 0 || i >= list.length) return `Index ${i} außerhalb (0…${list.length - 1})`;
        this.vars.set(c.target!, list[i] ?? "");
        return `${c.target} = ${this.short(list[i] ?? "")}`;
      }
      case "length": {
        const err = readTarget(); if (err) return err;
        this.vars.set(c.target!, list.length);
        return `${c.target} = ${list.length}`;
      }
      case "find": {
        const err = readTarget(); if (err) return err;
        const v = this.evalExpr(c.value);
        const found = list.findIndex((x) => jsonEq(x, v));
        const result = found < 0 ? -1 : c.oneBased ? found + 1 : found;
        this.vars.set(c.target!, result);
        return `${c.target} = ${result}${found < 0 ? " (nicht gefunden)" : ""}`;
      }
      default:
        return "kein Modus gewählt";
    }
  }

  /** Führt einen Range-Befehl aus und liefert eine Ergebnismeldung zurück. */
  private execRange(c: Command): string {
    if (!c.variable) return "keine Zielvariable";
    const nums = expandRange(interpolate(c.rangeExpr ?? "", this.vars.scope()));
    if (nums.length === 0) return "leere/ungültige Zahlenfolge";
    const mode = c.rangeMode ?? "next";

    if (mode === "list") {
      this.vars.set(c.variable, nums);
      return `${c.variable} = ${this.short(nums)}`;
    }
    if (mode === "first") {
      this.vars.set(c.variable, nums[0]);
      return `${c.variable} = ${nums[0]}`;
    }
    if (mode === "last") {
      this.vars.set(c.variable, nums[nums.length - 1]);
      return `${c.variable} = ${nums[nums.length - 1]}`;
    }
    // next / rev: aktuellen Wert im Zyklus weiterschalten.
    const seq = mode === "rev" ? [...nums].reverse() : nums;
    const cur = toNum(this.vars.get(c.variable));
    const pos = seq.indexOf(cur);
    const next = seq[(pos + 1) % seq.length];
    this.vars.set(c.variable, next);
    return `${c.variable} = ${next}`;
  }

  private applyOverride(map: Map<string, Record<string, string>>, key: string, c: Command): void {
    if (c.reset) {
      map.delete(key);
      return;
    }
    map.set(key, { ...map.get(key), ...(c.props ?? {}) });
  }

  /** XML → Objekt (Attribute unter „@_“-Präfix). Wirft bei ungültigem XML. */
  private parseXml(text: string): unknown {
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
    return parser.parse(text);
  }

  private async runHttpRequest(c: Command): Promise<void> {
    const scope = this.vars.scope();
    const url = interpolate(c.url ?? "", scope).trim();
    if (!url) {
      this.recordResult(c.id, "warn", "keine URL");
      return;
    }
    const method = c.method ?? "GET";
    const headers: Record<string, string> = {};
    if (c.headers && c.headers.trim()) {
      try {
        const parsed = JSON.parse(interpolate(c.headers, scope)) as Record<string, unknown>;
        for (const [k, v] of Object.entries(parsed)) headers[k] = toStr(v);
      } catch {
        this.recordResult(c.id, "warn", "Header kein gültiges JSON — ignoriert");
      }
    }
    const hasBody = method === "POST" || method === "PUT";
    const body = hasBody && c.body ? interpolate(c.body, scope) : undefined;
    if (body !== undefined && !("Content-Type" in headers)) headers["Content-Type"] = "application/json";

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
    console.log(`[Runtime] ► httpRequest ${method} ${url}`);
    try {
      const res = await fetch(url, { method, headers, body, signal: controller.signal });
      const text = await res.text();
      console.log(`[Runtime] ✓ httpRequest ${res.status} (${text.length} B)`);
      const okStatus = res.ok ? "ok" : "warn";
      if (!c.variable) {
        this.recordResult(c.id, okStatus, `HTTP ${res.status} (${text.length} B)`);
        return;
      }
      const mode = c.responseMode ?? "json";
      // String-Ziel: Antwort immer 1:1 als Rohtext.
      if (this.vars.getType(c.variable) !== "dict") {
        this.vars.set(c.variable, text);
        this.recordResult(c.id, okStatus, `HTTP ${res.status} → ${c.variable} = ${this.short(text)}`);
        return;
      }
      // dict-Ziel: json/xml parsen und flatten. „raw" ist für dict nicht erlaubt.
      if (mode === "raw") {
        this.recordResult(c.id, "error", `„${c.variable}" ist ein Dict — Modus „raw" nur für String-Ziele`);
        return;
      }
      try {
        const parsed = mode === "xml" ? this.parseXml(text) : JSON.parse(text);
        const flat = flattenJson(parsed);
        this.vars.set(c.variable, flat);
        this.recordResult(c.id, okStatus, `HTTP ${res.status} → ${c.variable}: ${Object.keys(flat).length} Keys (${mode})`);
      } catch {
        this.recordResult(c.id, "error", `HTTP ${res.status}, aber Antwort ist kein gültiges ${mode.toUpperCase()} — „${c.variable}" unverändert`);
      }
    } catch (err) {
      const msg = (err as Error).name === "AbortError" ? `Timeout nach ${HTTP_TIMEOUT_MS} ms` : (err as Error).message;
      this.recordResult(c.id, "error", `Anfrage fehlgeschlagen: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Baut die Zuordnung Sensor-Slot („sens1“…) → konfiguriertes Publish-Topic aus
   * der kompilierten Gerätekonfig. Nur Sensoren mit einem Topic sind lesbar.
   */
  private buildSensorTopicMap(config: DeviceConfigOutput): Map<string, string> {
    const map = new Map<string, string>();
    for (const sensor of config.config.mqttsensors ?? []) {
      const topic = sensor.topics?.[0]?.topic;
      if (sensor.sensorid && topic) map.set(String(sensor.sensorid), topic);
    }
    return map;
  }

  /** Sammelt die Topic-Filter aller mqtt_message-Trigger (für die Abos). */
  private collectTriggerTopics(scenes: Scene[]): string[] {
    const topics: string[] = [];
    for (const scene of scenes) {
      for (const t of scene.triggers ?? []) {
        if (t.type === "mqtt_message" && t.mqttTopic && t.mqttTopic.trim()) {
          topics.push(t.mqttTopic.trim());
        }
      }
    }
    return topics;
  }

  /** Sammelt statische (nicht interpolierte) Topics aus allen mqttRead-Befehlen. */
  private collectReadTopics(scenes: Scene[]): string[] {
    const topics: string[] = [];
    for (const scene of scenes) {
      for (const group of scene.groups ?? []) {
        for (const cmd of group.commands ?? []) {
          if (cmd.type === "mqttRead" && cmd.topic && !cmd.topic.includes("{")) {
            topics.push(cmd.topic.trim());
          }
        }
      }
    }
    return topics;
  }

  /**
   * Extrahiert einen Wert aus einem MQTT-Payload. Ohne JSON-Pfad wird der reine
   * Payload geliefert; mit Pfad der entsprechende Wert aus dem JSON. Numerische
   * Payloads werden als Zahl geliefert, damit man direkt damit rechnen kann.
   */
  private extractPayloadValue(payload: string, jsonPath?: string): VarValue {
    const path = jsonPath?.trim();
    if (path) {
      try {
        const flat = flattenJson(JSON.parse(payload));
        return flat[path] ?? "";
      } catch {
        return "";
      }
    }
    const n = Number(payload);
    return payload.trim() !== "" && !Number.isNaN(n) ? n : payload;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private stillRunning(ctx: ExecCtx): boolean {
    return this.active && ctx.epoch === this.epoch;
  }

  // ==================== NAVIGATION ====================

  private navigateRelative(delta: number): void {
    const len = this.scenesByPage.length;
    if (len === 0) return;
    let idx = this.currentPage + delta;
    idx = this.nav.wrap ? ((idx % len) + len) % len : Math.max(0, Math.min(len - 1, idx));
    this.setPage(idx);
  }

  private gotoPage(idx: number): void {
    const len = this.scenesByPage.length;
    if (len === 0) return;
    this.setPage(Math.max(0, Math.min(len - 1, Math.trunc(idx))));
  }

  private setPage(idx: number): void {
    if (!this.active || idx === this.currentPage) return;

    const oldScene = this.currentScene();
    if (oldScene) this.fireTriggers(oldScene, "page_leave");

    this.currentPage = idx;
    if (this.renderConfig) this.renderConfig.currentPage = idx;
    this.device.setPage(idx);
    this.updateSystemVars();

    const newScene = this.currentScene();
    if (newScene) {
      this.fireTriggers(newScene, "page_enter");
      if (newScene.category === "cookbook") void this.fetchCookBookList(newScene);
    }

    // Nach Seitenwechsel Idle-Timer neu takten (auf Hauptseite: aus; sonst neu).
    this.scheduleIdleReset();

    this.render();
  }

  /**
   * (Re-)Startet den Idle-Timer für den Rücksprung zur Hauptseite. Auf der
   * Hauptseite selbst (oder ohne Konfiguration) wird der Timer nur gestoppt.
   */
  private scheduleIdleReset(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (!this.active || this.homeTimeoutMs <= 0) return;
    if (this.homePageIndex < 0 || this.homePageIndex >= this.scenesByPage.length) return;
    if (this.currentPage === this.homePageIndex) return;

    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.active && this.currentPage !== this.homePageIndex &&
          this.homePageIndex >= 0 && this.homePageIndex < this.scenesByPage.length) {
        console.log(`[Runtime] ${Math.round(this.homeTimeoutMs / 1000)}s ohne Eingabe → Hauptseite`);
        this.setPage(this.homePageIndex);
      }
    }, this.homeTimeoutMs);
  }

  private currentScene(): Scene | undefined {
    return this.scenesByPage[this.currentPage];
  }

  private updateSystemVars(): void {
    const scene = this.currentScene();
    this.vars.setSystem("$page", this.currentPage);
    this.vars.setSystem("$pageIndex", this.currentPage);
    this.vars.setSystem("$pageCount", this.scenesByPage.length);
    this.vars.setSystem("$pageName", scene?.name ?? "");
  }

  // ==================== TIMERS ====================

  private setupTimers(): void {
    this.clearTimers();

    for (const scene of this.scenes.values()) {
      for (const t of scene.triggers ?? []) {
        if (t.type !== "interval" || !t.intervalSeconds || t.intervalSeconds <= 0) continue;
        const timer = setInterval(() => {
          if (this.currentScene()?.id === scene.id && this.triggerConditionOk(t)) {
            this.executeGroup(scene, t.groupId);
          }
        }, t.intervalSeconds * 1000);
        this.intervalTimers.push(timer);
      }
    }

    this.timeCheckTimer = setInterval(() => this.checkTimeTriggers(), 60_000);
  }

  private checkTimeTriggers(): void {
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const scene = this.currentScene();
    if (!scene?.triggers) return;
    for (const t of scene.triggers) {
      if (t.type === "time" && t.timeOfDay === hhmm && this.triggerConditionOk(t)) {
        this.executeGroup(scene, t.groupId);
      }
    }
  }

  private clearTimers(): void {
    for (const timer of this.intervalTimers) clearInterval(timer);
    this.intervalTimers = [];
    if (this.timeCheckTimer) {
      clearInterval(this.timeCheckTimer);
      this.timeCheckTimer = null;
    }
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  // ==================== RENDER CONFIG ====================

  private buildRenderConfig(): SceneRenderConfig {
    if (!this.config) throw new Error("Keine Device-Config für Render-Config.");
    return {
      currentPage: this.currentPage,
      pageCount: this.scenesByPage.length,
      wrap: this.nav.wrap,
      displayMappings: this.config.displayMappings,
      buttonCount: this.config.buttonCount,
      navButtons: this.config.navButtons,
      navLedOn: this.nav.ledOnHex,
      navLedOff: this.nav.ledOffHex,
      overrides: this.overrides,
    };
  }

  // ==================== HELPERS ====================

  private evalExpr(expr: string | undefined): VarValue {
    try {
      return evaluate(expr, this.vars.scope());
    } catch {
      return "";
    }
  }

  private evalBool(expr: string): boolean {
    try {
      return toBool(evaluate(expr, this.vars.scope()));
    } catch {
      return false;
    }
  }

  /**
   * Löst einen Dict-Schlüssel auf: literaler Text mit {var}-Interpolation
   * (NICHT als Ausdruck ausgewertet). „temp" bleibt also „temp", „{k}" wird
   * durch den Wert von k ersetzt.
   */
  private resolveKey(key: string | undefined): string {
    return interpolate(key ?? "", this.vars.scope());
  }

  // ==================== COOKBOOK ====================

  private static readonly CB_ITEMS_PER_PAGE = 4;
  private static readonly CB_ITEM_BUTTON_START = 4;
  private static readonly CB_PAGE_PREV = 2;
  private static readonly CB_PAGE_NEXT = 3;
  private static readonly CB_HTTP_TIMEOUT = 10_000;

  /** Behandelt Button-Drücke in einer CookBook-Szene. */
  private handleCookBookButton(scene: Scene, buttonId: number, press: "click" | "long_press"): void {
    const cb = scene.cookbook!;
    const state = this.getCookBookState(scene.id);
    const totalPages = Math.max(1, Math.ceil(cb.items.length / AutomationRuntime.CB_ITEMS_PER_PAGE));

    // Paginierung (nur Klick).
    if (buttonId === AutomationRuntime.CB_PAGE_PREV) {
      if (press === "click" && state.itemPage > 0) {
        state.itemPage--;
        this.render();
      }
      return;
    }
    if (buttonId === AutomationRuntime.CB_PAGE_NEXT) {
      if (press === "click" && state.itemPage < totalPages - 1) {
        state.itemPage++;
        this.render();
      }
      return;
    }

    // Item-Buttons (IDs 4-7): Klick = hinzufügen, Long-Press = entfernen.
    if (buttonId >= AutomationRuntime.CB_ITEM_BUTTON_START &&
        buttonId < AutomationRuntime.CB_ITEM_BUTTON_START + AutomationRuntime.CB_ITEMS_PER_PAGE) {
      const idx = state.itemPage * AutomationRuntime.CB_ITEMS_PER_PAGE + (buttonId - AutomationRuntime.CB_ITEM_BUTTON_START);
      const item = cb.items[idx];
      if (!item) return;
      if (press === "long_press") {
        // Wall-LED rot = Long-Press registriert (geht nach dem Loslassen aus).
        this.flashWallRed(buttonId);
        void this.removeCookBookItem(scene, buttonId, item.name);
      } else {
        void this.sendCookBookItem(scene, buttonId, item.name);
      }
    }
  }

  /** Sendet ein Item an die CookBook-API und gibt LED-Feedback. */
  private async sendCookBookItem(scene: Scene, buttonId: number, itemName: string): Promise<void> {
    const cb = scene.cookbook!;
    const page = this.currentPage;
    const url = `${cb.endpoint.replace(/\/+$/, "")}/api/shopping-lists/permanent/items`;
    // „~" ist nur eine Umbruch-Markierung fürs Display – aus dem API-Namen entfernen.
    const apiName = cookbookApiName(itemName);

    // LED gelb (pending)
    this.device.setButtonColor(buttonId, page, "#ffaa00");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AutomationRuntime.CB_HTTP_TIMEOUT);

    try {
      console.log(`[CookBook] Sending item "${apiName}" to ${url}`);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: apiName }),
        signal: controller.signal,
      });

      if (res.ok) {
        console.log(`[CookBook] Item "${itemName}" added successfully`);
        // LED grün (Erfolg)
        this.device.setButtonColor(buttonId, page, "#00ff00");

        // Sammellisteninhalt aus Response aktualisieren
        try {
          const list = await res.json() as Record<string, unknown>;
          this.updateCookBookListDisplay(scene.id, list);
        } catch { /* Response-Parsing optional */ }
      } else {
        console.warn(`[CookBook] HTTP ${res.status} for item "${itemName}"`);
        // LED rot (Fehler)
        this.device.setButtonColor(buttonId, page, "#ff0000");
      }
    } catch (err) {
      const msg = (err as Error).name === "AbortError" ? "Timeout" : (err as Error).message;
      console.warn(`[CookBook] Request failed: ${msg}`);
      this.device.setButtonColor(buttonId, page, "#ff0000");
    } finally {
      clearTimeout(timer);
    }

    // Nach 800ms LED ausschalten und re-rendern
    setTimeout(() => {
      if (this.active && this.currentScene()?.id === scene.id) {
        this.device.ledOff(buttonId, page);
        this.render();
      }
    }, 800);
  }

  /** Aktualisiert die gecachten Sammellisteneinträge aus einer API-Response. */
  private updateCookBookListDisplay(sceneId: string, listData: Record<string, unknown>): void {
    const state = this.getCookBookState(sceneId);
    // Die API gibt die Liste mit items/manualItems zurück.
    const items = (listData.manualItems ?? listData.items ?? []) as Array<Record<string, unknown>>;
    const open = items.filter((it) => !it.checked);

    state.listItems = open.map((it) => String(it.name ?? "")).filter(Boolean);
    // Listen-ID (Fallback: „permanent"-Alias wie beim Hinzufügen).
    state.listId = listData.id !== undefined ? String(listData.id) : (state.listId ?? "permanent");
    // Name → Item-ID (für Löschung per Long-Press).
    state.itemIds = {};
    for (const it of open) {
      const name = String(it.name ?? "").trim().toLowerCase();
      const id = it.id ?? it._id ?? it.itemId;
      if (name && id !== undefined && id !== null) state.itemIds[name] = String(id);
    }
    this.render();
  }

  /**
   * Wall-LED (Rückseite) rot als Long-Press-Rückmeldung. Das Gerät wiederholt
   * longpress-Events, solange gedrückt wird (longrepeat); jeder Aufruf erneuert
   * einen Auto-Off-Timer. Kommen keine Events mehr (losgelassen), geht die LED
   * aus. So bleibt sie an, solange gehalten wird.
   */
  private flashWallRed(buttonId: number): void {
    const page = this.currentPage;
    this.device.setLed(buttonId, page, "wall", { color: "#ff0000", on: true });
    const existing = this.wallLedTimers.get(buttonId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      this.wallLedTimers.delete(buttonId);
      if (this.active) this.device.setLed(buttonId, page, "wall", { on: false });
    }, 700);
    this.wallLedTimers.set(buttonId, t);
  }

  /** Entfernt ein Item per Long-Press aus der Sammelliste (DELETE-API). */
  private async removeCookBookItem(scene: Scene, buttonId: number, itemName: string): Promise<void> {
    const cb = scene.cookbook!;
    const page = this.currentPage;
    const state = this.getCookBookState(scene.id);

    const key = cookbookApiName(itemName).trim().toLowerCase();
    const itemId = state.itemIds[key];
    const listId = state.listId ?? "permanent";
    // Nicht auf der Liste → nichts zu entfernen (Button ist ohnehin grün).
    if (!itemId) {
      console.log(`[CookBook] Long-press „${itemName}" — nicht auf der Liste, nichts zu entfernen`);
      return;
    }

    // Long-Press-Repeat des Geräts könnte mehrfach feuern → einmal pro Item.
    const guardKey = `${scene.id}:${itemId}`;
    if (this.cookbookRemoving.has(guardKey)) return;
    this.cookbookRemoving.add(guardKey);

    const url = `${cb.endpoint.replace(/\/+$/, "")}/api/shopping-lists/${encodeURIComponent(listId)}/items/${encodeURIComponent(itemId)}`;

    // LED gelb (pending)
    this.device.setButtonColor(buttonId, page, "#ffaa00");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AutomationRuntime.CB_HTTP_TIMEOUT);
    try {
      console.log(`[CookBook] Removing item "${cookbookApiName(itemName)}" (id ${itemId}) via ${url}`);
      const res = await fetch(url, { method: "DELETE", signal: controller.signal });
      if (res.ok) {
        console.log(`[CookBook] Item "${itemName}" removed successfully`);
        this.device.setButtonColor(buttonId, page, "#00ff00");
        // Aktualisierte Liste aus der Response übernehmen.
        try {
          const list = await res.json() as Record<string, unknown>;
          this.updateCookBookListDisplay(scene.id, list);
        } catch { /* Response-Parsing optional */ }
      } else {
        console.warn(`[CookBook] DELETE HTTP ${res.status} for item "${itemName}"`);
        this.device.setButtonColor(buttonId, page, "#ff0000");
      }
    } catch (err) {
      const msg = (err as Error).name === "AbortError" ? "Timeout" : (err as Error).message;
      console.warn(`[CookBook] Remove failed: ${msg}`);
      this.device.setButtonColor(buttonId, page, "#ff0000");
    } finally {
      clearTimeout(timer);
      this.cookbookRemoving.delete(guardKey);
    }

    // Nach 800ms LED in den Ruhezustand (grün/gelb) zurückrendern.
    setTimeout(() => {
      if (this.active && this.currentScene()?.id === scene.id) {
        this.render();
      }
    }, 800);
  }

  /** Lädt die Sammelliste beim Betreten einer CookBook-Seite. */
  private async fetchCookBookList(scene: Scene): Promise<void> {
    const cb = scene.cookbook;
    if (!cb?.endpoint) return;

    const url = `${cb.endpoint.replace(/\/+$/, "")}/api/shopping-lists/permanent`;
    try {
      console.log(`[CookBook] Fetching permanent list from ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(AutomationRuntime.CB_HTTP_TIMEOUT) });
      if (res.ok) {
        const list = await res.json() as Record<string, unknown>;
        this.updateCookBookListDisplay(scene.id, list);
      } else {
        console.warn(`[CookBook] Fetch list failed: HTTP ${res.status}`);
      }
    } catch (err) {
      console.warn(`[CookBook] Fetch list failed: ${(err as Error).message}`);
    }
  }
}

// ==================== MODUL-HELFER ====================

/** MQTT-Topic-Matcher mit +/#-Wildcards. */
function topicMatches(filter: string, topic: string): boolean {
  if (filter === topic) return true;
  const f = filter.split("/");
  const t = topic.split("/");
  for (let i = 0; i < f.length; i++) {
    if (f[i] === "#") return true;
    if (f[i] === "+") {
      if (t[i] === undefined) return false;
      continue;
    }
    if (f[i] !== t[i]) return false;
  }
  return f.length === t.length;
}

/** Expandiert eine Range-Angabe wie "1-3,6,8-10" zu [1,2,3,6,8,9,10]. */
function expandRange(expr: string): number[] {
  const out: number[] = [];
  for (const partRaw of expr.split(",")) {
    const part = partRaw.trim();
    if (!part) continue;
    const m = /^(-?\d+)\s*-\s*(-?\d+)$/.exec(part);
    if (m) {
      let a = parseInt(m[1], 10);
      const b = parseInt(m[2], 10);
      if (a <= b) for (; a <= b; a++) out.push(a);
      else for (; a >= b; a--) out.push(a);
    } else {
      const n = Number(part);
      if (!Number.isNaN(n)) out.push(n);
    }
  }
  return out;
}

/** Wert-Gleichheit inkl. Objekte/Arrays (per JSON). */
function jsonEq(a: VarValue | undefined, b: VarValue | undefined): boolean {
  if (a === b) return true;
  if (typeof a === "object" || typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}
