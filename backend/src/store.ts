import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AppSettings } from "./buttonplus/types.js";
import { DisplayElement, NavSettings, LedDimSettings, Page, Scene, VariableDef, VarValue, DEFAULT_NAV, DEFAULT_LED_DIM, normalizeSceneDisplay, collectVariableRefsFromScene, defaultVarValue, generateCookBookDisplay } from "./model.js";
import { normalizeLedDim } from "./ledDim.js";
import { loadEnvSettings, mergeSettings, settingsHealedFromEnv, DATA_DIR } from "./config.js";

// v3: Trigger/Befehle-Refactoring – alte Szenen (Actions/Events) sind inkompatibel.
const SCHEMA_VERSION = 3;

interface StoreData {
  schema: number;
  settings: AppSettings;
  pages: Page[];
  scenes: Scene[];
  variables: VariableDef[];
  nav: NavSettings;
  ledDim: LedDimSettings;
  /** Persistierte Laufzeitwerte (Variablen mit persist=true). */
  varValues: Record<string, VarValue>;
}

function isMissingFileError(err: unknown): boolean {
  return err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT";
}

/**
 * JSON-Dateiablage für das gesamte Automations-Modell. Reicht für einen
 * Heimserver völlig aus und lässt sich per Docker-Volume sichern.
 */
export class Store {
  private file: string;
  private backupFile: string;
  private data: StoreData;

