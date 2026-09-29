/**
 * Scene Renderer - Übersetzt Szenen-Datenmodell in Device-Kommandos.
 *
 * Diese Klasse ist verantwortlich für:
 * - Interpolation von Variablen in Display/Button-Texten
 * - Evaluation von Ausdrücken (LED-Farben, Bedingungen)
 * - Mapping von UI-Elementen zu Device-Items
 * - Rendering von Szenen auf das physische Gerät
 *
 * Sie verwendet DeviceService für die eigentliche Kommunikation. Button- und
 * Seiten-IDs sind hier durchgehend **0-basiert** (siehe DeviceService).
 */

import { DeviceService } from "./DeviceService.js";
import { resolveIcon } from "./IconResolver.js";
import { Scene, normalizeDisplayElement, CookBookConfig, cookbookDisplayName, cookbookApiName, applyDisplayLineBreaks } from "../model.js";
import { interpolate, formatDisplayValue, evaluate, toStr } from "../engine/expr.js";
import { TransitView } from "../transit/transitView.js";
import { VarValue } from "../model.js";

/**
 * Mapping: UI-Element → Device-Display-Item
 */
export interface DisplayMapping {
  sceneId: string;
  elementId: string;
  displayItemId: number;
  pageIndex: number;
}

/**
 * Laufzeit-Überschreibungen aus setDisplay-/setButton-Aktionen.
 * Key: `${sceneId}:${elementId}` bzw. `${sceneId}:${buttonId}` —
 * Wert: Feld → Template-String (wird wie Basiswerte interpoliert).
 */
export interface SceneOverrides {
  display: Map<string, Record<string, string>>;
  buttons: Map<string, Record<string, string>>;
}

export function emptyOverrides(): SceneOverrides {
  return { display: new Map(), buttons: new Map() };
}

/** Laufzeitdaten einer CookBook-Szene (verwaltet von AutomationRuntime). */
export interface CookBookRuntimeState {
  itemPage: number;
  /** Offene (nicht abgehakte) Sammellisten-Namen – für Anzeige & LED-Farbe. */
  listItems: string[];
  /** ID der Sammelliste (für Item-Löschung via API). */
  listId?: string;
  /** Normalisierter Item-Name → Item-ID der offenen Einträge (für Löschung). */
  itemIds: Record<string, string>;
}

/**
 * Konfiguration für Scene-Rendering
 */
export interface SceneRenderConfig {
  /** Aktuelle Seite (0-basiert) */
  currentPage: number;
  /** Anzahl Seiten insgesamt */
  pageCount: number;
  /** Am Ende zur ersten/letzten Seite springen? */
  wrap: boolean;
  /** Alle Display-Mappings (von allen Seiten) */
  displayMappings: DisplayMapping[];
  /** Anzahl verfügbarer Buttons (0-basiert: IDs 0..buttonCount-1) */
  buttonCount: number;
  /** Navigations-Buttons (0-basierte IDs, prev/next) */
  navButtons: { prev: number; next: number } | null;
  /** LED-Farbe wenn Navigation in die Richtung möglich ist */
  navLedOn: string;
  /** LED-Farbe wenn keine Seite in die Richtung existiert */
  navLedOff: string;
  /** Laufzeit-Überschreibungen (setDisplay/setButton-Aktionen), optional */
  overrides?: SceneOverrides;
}

/**
 * Scene Renderer
 */
export class SceneRenderer {
  constructor(
    private device: DeviceService,
    private getVariableScope: () => Record<string, VarValue | undefined>,
  ) {}

