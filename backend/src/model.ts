/**
 * Domänenmodell der Automations-Engine. Diese Strukturen beschreiben, was der
 * Nutzer konfiguriert (Seiten, Szenen, Variablen, Logik, Events). Der Compiler
 * übersetzt sie in die Button+ Gerätekonfiguration und Topics; die MQTT-Ebene
 * bleibt für den Nutzer vollständig verborgen.
 */

export type VarType = "string" | "int" | "float" | "bool" | "list" | "dict" | "enum";

export type VarValue = string | number | boolean | VarValue[] | { [key: string]: VarValue };

export interface VariableDef {
  name: string;
  type: VarType;
  initial: VarValue;
  /** Freitext-Beschreibung (nur UI/Doku). */
  description?: string;
  /** Wert über Runtime-Neustarts UND Backend-Neustart hinweg sichern. */
  persist?: boolean;
  /** int: Untergrenze (Clamping bei set/inc). */
  min?: number;
  /** int: Obergrenze (Clamping bei set/inc). */
  max?: number;
  /** int: Schrittweite für incVar (Default 1). */
  step?: number;
  /** enum: erlaubte Werte. */
  options?: string[];
  /**
   * Abgeleitete (read-only) Variable: Ausdruck, der bei jeder Auswertung neu
   * berechnet wird. Wenn gesetzt, ist die Variable nicht direkt beschreibbar.
   */
  computed?: string;
  /** MQTT-Quelle: Topic abonnieren, Payload → Variable. */
  mqttTopic?: string;
  /**
   * Optionaler Pfad in eine JSON-Payload (geflattete Key-Notation, z. B.
   * "main/temp"). Leer = ganze Payload (dict → geflattened, sonst Rohtext).
   */
  mqttJsonPath?: string;
}

/** Ein Anzeigeblock auf dem großen Display (Position in % der Displaymaße). */
export interface DisplayElement {
  id: string;
  x: number;
  y: number;
  width: number;
  /** Firmware-Schriftgröße 0..7 */
  fontSize: number;
  /** Ausrichtung 0..8 (siehe constants ALIGN) */
  align: number;
  /** Textfarbe als Hex (#rrggbb) – wird als core.color auf dem Gerät deployt. */
  color: string;
  /** Kleine Überschrift (MQTT label/set). */
  label: string;
  /** Große Anzeige (MQTT value/set). */
  value: string;
  /** SVG-Icon (MQTT svg/set) - z.B. Material Design Icon Namen oder SVG-String */
  svg?: string;
  unit?: string;
  /** Box-Stil: 0 = mit Unterstrich unter dem Wert, 1 = ohne. */
  boxtype?: number;
}

/** Altes Schema: type + content → label + value. */
export function normalizeDisplayElement(raw: Record<string, unknown>): DisplayElement {
  const base = raw as Partial<DisplayElement> & { type?: string; content?: string };
  if (typeof base.label === "string" || typeof base.value === "string") {
    return {
      id: String(base.id ?? ""),
      x: Number(base.x ?? 0),
      y: Number(base.y ?? 0),
      width: Number(base.width ?? 80),
      fontSize: Number(base.fontSize ?? 3),
      align: Number(base.align ?? 0),
      color: String(base.color ?? "#ffffff"),
      label: base.label ?? "",
      value: base.value ?? "",
      svg: base.svg,
      unit: base.unit,
      boxtype: base.boxtype,
    };
  }
  const content = base.content ?? "";
  if (base.type === "value") {
    return {
      id: String(base.id ?? ""),
      x: Number(base.x ?? 0),
      y: Number(base.y ?? 0),
      width: Number(base.width ?? 80),
      fontSize: Number(base.fontSize ?? 3),
      align: Number(base.align ?? 0),
      color: String(base.color ?? "#ffffff"),
      label: "",
      value: content,
      svg: base.svg,
      unit: base.unit,
      boxtype: base.boxtype,
    };
  }
  return {
    id: String(base.id ?? ""),
    x: Number(base.x ?? 0),
    y: Number(base.y ?? 0),
    width: Number(base.width ?? 80),
    fontSize: Number(base.fontSize ?? 3),
    align: Number(base.align ?? 0),
    color: String(base.color ?? "#ffffff"),
    label: content,
    value: "",
    svg: base.svg,
    unit: base.unit,
    boxtype: base.boxtype,
  };
}