  constructor() {
    this.file = path.resolve(DATA_DIR, "store.json");
    this.backupFile = path.resolve(DATA_DIR, "store.json.bak");
    this.data = {
      schema: SCHEMA_VERSION,
      settings: loadEnvSettings(),
      pages: [],
      scenes: [],
      variables: [],
      nav: { ...DEFAULT_NAV },
      ledDim: { ...DEFAULT_LED_DIM, windows: DEFAULT_LED_DIM.windows.map((w) => ({ ...w })) },
      varValues: {},
    };
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const envDefaults = loadEnvSettings();

    try {
      const raw = await fs.readFile(this.file, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      this.data.settings = mergeSettings(parsed.settings, envDefaults);

      const schema = parsed.schema ?? 1;
      // v3: Alte Szenen (Action/Event-Modell) sind mit dem Trigger/Befehl-Modell
      // inkompatibel → verwerfen. Variablen/Settings/Nav bleiben erhalten.
      const legacyWiped = schema < SCHEMA_VERSION;
      if (legacyWiped) {
        console.warn(
          `[Store] Schema ${schema} < ${SCHEMA_VERSION}: alte Szenen/Seiten werden verworfen (inkompatibles Event-Modell).`,
        );
      }

      this.data.schema = SCHEMA_VERSION;
      this.data.pages = legacyWiped ? [] : parsed.pages ?? [];
      this.data.scenes = legacyWiped
        ? []
        : (parsed.scenes ?? []).map((s) => ({
            ...s,
            triggers: s.triggers ?? [],
            display: normalizeSceneDisplay(s.display ?? []),
          }));
      this.data.variables = parsed.variables ?? [];
      this.data.nav = { ...DEFAULT_NAV, ...parsed.nav };
      this.data.ledDim = normalizeLedDim(parsed.ledDim);
      this.data.varValues = parsed.varValues ?? {};

      const migrated = !legacyWiped && (parsed.scenes ?? []).some((s) =>
        (s.display ?? []).some(
          (el) =>
            typeof el === "object" &&
            el !== null &&
            ("content" in el || "type" in el) &&
            !("label" in el && "value" in el),
        ),
      );
      const healed = settingsHealedFromEnv(parsed.settings, this.data.settings);
      const integrity = this.ensureModelIntegrity();
      if (migrated || healed || integrity || legacyWiped) await this.persist();
    } catch (err) {
      if (isMissingFileError(err)) {
        this.data.settings = mergeSettings(undefined, envDefaults);
        await this.persist();
        return;
      }
      console.error(`[Store] ${this.file} konnte nicht geladen werden:`, err);
      await this.tryRestoreBackup(envDefaults);
    }
  }

  /** Versucht store.json.bak zu laden, statt alles zu löschen. */
  private async tryRestoreBackup(envDefaults: AppSettings): Promise<void> {
    try {
      const raw = await fs.readFile(this.backupFile, "utf-8");
      const parsed = JSON.parse(raw) as Partial<StoreData>;
      this.data.settings = mergeSettings(parsed.settings, envDefaults);
      this.data.pages = parsed.pages ?? [];
      this.data.scenes = (parsed.scenes ?? []).map((s) => ({
        ...s,
        triggers: s.triggers ?? [],
        display: normalizeSceneDisplay(s.display ?? []),
      }));
      this.data.variables = parsed.variables ?? [];
      this.data.nav = { ...DEFAULT_NAV, ...parsed.nav };
      this.data.ledDim = normalizeLedDim(parsed.ledDim);
      this.data.varValues = parsed.varValues ?? {};
      console.warn(`[Store] Wiederherstellung aus ${this.backupFile} erfolgreich.`);
      this.ensureModelIntegrity();
      await this.persist();
    } catch {
      console.error(
        `[Store] Kein Backup verfügbar. Bestehende store.json wurde NICHT überschrieben.`,
      );
      this.data.settings = mergeSettings(undefined, envDefaults);
    }
  }

  /**
   * Stellt sicher, dass Szenen mit Inhalt an Seiten hängen und referenzierte
   * Variablen existieren. Ohne Seite wird nichts kompiliert/deployt.
   */
  private ensureModelIntegrity(): boolean {
    let changed = false;
    const knownVars = new Set(this.data.variables.map((v) => v.name));

    for (const scene of this.data.scenes) {
      const hasContent = (scene.display?.length ?? 0) > 0 || (scene.buttons?.length ?? 0) > 0;
      const linked = this.data.pages.some((p) => p.sceneId === scene.id);
      if (hasContent && !linked) {
        this.data.pages.push({
          id: randomUUID(),
          name: scene.name,
          order: this.data.pages.length,
          sceneId: scene.id,
        });
        changed = true;
        console.warn(`[Store] Seite für Szene „${scene.name}“ automatisch angelegt.`);
      }

      for (const ref of collectVariableRefsFromScene(scene)) {
        if (knownVars.has(ref)) continue;
        knownVars.add(ref);
        this.data.variables.push({ name: ref, type: "string", initial: defaultVarValue("string") });
        changed = true;
        console.warn(`[Store] Variable „${ref}“ aus Szene „${scene.name}“ angelegt.`);
      }
    }
    return changed;
  }

  private async persist(): Promise<void> {
    try {
      await fs.copyFile(this.file, this.backupFile);
    } catch {
      /* Erstes Anlegen – noch keine Datei. */
    }
    await fs.writeFile(this.file, JSON.stringify(this.data, null, 2), "utf-8");
  }

  // ---- Export / Import ------------------------------------------------------

  /** Vollständiger Konfig-Snapshot (für Backup/Umzug). Enthält auch Credentials. */
  exportData(): StoreData {
    return JSON.parse(JSON.stringify(this.data)) as StoreData;
  }

  /**
   * Ersetzt die gesamte Konfiguration durch einen Import (wie exportData liefert)
   * und wendet dieselbe Normalisierung/Heilung wie beim Laden an. Persistiert
   * sofort. Wirft bei inkompatiblem Schema.
   */
  async importData(raw: unknown): Promise<void> {
    if (!raw || typeof raw !== "object") throw new Error("Import-Daten sind kein Objekt.");
    const parsed = raw as Partial<StoreData>;
    if (!Array.isArray(parsed.scenes) && !Array.isArray(parsed.pages) && !parsed.settings) {
      throw new Error("Import-Daten sehen nicht wie ein Buttons+-Export aus.");
    }
    if (typeof parsed.schema === "number" && parsed.schema < SCHEMA_VERSION) {
      throw new Error(
        `Import-Schema ${parsed.schema} ist inkompatibel (erwartet ${SCHEMA_VERSION}). Bitte mit einer aktuellen Version exportieren.`,
      );
    }

    const envDefaults = loadEnvSettings();
    this.data.schema = SCHEMA_VERSION;
    this.data.settings = mergeSettings(parsed.settings, envDefaults);
    this.data.pages = parsed.pages ?? [];
    this.data.scenes = (parsed.scenes ?? []).map((s) => ({
      ...s,
      triggers: s.triggers ?? [],
      display: normalizeSceneDisplay(s.display ?? []),
    }));
    this.data.variables = parsed.variables ?? [];
    this.data.nav = { ...DEFAULT_NAV, ...parsed.nav };
    this.data.ledDim = normalizeLedDim(parsed.ledDim);
    this.data.varValues = parsed.varValues ?? {};
    this.ensureModelIntegrity();
    await this.persist();
  }

  // ---- Einstellungen --------------------------------------------------------
  getSettings(): AppSettings {
    return { ...this.data.settings };
  }

  async updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const next = { ...this.data.settings };
    for (const [key, value] of Object.entries(patch) as [keyof AppSettings, string | undefined][]) {
      if (key === "mqttPassword") {
        if (value !== undefined && value !== "") next.mqttPassword = value;
        continue;
      }
      if (value === undefined || value === "") continue;
      next[key] = value;
    }
    this.data.settings = next;
    await this.persist();
    return this.getSettings();
  }

