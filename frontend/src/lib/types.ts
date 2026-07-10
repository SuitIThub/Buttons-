export interface BPConnector {
  id: number;
  type: number;
}

export interface DeviceInfo {
  id: string | null;
  firmware: string | null;
  hasConfig: boolean;
  connectors: BPConnector[];
}

export interface MqttStatus {
  connected: boolean;
  url: string;
  error: string | null;
}

export interface Settings {
  deviceIp: string;
  mqttUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  baseTopic: string;
  deviceId: string;
  hasMqttPassword?: boolean;
}

export interface NavSettings {
  wrap: boolean;
  ledOnHex: string;
  ledOffHex: string;
  /** ID der Hauptseite; leer = aus. */
  homePageId?: string;
  /** Idle-Sekunden bis Rücksprung auf die Hauptseite (0 = aus). */
  homeTimeoutSeconds?: number;
}

export type VarType = "string" | "int" | "float" | "bool" | "list" | "dict" | "enum";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type VarValue = any;

export interface VariableDef {
  name: string;
  type: VarType;
  initial: VarValue;
  description?: string;
  persist?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  computed?: string;
  mqttTopic?: string;
  mqttJsonPath?: string;
}

export interface DisplayElement {
  id: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  align: number;
  color: string;
  /** Kleine Überschrift (MQTT label/set). */
  label: string;
  /** Große Anzeige (MQTT value/set). */
  value: string;
  /** SVG-Icon (MQTT svg/set) - Material Design Icon oder SVG-String. */
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
    unit: base.unit,
    boxtype: base.boxtype,
  };
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type CommandType =
  | "setVar" | "incVar" | "toggleVar" | "getVar" | "randomVar"
  | "mathOp" | "formatNumber"
  | "strReplace" | "strSplit"
  | "listOp" | "range"
  | "dictSet" | "dictRemove" | "dictGet"
  | "if" | "elseif" | "else" | "endif"
  | "while" | "endwhile"
  | "repeat" | "endrepeat"
  | "forEach" | "endforeach"
  | "break" | "continue"
  | "pause" | "return" | "runGroup" | "label"
  | "setDisplay" | "setButton" | "navigate" | "setBrightness"
  | "httpRequest" | "mqttPublish" | "mqttRead" | "sensorRead"
  | "log";

export type ListMode =
  | "first" | "last" | "get" | "length" | "find"
  | "set" | "insertAt" | "append" | "prepend" | "extend"
  | "removeAt" | "removeValue" | "clear";

export type RangeMode = "next" | "rev" | "first" | "last" | "list";

export interface Command {
  id: string;
  type: CommandType;
  enabled?: boolean;
  variable?: string;
  expression?: string;
  key?: string;
  from?: string;
  asType?: VarType;
  target?: string;
  min?: string;
  max?: string;
  find?: string;
  replace?: string;
  all?: boolean;
  separator?: string;
  listMode?: ListMode;
  index?: string;
  value?: string;
  oneBased?: boolean;
  inline?: string;
  rangeExpr?: string;
  rangeMode?: RangeMode;
  condition?: string;
  count?: string;
  maxIterations?: number;
  listVar?: string;
  itemVar?: string;
  indexVar?: string;
  durationMs?: string;
  group?: string;
  text?: string;
  navTarget?: "next" | "prev" | "goto";
  page?: string;
  elementId?: string;
  buttonId?: number;
  props?: Record<string, string>;
  reset?: boolean;
  method?: HttpMethod;
  url?: string;
  body?: string;
  headers?: string;
  responseMode?: "raw" | "json" | "xml";
  topic?: string;
  payload?: string;
  retain?: boolean;
  jsonPath?: string;
  sensorId?: string;
  mathMode?: "round" | "floor" | "ceil";
  pattern?: string;
}

/** Integrierter Sensor des Geräts (für die sensorRead-Auswahl). */
export interface SensorInfo {
  sensorid: string;
  type: number;
  description: string;
}

export type TriggerType =
  | "button"
  | "page_enter" | "page_leave"
  | "interval" | "time"
  | "startup"
  | "mqtt_connected" | "mqtt_disconnected"
  | "mqtt_message"
  | "variable_changed";

export interface Trigger {
  id: string;
  type: TriggerType;
  groupId: string;
  condition?: string;
  buttonId?: number;
  press?: "click" | "long_press";
  intervalSeconds?: number;
  timeOfDay?: string;
  variableName?: string;
  mqttTopic?: string;
}

export interface EventGroup {
  id: string;
  name: string;
  commands: Command[];
}

export interface ButtonBinding {
  buttonId: number;
  label?: string;
  toplabel?: string;
  /** SVG-Icon für den Button (Material Design Icon oder SVG-String). */
  svg?: string;
  ledColor?: string;
}

// ---- CookBook-Szenentyp ------------------------------------------------

export interface CookBookItem {
  id: string;
  name: string;
}

export interface CookBookConfig {
  endpoint: string;
  items: CookBookItem[];
}

export type SceneCategory = "custom" | "cookbook";

export interface Scene {
  id: string;
  name: string;
  category: SceneCategory;
  display: DisplayElement[];
  buttons: ButtonBinding[];
  groups: EventGroup[];
  triggers: Trigger[];
  cookbook?: CookBookConfig;
  createdAt: number;
  updatedAt: number;
}

export interface Page {
  id: string;
  name: string;
  order: number;
  sceneId: string | null;
}

export interface CommandResult {
  status: "ok" | "warn" | "error";
  message: string;
  ts: number;
}

export interface RuntimeState {
  active: boolean;
  currentPage: number;
  pageCount: number;
  pageName: string;
  variables: Record<string, VarValue>;
  system: Record<string, VarValue>;
  commandResults?: Record<string, CommandResult>;
}

export interface StatusResponse {
  mqtt: MqttStatus;
  settings: Settings;
  nav: NavSettings;
  device: DeviceInfo;
  runtime: RuntimeState;
  /** Es gibt gespeicherte, aber noch nicht deployte Modelländerungen. */
  undeployed?: boolean;
}

export interface WsEvent {
  type: "status" | "message" | "event" | "runtime";
  status?: MqttStatus;
  message?: { topic: string; payload: string; ts: number };
  event?: { type: string; buttonId?: number; page?: number; payload: string; ts: number };
  state?: RuntimeState;
}