  /**
   * Rendert eine komplette Szene auf das Gerät.
   */
  renderScene(
    scene: Scene,
    config: SceneRenderConfig,
    cookbookState?: CookBookRuntimeState,
    transitView?: TransitView,
  ): void {
    console.log(`[SceneRenderer] Rendering scene "${scene.name}" on page ${config.currentPage}`);

    // Firmware-Fehler (V2/V3): Ändert oder leert man ein Button-Label, schreibt das
    // Gerät den BISHERIGEN Button-Text auf das große Display. Deshalb zuerst die
    // Buttons publizieren und das Hauptdisplay danach (und noch einmal kurz später)
    // erneut setzen — sonst bleibt der alte Button-Text dort hängen. Dedup
    // überspringt unveränderte Display-Topics, darum den Display-Cache verwerfen,
    // sobald wirklich ein Button-Text rausging.
    const cookbook = scene.category === "cookbook" && scene.cookbook;
    const transit = scene.category === "transit" ? transitView : undefined;
    let buttonTextSent = cookbook
      ? this.renderCookBookButtons(scene, config, cookbookState)
      : transit
        ? this.renderTransitButtons(config, transit)
        : this.renderButtons(scene, config, this.getVariableScope());

    if (config.navButtons) {
      buttonTextSent = this.renderNavigationButtons(config) || buttonTextSent;
    }

    if (buttonTextSent) this.device.invalidateDisplayPublishCache();

    if (cookbook) this.renderCookBookDisplay(scene, config, cookbookState);
    else if (transit) this.renderTransitDisplay(scene, config, transit);
    else this.renderDisplayItems(scene, config);

    if (buttonTextSent) this.scheduleDisplayRepair(scene, config, cookbookState, transit);
    else if (this.displayRepairTimer) this.pendingDisplayRepair = { scene, config, cookbookState, transitView: transit };

    console.log(`[SceneRenderer] Rendering complete`);
  }

  /** Bricht einen noch ausstehenden Display-Refresh ab (Runtime-Stop). */
  cancelPendingDisplayRepair(): void {
    if (this.displayRepairTimer) {
      clearTimeout(this.displayRepairTimer);
      this.displayRepairTimer = null;
    }
    this.pendingDisplayRepair = null;
  }

  private displayRepairTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingDisplayRepair: {
    scene: Scene;
    config: SceneRenderConfig;
    cookbookState?: CookBookRuntimeState;
    transitView?: TransitView;
  } | null = null;

  /** Zweites Setzen des Hauptdisplays, nachdem die Firmware den Leak angewendet hat. */
  private scheduleDisplayRepair(
    scene: Scene,
    config: SceneRenderConfig,
    cookbookState?: CookBookRuntimeState,
    transitView?: TransitView,
  ): void {
    this.pendingDisplayRepair = { scene, config, cookbookState, transitView };
    if (this.displayRepairTimer) clearTimeout(this.displayRepairTimer);
    const timer = setTimeout(() => {
      this.displayRepairTimer = null;
      const job = this.pendingDisplayRepair;
      this.pendingDisplayRepair = null;
      if (!job) return;
      this.device.invalidateDisplayPublishCache();
      if (job.scene.category === "cookbook" && job.scene.cookbook) {
        this.renderCookBookDisplay(job.scene, job.config, job.cookbookState);
      } else if (job.transitView) {
        this.renderTransitDisplay(job.scene, job.config, job.transitView);
      } else {
        this.renderDisplayItems(job.scene, job.config);
      }
    }, 350);
    timer.unref?.();
    this.displayRepairTimer = timer;
  }

  // ==================== COOKBOOK ====================

  /** Anzahl Item-Buttons (Positionen 5-8, IDs 4-7). */
  private static readonly CB_ITEMS_PER_PAGE = 4;
  /** Button-IDs die als Item-Buttons fungieren (0-basiert). */
  private static readonly CB_ITEM_BUTTON_START = 4;
  /** Button-IDs für Paginierung (0-basiert). */
  private static readonly CB_PAGE_PREV = 2;
  private static readonly CB_PAGE_NEXT = 3;
  /** Zeilen pro Spalte in der Sammellistenanzeige. */
  private static readonly CB_LIST_ROWS = 5;