  // ---- Navigation -----------------------------------------------------------
  getNav(): NavSettings {
    return { ...this.data.nav };
  }

  async updateNav(patch: Partial<NavSettings>): Promise<NavSettings> {
    this.data.nav = { ...this.data.nav, ...patch };
    await this.persist();
    return this.getNav();
  }

  // ---- LED-Dimmung ---------------------------------------------------------
  getLedDim(): LedDimSettings {
    return normalizeLedDim(this.data.ledDim);
  }

  async updateLedDim(patch: Partial<LedDimSettings>): Promise<LedDimSettings> {
    this.data.ledDim = normalizeLedDim({ ...this.data.ledDim, ...patch });
    await this.persist();
    return this.getLedDim();
  }

  // ---- Seiten ---------------------------------------------------------------
  getPages(): Page[] {
    return this.data.pages.map((p) => ({ ...p })).sort((a, b) => a.order - b.order);
  }

  async savePage(page: Partial<Page> & { id?: string }): Promise<Page> {
    if (page.id) {
      const idx = this.data.pages.findIndex((p) => p.id === page.id);
      if (idx >= 0) {
        this.data.pages[idx] = { ...this.data.pages[idx], ...page } as Page;
        await this.persist();
        return { ...this.data.pages[idx] };
      }
    }
    const created: Page = {
      id: randomUUID(),
      name: page.name ?? `Seite ${this.data.pages.length + 1}`,
      order: page.order ?? this.data.pages.length,
      sceneId: page.sceneId ?? null,
    };
    this.data.pages.push(created);
    await this.persist();
    return { ...created };
  }

  async deletePage(id: string): Promise<void> {
    this.data.pages = this.data.pages.filter((p) => p.id !== id);
    this.normalizeOrder();
    await this.persist();
  }

  async reorderPages(orderedIds: string[]): Promise<Page[]> {
    orderedIds.forEach((id, i) => {
      const p = this.data.pages.find((x) => x.id === id);
      if (p) p.order = i;
    });
    this.normalizeOrder();
    await this.persist();
    return this.getPages();
  }

  private normalizeOrder(): void {
    this.getPages().forEach((p, i) => {
      const ref = this.data.pages.find((x) => x.id === p.id);
      if (ref) ref.order = i;
    });
  }

  // ---- Szenen ---------------------------------------------------------------
  private hydrateScene(s: Scene): Scene {
    // CookBook-Display ist vollständig generiert (kein User-Edit) – immer frisch
    // erzeugen, damit Änderungen am Generator (Farben, boxtype) sofort greifen.
    const display =
      s.category === "cookbook" ? generateCookBookDisplay() : normalizeSceneDisplay(s.display ?? []);
    return {
      ...s,
      groups: s.groups ?? [],
      triggers: s.triggers ?? [],
      buttons: s.buttons ?? [],
      display,
      cookbook: s.cookbook,
    };
  }

