/**
 * Typen für die Button+ Gerätekonfiguration.
 * Struktur entspricht dem JSON, das die Firmware unter GET /config liefert
 * und unter POST /configsave erwartet.
 */

export interface BPTopic {
  brokerid: string;
  topic: string;
  payload?: string;
  eventtype: number;
}

export interface BPConnector {
  id: number;
  /** 1 = BAR-Modul (2 Buttons + Mini-Display), 2 = Display-Modul */
  type: number;
}

/** Hardware-Sensor-Deskriptor aus `info.sensors` (identifiziert per `type`). */
export interface BPSensorInfo {
  /** Sensor-Typ, z.B. 1 = Temperatur, 6 = Chip-Temp, 7 = Licht, 8 = Memory, 9 = WiFi. */
  type: number;
  description: string;
}

export interface BPInfo {
  id: string;
  mac?: string;
  ipaddress?: string;
  firmware?: string;
  largedisplay?: number;
  connectors: BPConnector[];
  sensors?: BPSensorInfo[];
}

export interface BPCore {
  name: string;
  location?: string;
  autobackup?: boolean;
  brightness?: number;
  color?: number;
  statusbar?: number;
  topics: BPTopic[];
}

/**
 * Eine physische LED eines Buttons. V3-Firmware verwaltet Front- und Wall-LED
 * getrennt (`frontwall: "front" | "wall"`).
 */
export interface BPButtonLed {
  /** "front" (zur Wand gerichtet) oder "wall" (rückwärtige LED). NICHT "back"! */
  frontwall: "front" | "wall";
  /** Farbe im eingeschalteten Zustand als Dezimalzahl. */
  onrgb: number;
  topics: BPTopic[];
}

export interface BPButton {
  id?: number | string;
  /** V3: kombinierte Kennung „{position}-{page}“, z. B. „1-1“. */
  buttonid?: string;
  label?: string;
  toplabel?: string;
  /** SVG-Icon (SVG Tiny 1.2) direkt in der Config. */
  svg?: string;
  ledcolorfront?: number;
  ledcolorwall?: number;
  longdelay?: number;
  longrepeat?: number;
  topics: BPTopic[];
  /** V3: Front-/Wall-LED-Definitionen. */
  leds?: BPButtonLed[];
  /** V2/V3: Seite (1-basiert) für seitenspezifische Buttons */
  page?: number;
  /** V2/V3: Physische Position des Buttons (1-basiert, 1..8) */
  position?: number;
}

export interface BPDisplayItem {
  /** V2: fortlaufende Item-Nummer als String („0“, „1“, …). */
  displayitemid?: string;
  x: number;
  y: number;
  boxtype?: number;
  fontsize: number;
  align: number;
  width: number;
  label?: string;
  unit?: string;
  /** Textfarbe als Dezimalzahl (Firmware-Format). */
  color?: number;
  page: number;
  topics: BPTopic[];
}

export interface BPBroker {
  brokerid: string;
  url: string;
  port: number;
  wsport?: number;
  username?: string;
  password?: string;
  defaultschema?: boolean;
}

/**
 * MQTT-Publish-Konfiguration eines Sensors (top-level `sensors`).
 * Das Gerät publiziert den Sensorwert alle `interval` Sekunden auf die in
 * `topics` hinterlegten Topics. `topics` ist leer, solange kein Publish-Ziel
 * eingerichtet wurde.
 */
export interface BPSensor {
  /** Slot-Kennung, z.B. „sens1“..„sens5“. */
  sensorid: string;
  /** Sensor-Typ (verweist auf `BPSensorInfo.type`). */
  type: number;
  interval: number;
  topics: BPTopic[];
}

export interface BPConfig {
  info: BPInfo;
  core: BPCore;
  mqttbuttons: BPButton[];
  mqttdisplays: BPDisplayItem[];
  mqttbrokers: BPBroker[];
  mqttsensors: BPSensor[];
}

export interface AppSettings {
  deviceIp: string;
  mqttUrl: string;
  mqttUsername: string;
  mqttPassword: string;
  baseTopic: string;
  deviceId: string;
}