  /**
   * Rendert die CookBook-Buttons (Items + Paginierung).
   * @returns true, wenn ein Label tatsächlich publiziert wurde
   */
  private renderCookBookButtons(
    scene: Scene,
    config: SceneRenderConfig,
    cbState?: CookBookRuntimeState,
  ): boolean {
    const cb = scene.cookbook!;
    const state = cbState ?? { itemPage: 0, listItems: [] };
    const page = config.currentPage;
    const totalItemPages = Math.max(1, Math.ceil(cb.items.length / SceneRenderer.CB_ITEMS_PER_PAGE));

    console.log(`[SceneRenderer:CookBook] items=${cb.items.length}, itemPage=${state.itemPage}/${totalItemPages}, systemPage=${page}`);

    let sent = false;

    // Item-Buttons (IDs 4-7)
    const offset = state.itemPage * SceneRenderer.CB_ITEMS_PER_PAGE;
    for (let i = 0; i < SceneRenderer.CB_ITEMS_PER_PAGE; i++) {
      const btnId = SceneRenderer.CB_ITEM_BUTTON_START + i;
      const item = cb.items[offset + i];
      if (item) {
        const displayName = cookbookDisplayName(item.name);
        console.log(`[SceneRenderer:CookBook] Button ${btnId} (pos ${btnId + 1}) label="${displayName}"`);
        sent = this.device.updateButton(btnId, { label: displayName, topLabel: "" }) || sent;
        this.device.setButtonSvg(btnId, page, "");
        // LED-Feedback: grün = noch nicht auf der Liste, gelb = bereits drauf.
        // Verglichen wird der API-Name (ohne „~"), wie er in der Liste steht.
        const listName = cookbookApiName(item.name).trim().toLowerCase();
        const inList = state.listItems.some((n) => n.trim().toLowerCase() === listName);
        this.device.setButtonColor(btnId, page, inList ? "#ffff00" : "#00ff00");
      } else {
        sent = this.device.clearButton(btnId, page) || sent;
        this.device.ledOff(btnId, page);
      }
    }

    // Paginierungs-Buttons (IDs 2-3)
    const canPrev = state.itemPage > 0;
    const canNext = state.itemPage < totalItemPages - 1;

    sent = this.device.updateButton(SceneRenderer.CB_PAGE_PREV, {
      label: canPrev ? "<<" : "", topLabel: "",
    }) || sent;
    this.device.setButtonSvg(SceneRenderer.CB_PAGE_PREV, page, "");
    if (canPrev) {
      this.device.setButtonColor(SceneRenderer.CB_PAGE_PREV, page, "#00ff00");
    } else {
      this.device.ledOff(SceneRenderer.CB_PAGE_PREV, page);
    }

    sent = this.device.updateButton(SceneRenderer.CB_PAGE_NEXT, {
      label: canNext ? ">>" : "", topLabel: "",
    }) || sent;
    this.device.setButtonSvg(SceneRenderer.CB_PAGE_NEXT, page, "");
    if (canNext) {
      this.device.setButtonColor(SceneRenderer.CB_PAGE_NEXT, page, "#00ff00");
    } else {
      this.device.ledOff(SceneRenderer.CB_PAGE_NEXT, page);
    }

    return sent;
  }

  /** Hauptdisplay einer CookBook-Szene: Titel, Sammelliste, Paginierung. */
  private renderCookBookDisplay(
    scene: Scene,
    config: SceneRenderConfig,
    cbState?: CookBookRuntimeState,
  ): void {
    const cb = scene.cookbook!;
    const state = cbState ?? { itemPage: 0, listItems: [], itemIds: {} };
    const page = config.currentPage;
    const totalItemPages = Math.max(1, Math.ceil(cb.items.length / SceneRenderer.CB_ITEMS_PER_PAGE));

    const mappings = config.displayMappings.filter(
      (m) => m.sceneId === scene.id && m.pageIndex === page,
    );

    for (const mapping of mappings) {
      const el = scene.display.find((e) => e.id === mapping.elementId);
      if (!el) continue;

      if (el.id === "cb-title") {
        this.device.updateDisplay(mapping.displayItemId, {
          label: "CookBook", value: "", unit: "", svg: "",
        });
      } else if (el.id === "cb-page") {
        const pageLabel = cb.items.length > SceneRenderer.CB_ITEMS_PER_PAGE
          ? `${state.itemPage + 1} / ${totalItemPages}`
          : "";
        this.device.updateDisplay(mapping.displayItemId, {
          label: "", value: pageLabel, unit: "", svg: "",
        });
      } else if (el.id === "cb-list-l" || el.id === "cb-list-r") {
        // Je Spalte EIN Element: bis zu CB_LIST_ROWS Einträge mit „\n" gestapelt.
        // Links = Einträge 0..4, rechts = 5..9.
        const start = el.id === "cb-list-l" ? 0 : SceneRenderer.CB_LIST_ROWS;
        const value = state.listItems
          .slice(start, start + SceneRenderer.CB_LIST_ROWS)
          .map((n) => `- ${n}`)
          .join("\n");
        this.device.updateDisplay(mapping.displayItemId, {
          label: "", value, unit: "", svg: "",
        });
      }
    }
  }

  // ==================== FAHRPLAN ====================