  getScenes(): Scene[] {
    return this.data.scenes.map((s) => this.hydrateScene(s));
  }

  getScene(id: string): Scene | undefined {
    const s = this.data.scenes.find((x) => x.id === id);
    return s ? this.hydrateScene(s) : undefined;
  }

  async saveScene(scene: Partial<Scene> & { id?: string }): Promise<Scene> {
    const now = Date.now();
    const category = scene.category ?? "custom";

    // CookBook-Szenen: Display-Elemente automatisch generieren.
    const resolveDisplay = (fallback: DisplayElement[]): DisplayElement[] => {
      if (category === "cookbook") return generateCookBookDisplay();
      return scene.display ? normalizeSceneDisplay(scene.display) : fallback;
    };

    if (scene.id) {
      const idx = this.data.scenes.findIndex((s) => s.id === scene.id);
      if (idx >= 0) {
        const display = resolveDisplay(this.data.scenes[idx].display);
        this.data.scenes[idx] = { ...this.data.scenes[idx], ...scene, display, updatedAt: now } as Scene;
        this.ensureModelIntegrity();
        await this.persist();
        return { ...this.data.scenes[idx] };
      }
    }
    const created: Scene = {
      id: randomUUID(),
      name: scene.name ?? (category === "cookbook" ? "CookBook" : "Neue Szene"),
      category,
      display: resolveDisplay([]),
      buttons: scene.buttons ?? [],
      groups: scene.groups ?? [],
      triggers: scene.triggers ?? [],
      cookbook: scene.cookbook,
      createdAt: now,
      updatedAt: now,
    };
    this.data.scenes.push(created);
    this.ensureModelIntegrity();
    await this.persist();
    return { ...created };
  }

  async deleteScene(id: string): Promise<void> {
    this.data.scenes = this.data.scenes.filter((s) => s.id !== id);
    for (const p of this.data.pages) if (p.sceneId === id) p.sceneId = null;
    await this.persist();
  }

  // ---- Variablen ------------------------------------------------------------
  getVariables(): VariableDef[] {
    return this.data.variables.map((v) => ({ ...v }));
  }

  async setVariables(vars: VariableDef[]): Promise<VariableDef[]> {
    this.data.variables = vars.map((v) => ({ ...v }));
    // Persistierte Werte verwaister Variablen aufräumen.
    const names = new Set(this.data.variables.map((v) => v.name));
    for (const key of Object.keys(this.data.varValues)) {
      if (!names.has(key)) delete this.data.varValues[key];
    }
    await this.persist();
    return this.getVariables();
  }

  /** Benennt eine Variable um und zieht alle {ref}/direkten Referenzen in Szenen mit. */
  async renameVariable(oldName: string, newName: string): Promise<VariableDef[]> {
    const def = this.data.variables.find((v) => v.name === oldName);
    if (!def) throw new Error(`Variable „${oldName}“ nicht gefunden.`);
    if (this.data.variables.some((v) => v.name === newName)) {
      throw new Error(`Variable „${newName}“ existiert bereits.`);
    }
    def.name = newName;

    const json = JSON.stringify(this.data.scenes);
    // Wort-genaue Ersetzung des Variablennamens in allen Szenen-Textfeldern.
    const re = new RegExp(`\\b${oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    this.data.scenes = JSON.parse(json.replace(re, newName)) as Scene[];

    if (Object.prototype.hasOwnProperty.call(this.data.varValues, oldName)) {
      this.data.varValues[newName] = this.data.varValues[oldName];
      delete this.data.varValues[oldName];
    }
    await this.persist();
    return this.getVariables();
  }

  // ---- Persistierte Laufzeitwerte ------------------------------------------
  getVarValues(): Record<string, VarValue> {
    return { ...this.data.varValues };
  }

  async saveVarValues(values: Record<string, VarValue>): Promise<void> {
    this.data.varValues = { ...values };
    await this.persist();
  }
}