export function normalizeSceneDisplay(display: unknown[]): DisplayElement[] {
  return display.map((el) => normalizeDisplayElement(el as Record<string, unknown>));
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

/**
 * Ein einzelner Befehl in der prozeduralen Timeline einer Event-Gruppe.
 *
 * Befehle laufen von oben nach unten in Reihe. Struktur-Befehle (if/while/
 * repeat/forEach mit ihren end*-Markern) bilden Blöcke, die im Editor
 * eingerückt dargestellt und zur Laufzeit als Baum interpretiert werden.
 */
export type CommandType =
  // Variablen
  | "setVar"
  | "incVar"
  | "toggleVar"
  | "getVar"
  | "randomVar"
  // Zahlen
  | "mathOp"
  | "formatNumber"
  // Strings
  | "strReplace"
  | "strSplit"
  // Listen
  | "listOp"
  | "range"
  // Dictionaries
  | "dictSet"
  | "dictRemove"
  | "dictGet"
  // Steuerfluss
  | "if"
  | "elseif"
  | "else"
  | "endif"
  | "while"
  | "endwhile"
  | "repeat"
  | "endrepeat"
  | "forEach"
  | "endforeach"
  | "break"
  | "continue"
  | "pause"
  | "return"
  | "runGroup"
  | "label"
  // Gerät
  | "setDisplay"
  | "setButton"
  | "navigate"
  | "setBrightness"
  // Extern
  | "httpRequest"
  | "mqttPublish"
  | "mqttRead"
  | "sensorRead"
  // Debug
  | "log";

/**
 * Modus des All-in-one-Listenbefehls (listOp).
 * Lese-Modi (first/last/get/length/find) schreiben ihr Ergebnis nach `target`;
 * Mutations-Modi verändern die Liste in `variable`.
 */
export type ListMode =
  | "first"
  | "last"
  | "get"
  | "length"
  | "find"
  | "set"
  | "insertAt"
  | "append"
  | "prepend"
  | "extend"
  | "removeAt"
  | "removeValue"
  | "clear";

export type RangeMode = "next" | "rev" | "first" | "last" | "list";

/** Block-öffnende Befehle (erzeugen Einrückung). */
export const BLOCK_OPENERS: CommandType[] = ["if", "while", "repeat", "forEach"];
/** Block-schließende Befehle. */
export const BLOCK_CLOSERS: CommandType[] = ["endif", "endwhile", "endrepeat", "endforeach"];
/** Zwischenmarker eines if-Blocks. */
export const BLOCK_MIDDLE: CommandType[] = ["elseif", "else"];

export interface Command {
  id: string;
  type: CommandType;
  /** Deaktivierte Befehle bleiben in der Liste, werden aber übersprungen. */
  enabled?: boolean;

  // Zielvariable / allgemeiner Wert
  variable?: string;
  expression?: string;
  key?: string;

  // getVar / strSplit / dictGet / listOp-extend: Quelle
  from?: string;
  asType?: VarType;
  /** Ausgabe-Variable (listOp-Lesemodi, dictGet). */
  target?: string;

  // randomVar: Grenzen (Ausdrücke)
  min?: string;
  max?: string;

  // mathOp: round | floor | ceil (auf einer Zahlen-Variable, in-place).
  mathMode?: "round" | "floor" | "ceil";
  // formatNumber: Ziffern-Maske, z. B. „00.00" → „26.20".
  pattern?: string;

  // strReplace
  find?: string;
  replace?: string;
  all?: boolean;

  // strSplit
  separator?: string;

  // listOp
  listMode?: ListMode;
  index?: string;
  value?: string;
  oneBased?: boolean;
  /** Inline-Liste (JSON-Array oder Komma-Liste) für Read-Modi. */
  inline?: string;

  // range
  rangeExpr?: string;
  rangeMode?: RangeMode;

  // Steuerfluss
  condition?: string;
  /** repeat: Anzahl-Ausdruck. */
  count?: string;
  /** while: Sicherheits-Obergrenze für Iterationen. */
  maxIterations?: number;
  /** forEach: Quell-Listenvariable, Item-Variable, optionale Index-Variable. */
  listVar?: string;
  itemVar?: string;
  indexVar?: string;
  /** pause: Dauer in Millisekunden (Ausdruck). */
  durationMs?: string;
  /** runGroup: ID der auszuführenden Event-Gruppe. */
  group?: string;
  /** label / log: Text. */
  text?: string;

  // navigate
  navTarget?: "next" | "prev" | "goto";
  page?: string;

  // setDisplay / setButton
  elementId?: string;
  buttonId?: number;
  /**
   * Zu überschreibende Felder (Templates, interpolierbar). Nicht enthaltene
   * Felder bleiben unverändert; leerer String leert das Feld auf dem Gerät.
   * Display: label, value, unit, svg, color — Button: label, toplabel,
   * svg, ledColor (Front-LED), wallColor (Rück-LED, Gerätetopic „wall“).
   */
  props?: Record<string, string>;
  /** true = alle Überschreibungen des Ziels entfernen. */
  reset?: boolean;

  // httpRequest
  method?: HttpMethod;
  url?: string;
  body?: string;
  headers?: string;
  /**
   * Interpretation der Antwort. „raw“ = Rohtext (nur String-Ziel). „json“/„xml“
   * = geparst; bei dict-Ziel wird geflattened, bei string-Ziel kommt der Rohtext.
   */
  responseMode?: "raw" | "json" | "xml";

  // mqttPublish
  topic?: string;
  payload?: string;
  retain?: boolean;

  // mqttRead / sensorRead: optionaler JSON-Pfad zum Herausziehen eines Feldes.
  jsonPath?: string;
  // sensorRead: Sensor-Slot („sens1“…„sens5“) des integrierten Sensors.
  sensorId?: string;
}

/** Ergebnis der letzten Ausführung eines Befehls (für UI-Feedback). */
export interface CommandResult {
  status: "ok" | "warn" | "error";
  message: string;
  /** Zeitstempel (ms) der Ausführung. */
  ts: number;
}

export type TriggerType =
  | "button"
  | "page_enter"
  | "page_leave"
  | "interval"
  | "time"
  | "startup"
  | "mqtt_connected"
  | "mqtt_disconnected"
  | "mqtt_message"
  | "variable_changed";

/**
 * Verknüpft ein auslösendes Ereignis mit einer Event-Gruppe. Trigger sind von
 * den Gruppen getrennt: mehrere Trigger können dieselbe Gruppe ausführen.
 */
export interface Trigger {
  id: string;
  type: TriggerType;
  /** ID der auszuführenden Event-Gruppe (innerhalb der Szene). */
  groupId: string;
  /** optionale Bedingung; leer = immer. */
  condition?: string;
  /** button: Button-ID (0-basiert) und Druckart. */
  buttonId?: number;
  press?: "click" | "long_press";
  /** interval: Intervall in Sekunden. */
  intervalSeconds?: number;
  /** time: Zeitpunkt "HH:MM". */
  timeOfDay?: string;
  /** variable_changed: überwachte Variable. */
  variableName?: string;
  /**
   * mqtt_message: Topic-Filter (mit +/#-Wildcards). Bei Treffer stehen
   * `$mqttTopic` und `$mqttPayload` in der Gruppe zur Verfügung.
   */
  mqttTopic?: string;
}

/**
 * Benannte, button-unabhängige Befehls-Timeline innerhalb einer Szene.
 * Enthält KEINEN Trigger mehr – die Auslösung erfolgt über {@link Trigger}.
 */
export interface EventGroup {
  id: string;
  name: string;
  commands: Command[];
}

/** Rein visuelle Konfiguration eines (nicht-Navigations-)Buttons. */
export interface ButtonBinding {
  buttonId: number;
  /** Interpolations-String */
  label?: string;
  toplabel?: string;
  /** SVG-Icon für den Button (Material Design Icons oder SVG-String) */
  svg?: string;
  /** Ausdruck, der eine Hex-Farbe liefert, oder direkte Hex-Farbe */
  ledColor?: string;
}

// ---- CookBook-Szenentyp ------------------------------------------------

export interface CookBookItem {
  id: string;
  name: string;
}

export interface CookBookConfig {
  /** CookBook-Server-URL (z.B. "https://cookbook.example.com") */
  endpoint: string;
  /** Auswählbare Einkaufs-Items */
  items: CookBookItem[];
}

// ---- Fahrplan-Szenentyp (GVH/HAFAS) ------------------------------------

/** Haltestelle aus der HAFAS-Suche (lid = DHID, z. B. „de:03241:11“). */
export interface TransitStop {
  lid: string;
  name: string;
}

/** Eine benannte Route (Start → Ziel) auf einem der 6 Route-Buttons. */
export interface TransitRoute {
  id: string;
  /** Anzeigename auf dem Button. */
  name: string;
  from: TransitStop;
  to: TransitStop;
  /** Fußweg bis zur Starthaltestelle in Minuten – frühere Verbindungen fallen weg. */
  walkMinutes?: number;
}

/** Anzahl Route-Slots = Buttons B2..B7 (0-basierte IDs 2..7). */
export const TRANSIT_ROUTE_SLOTS = 6;
/** 0-basierte ID des ersten Route-Buttons. */
export const TRANSIT_FIRST_BUTTON = 2;

export interface TransitConfig {
  /** Haltestelle der Abfahrtsübersicht. */
  station: TransitStop | null;
  /** Genau TRANSIT_ROUTE_SLOTS Einträge; null = Slot leer. */
  routes: (TransitRoute | null)[];
}

/** Bringt eine (evtl. unvollständige) Transit-Konfig auf die feste Slot-Anzahl. */
export function normalizeTransitConfig(cfg: Partial<TransitConfig> | undefined): TransitConfig {
  const routes = Array.from({ length: TRANSIT_ROUTE_SLOTS }, (_, i) => {
    const r = cfg?.routes?.[i];
    return r && r.from?.lid && r.to?.lid ? r : null;
  });
  return { station: cfg?.station?.lid ? cfg.station : null, routes };
}

export type SceneCategory = "custom" | "cookbook" | "transit";

export interface Scene {
  id: string;
  name: string;
  category: SceneCategory;
  display: DisplayElement[];
  buttons: ButtonBinding[];
  /** Benannte Befehls-Timelines. */
  groups: EventGroup[];
  /** Trigger, die Gruppen ausführen (inkl. Button-Trigger). */
  triggers: Trigger[];
  /** CookBook-spezifische Konfiguration (nur wenn category === "cookbook"). */
  cookbook?: CookBookConfig;
  /** Fahrplan-spezifische Konfiguration (nur wenn category === "transit"). */
  transit?: TransitConfig;
  createdAt: number;
  updatedAt: number;
}

// ---- CookBook Display-Generator ----------------------------------------

/**
 * Erzeugt die festen Display-Elemente für eine CookBook-Szene.
 * Diese werden beim Speichern automatisch in scene.display geschrieben.
 */
export function generateCookBookDisplay(): DisplayElement[] {
  const elements: DisplayElement[] = [];

  // Titel – CookBook-Orange, ohne Unterstrich.
  elements.push({
    id: "cb-title",
    x: 5, y: 2, width: 90,
    fontSize: 5, align: 0, color: "#ed7832",
    label: "CookBook", value: "", boxtype: 1,
  });

  // Sammellisteninhalt: zwei Spalten als JE EIN Element mit Zeilenumbrüchen
  // (bis zu CB_LIST_ROWS Zeilen). Spart ggü. 10 Einzel-Elementen viel
  // Config-Platz (festes /configsave-Limit im Gerät). Der Zeileninhalt wird zur
  // Laufzeit mit „\n" zusammengesetzt (SceneRenderer.renderCookBookDisplay).
  const startY = 22;
  elements.push({
    id: "cb-list-l",
    x: 3, y: startY, width: 46,
    fontSize: 1, align: 0, color: "#cccccc",
    label: "", value: "", boxtype: 1,
  });
  elements.push({
    id: "cb-list-r",
    x: 52, y: startY, width: 46,
    fontSize: 1, align: 0, color: "#cccccc",
    label: "", value: "", boxtype: 1,
  });

  // Paginierung
  elements.push({
    id: "cb-page",
    x: 5, y: 92, width: 90,
    fontSize: 1, align: 4, color: "#888888",
    label: "", value: "", boxtype: 1,
  });

  return elements;
}

// ---- Fahrplan Display-Generator ----------------------------------------

/**
 * Erzeugt die festen Display-Elemente einer Fahrplan-Szene. Alle Ansichten
 * (Übersicht, Verbindungsliste, Detail, Meldungen, QR) teilen sich dieses
 * Layout – das Layout liegt nach dem Deploy fest im Gerät, nur Texte/SVG
 * wechseln zur Laufzeit (SceneRenderer.renderTransitDisplay).
 */
export function generateTransitDisplay(): DisplayElement[] {
  return [
    // Kopfzeile: Haltestelle bzw. „Start → Ziel“.
    {
      id: "tr-title",
      x: 3, y: 2, width: 94,
      fontSize: 3, align: 0, color: "#97bf0d",
      label: "", value: "", boxtype: 1,
    },
    // Inhalt: EIN mehrzeiliges Element, Zeilen zur Laufzeit per „\n“ gestapelt
    // (max. TR_BODY_LINES, endet oberhalb der Fußzeile). In der Übersicht die
    // linke Spalte (Zeit + Verspätung).
    {
      id: "tr-body",
      x: 3, y: 14, width: 94,
      fontSize: 1, align: 0, color: "#dddddd",
      label: "", value: "", boxtype: 1,
    },
    // Zweite Spalte der Übersicht (Linie + Ziel); trägt auch ein evtl. SVG.
    // Proportionalschrift → Spalten nur über eigene Elemente sauber ausrichtbar.
    {
      id: "tr-col2",
      x: 27, y: 14, width: 70,
      fontSize: 1, align: 0, color: "#dddddd",
      label: "", value: "", boxtype: 1,
    },
    // Statuszeile: Seite, Stand, Fehler. Liegt ÜBER der festen Gerätezeile
    // (IP, WLAN, Speicher) am unteren Displayrand.
    {
      id: "tr-footer",
      x: 3, y: 83, width: 94,
      fontSize: 0, align: 0, color: "#888888",
      label: "", value: "", boxtype: 1,
    },
  ];
}

/**
 * CookBook-Item-Name für die Button-Anzeige: „~" wird zu „-".
 * So kann man in „Taschen~tücher" eine saubere Umbruchstelle vorgeben – auf dem
 * Button-Display erscheint „Taschen-tücher" und bricht am Bindestrich um.
 */
export function cookbookDisplayName(name: string): string {
  return (name ?? "").replace(/~/g, "-");
}

/**
 * Wandelt Zeilenumbruch-Markierungen im Display-Text in echte Zeilenumbrüche
 * (U+000A). Der Nutzer kann „\n" oder „<br>" schreiben; das Gerät rendert den
 * eingebetteten Zeilenumbruch im Text. Gilt für Label und Wert eines
 * Display-Elements.
 */
export function applyDisplayLineBreaks(text: string): string {
  return (text ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n");
}

/**
 * CookBook-Item-Name für die API: „~" wird entfernt.
 * „Taschen~tücher" → „Taschentücher" – die Umbruch-Markierung ist nur fürs
 * Display gedacht und darf nicht in die Einkaufsliste gelangen.
 */
export function cookbookApiName(name: string): string {
  return (name ?? "").replace(/~/g, "");
}

export interface Page {
  id: string;
  name: string;
  /** Reihenfolge bestimmt Prev/Next-Navigation */
  order: number;
  sceneId: string | null;
}

export interface NavSettings {
  /** Am Ende zur ersten/letzten Seite springen? */
  wrap: boolean;
  /** LED-Farbe wenn Navigation in die Richtung möglich ist */
  ledOnHex: string;
  /** LED-Farbe wenn keine Seite in die Richtung existiert */
  ledOffHex: string;
  /** ID der Hauptseite; leer = Funktion aus. */
  homePageId?: string;
  /** Idle-Sekunden bis zum Rücksprung auf die Hauptseite (0 = aus). Default 300. */
  homeTimeoutSeconds?: number;
}

export const DEFAULT_NAV: NavSettings = {
  wrap: false,
  ledOnHex: "#00ff00",
  ledOffHex: "#ff0000",
  homePageId: "",
  homeTimeoutSeconds: 300,
};

/** Eine Zeitspanne (lokal, 24h, HH:MM). `start` nach `end` gilt über Mitternacht. */
export interface LedDimWindow {
  start: string;
  end: string;
}

/** Zeitgesteuerte Reduktion der Button-LED-Helligkeit. */
export interface LedDimSettings {
  enabled: boolean;
  /** Prozent der vollen LED-Helligkeit während aktiver Zeitspannen (0–100). */
  brightnessPercent: number;
  /** IANA-Zeitzone für die Zeitspannen. Default Europe/Berlin. */
  timeZone?: string;
  windows: LedDimWindow[];
}

export const DEFAULT_LED_DIM: LedDimSettings = {
  enabled: false,
  brightnessPercent: 20,
  timeZone: "Europe/Berlin",
  windows: [{ start: "22:00", end: "06:00" }],
};

export function defaultVarValue(type: VarType): VarValue {
  switch (type) {
    case "string":
    case "enum":
      return "";
    case "int":
    case "float":
      return 0;
    case "bool":
      return false;
    case "list":
      return [];
    case "dict":
      return {};
  }
}

/**
 * Formatiert eine Zahl nach einer Ziffern-Maske aus Nullen. Links vom Punkt =
 * minimale Ganzzahl-Stellen (führende Nullen), rechts = feste Nachkommastellen.
 * Beispiele: 26.2 + "00.00" → "26.20" · 5.1 + "00.00" → "05.10" ·
 * 123.456 + "0.0" → "123.5" · 7 + "000" → "007".
 */
export function formatNumberMask(value: number, pattern: string): string {
  const n = Number.isFinite(value) ? value : 0;
  const p = (pattern ?? "").trim();
  if (!p) return String(n);
  const neg = n < 0;
  const abs = Math.abs(n);
  const dot = p.indexOf(".");
  const intMask = dot >= 0 ? p.slice(0, dot) : p;
  const decMask = dot >= 0 ? p.slice(dot + 1) : "";
  const decimals = (decMask.match(/0/g) ?? []).length;
  const minInt = (intMask.match(/0/g) ?? []).length;
  const [rawInt, rawDec = ""] = abs.toFixed(decimals).split(".");
  const intPart = rawInt.padStart(minInt, "0");
  const out = decimals > 0 ? `${intPart}.${rawDec}` : intPart;
  return neg ? `-${out}` : out;
}

const VAR_REF = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Einfache Variablennamen aus {name}-Platzhaltern in Texten. */
export function extractVariableNamesFromText(text: string | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  for (const m of text.matchAll(VAR_REF)) out.add(m[1]);
  return [...out];
}

/** Textfelder eines Befehls, die {var}-Referenzen enthalten können. */
function collectFromCommand(c: Command, out: Set<string>): void {
  const texts = [
    c.expression, c.condition, c.page, c.url, c.body, c.headers,
    c.find, c.replace, c.separator, c.index, c.value, c.inline,
    c.rangeExpr, c.count, c.durationMs, c.text, c.min, c.max, c.key,
    c.topic, c.payload,
  ];
  for (const t of texts) extractVariableNamesFromText(t).forEach((n) => out.add(n));
  for (const v of Object.values(c.props ?? {})) {
    extractVariableNamesFromText(v).forEach((n) => out.add(n));
  }
  // Direkt referenzierte Variablennamen (keine {…}-Syntax).
  for (const name of [c.variable, c.from, c.listVar, c.itemVar, c.indexVar]) {
    if (name && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) out.add(name);
  }
}

/** Alle Variablen-Referenzen in einer Szene (Display, Buttons, Gruppen, Trigger). */
export function collectVariableRefsFromScene(scene: Scene): string[] {
  const out = new Set<string>();
  for (const el of scene.display ?? []) {
    extractVariableNamesFromText(el.label).forEach((n) => out.add(n));
    extractVariableNamesFromText(el.value).forEach((n) => out.add(n));
    extractVariableNamesFromText(el.unit).forEach((n) => out.add(n));
  }
  for (const b of scene.buttons ?? []) {
    extractVariableNamesFromText(b.label).forEach((n) => out.add(n));
    extractVariableNamesFromText(b.toplabel).forEach((n) => out.add(n));
    extractVariableNamesFromText(b.ledColor).forEach((n) => out.add(n));
  }
  for (const g of scene.groups ?? []) {
    for (const c of g.commands ?? []) collectFromCommand(c, out);
  }
  for (const t of scene.triggers ?? []) {
    extractVariableNamesFromText(t.condition).forEach((n) => out.add(n));
    if (t.variableName) out.add(t.variableName);
  }
  return [...out].filter((n) => !n.startsWith("$"));
}