  /**
   * Rendert die Buttons B2..B7 einer Fahrplan-Szene (Belegung aus der View).
   * @returns true, wenn ein Label tatsächlich publiziert wurde
   */
  private renderTransitButtons(config: SceneRenderConfig, view: TransitView): boolean {
    const page = config.currentPage;
    const nav = config.navButtons;
    let sent = false;
    for (let id = 0; id < config.buttonCount; id++) {
      if (nav && (id === nav.prev || id === nav.next)) continue;
      const b = view.buttons[id];
      if (!b || (!b.label && !b.icon && !b.led)) {
        sent = this.device.clearButton(id, page) || sent;
        this.device.ledOff(id, page);
        continue;
      }
      sent = this.device.updateButton(id, { label: b.label, topLabel: "" }) || sent;
      this.device.setButtonSvg(id, page, resolveIcon(b.icon) ?? "");
      if (b.led) {
        this.device.setButtonColor(id, page, b.led, "front");
        this.device.setLed(id, page, "wall", { on: false });
      } else {
        this.device.ledOff(id, page);
      }
    }
    return sent;
  }

  /** Hauptdisplay einer Fahrplan-Szene (tr-title/-body/-footer/-qr). */
  private renderTransitDisplay(scene: Scene, config: SceneRenderConfig, view: TransitView): void {
    const mappings = config.displayMappings.filter(
      (m) => m.sceneId === scene.id && m.pageIndex === config.currentPage,
    );
    for (const mapping of mappings) {
      const blank = { label: "", value: "", unit: "", svg: "" };
      switch (mapping.elementId) {
        case "tr-title":
          this.device.updateDisplay(mapping.displayItemId, { ...blank, label: view.title });
          break;
        case "tr-body":
          this.device.updateDisplay(mapping.displayItemId, { ...blank, value: view.body });
          break;
        case "tr-footer":
          this.device.updateDisplay(mapping.displayItemId, { ...blank, value: view.footer });
          break;
        case "tr-col2":
          this.device.updateDisplay(mapping.displayItemId, { ...blank, value: view.col2 ?? "", svg: view.qr });
          break;
      }
    }
  }

  /**
   * Rendert nur die Display-Items einer Szene.
   */
  renderDisplayItems(
    scene: Scene,
    config: SceneRenderConfig,
    scope?: Record<string, VarValue | undefined>,
  ): void {
    const vars = scope ?? this.getVariableScope();

    const mappings = config.displayMappings.filter(
      (m) => m.sceneId === scene.id && m.pageIndex === config.currentPage,
    );

    for (const mapping of mappings) {
      const element = scene.display.find((el) => el.id === mapping.elementId);
      if (!element) continue;

      const normalized = normalizeDisplayElement(element as unknown as Record<string, unknown>);

      // Laufzeit-Überschreibungen (setDisplay-Aktion) über die Basiswerte legen.
      const ov = config.overrides?.display.get(`${scene.id}:${mapping.elementId}`);
      const eff = {
        label: ov?.label ?? normalized.label,
        value: ov?.value ?? normalized.value,
        unit: ov?.unit ?? normalized.unit,
        svg: ov?.svg ?? normalized.svg,
        color: ov?.color ?? normalized.color,
      };

      // Display-Icons in der Element-Farbe füllen (Default: weiß).
      const icon = resolveIcon(interpolate(eff.svg ?? "", vars), eff.color);

      this.device.updateDisplay(mapping.displayItemId, {
        label: applyDisplayLineBreaks(interpolate(eff.label, vars)),
        value: applyDisplayLineBreaks(formatDisplayValue(eff.value, vars)),
        unit: eff.unit ? interpolate(eff.unit, vars) : "",
        svg: icon ?? "",
      });
    }
  }

  /**
   * Rendert alle (nicht-Navigations-)Buttons einer Szene.
   * @returns true, wenn ein Label oder Top-Label tatsächlich publiziert wurde
   */
  private renderButtons(
    scene: Scene,
    config: SceneRenderConfig,
    scope: Record<string, VarValue | undefined>,
  ): boolean {
    const navSet = new Set<number>();
    if (config.navButtons) {
      navSet.add(config.navButtons.prev);
      navSet.add(config.navButtons.next);
    }

    const bindings = new Map(scene.buttons.map((b) => [b.buttonId, b]));
    const page = config.currentPage;
    let sent = false;

    for (let id = 0; id < config.buttonCount; id++) {
      if (navSet.has(id)) continue; // Navigations-Buttons separat behandeln

      const binding = bindings.get(id);
      // Laufzeit-Überschreibungen (setButton-Aktion) über das Binding legen.
      // Auch Buttons OHNE Binding lassen sich so zur Laufzeit befüllen.
      const ov = config.overrides?.buttons.get(`${scene.id}:${id}`);

      if (binding || ov) {
        sent = this.device.updateButton(id, {
          label: interpolate(ov?.label ?? binding?.label ?? "", scope),
          topLabel: interpolate(ov?.toplabel ?? binding?.toplabel ?? "", scope),
        }) || sent;
        // Nicht auflösbar/leer → "" publizieren, damit das Gerät garantiert
        // kein (altes) Icon anzeigt.
        this.device.setButtonSvg(
          id,
          page,
          resolveIcon(interpolate(ov?.svg ?? binding?.svg ?? "", scope)) ?? "",
        );

        const ledExpr = ov?.ledColor ?? binding?.ledColor ?? "";
        const color = ledExpr ? this.evaluateLedColor(ledExpr, scope) : null;
        if (color) {
          this.device.setButtonColor(id, page, color, "front");
        } else {
          this.device.setLed(id, page, "front", { on: false });
        }

        // Rück-LED (Gerät: „wall“). wallColor im Befehl setzt sie; leer oder kein
        // Hex schaltet sie aus. Ohne das Feld bleibt sie an, solange die Front-LED
        // leuchtet — sonst aus, wie bisher bei ledOff.
        if (ov && Object.prototype.hasOwnProperty.call(ov, "wallColor")) {
          const wall = ov.wallColor ? this.evaluateLedColor(ov.wallColor, scope) : null;
          if (wall) {
            this.device.setButtonColor(id, page, wall, "wall");
          } else {
            this.device.setLed(id, page, "wall", { on: false });
          }
        } else if (!color) {
          this.device.setLed(id, page, "wall", { on: false });
        }
      } else {
        sent = this.device.clearButton(id, page) || sent;
        this.device.ledOff(id, page);
      }
    }
    return sent;
  }

  /**
   * Rendert Navigations-Buttons (Prev/Next) inkl. LED-Feedback.
   * @returns true, wenn ein Label tatsächlich publiziert wurde
   */
  private renderNavigationButtons(config: SceneRenderConfig): boolean {
    if (!config.navButtons) return false;

    const { prev, next } = config.navButtons;
    const page = config.currentPage;

    const canGoPrev = config.wrap || config.currentPage > 0;
    const canGoNext = config.wrap || config.currentPage < config.pageCount - 1;

    const prevSent = this.device.updateButton(prev, { label: canGoPrev ? "◀" : "", topLabel: "" });
    this.device.setButtonSvg(prev, page, "");
    this.device.setButtonColor(prev, page, canGoPrev ? config.navLedOn : config.navLedOff);

    const nextSent = this.device.updateButton(next, { label: canGoNext ? "▶" : "", topLabel: "" });
    this.device.setButtonSvg(next, page, "");
    this.device.setButtonColor(next, page, canGoNext ? config.navLedOn : config.navLedOff);
    return prevSent || nextSent;
  }

  /**
   * Evaluiert LED-Farb-Ausdruck.
   *
   * Kann sein:
   * - Direkte Hex-Farbe: "#ff0000"
   * - Ausdruck: "active ? '#00ff00' : '#ff0000'"
   */
  private evaluateLedColor(expr: string, scope: Record<string, VarValue | undefined>): string | null {
    const trimmed = expr.trim();
    if (!trimmed) return null;

    if (this.isHexColor(trimmed)) {
      return this.normalizeHex(trimmed);
    }

    try {
      const result = toStr(evaluate(trimmed, scope)).trim();
      if (this.isHexColor(result)) return this.normalizeHex(result);
    } catch {
      // Evaluation fehlgeschlagen → keine Farbe
    }
    return null;
  }

  private isHexColor(v: string): boolean {
    return /^#?[0-9a-fA-F]{6}$/.test(v);
  }

  private normalizeHex(v: string): string {
    return v.startsWith("#") ? v : `#${v}`;
  }

  /**
   * Setzt alle Device-Outputs (Display + Buttons) auf der aktuellen Seite zurück.
   */
  clearAll(config: SceneRenderConfig): void {
    const itemIds = new Set(config.displayMappings.map((m) => m.displayItemId));
    for (const itemId of itemIds) {
      this.device.clearDisplay(itemId);
    }

    for (let id = 0; id < config.buttonCount; id++) {
      this.device.clearButton(id, config.currentPage);
      this.device.ledOff(id, config.currentPage);
    }
  }
}
