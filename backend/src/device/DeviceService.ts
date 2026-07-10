/**
 * Unified Device Service - Zentrale Schnittstelle für alle Device-Interaktionen.
 *
 * Diese Service-Schicht abstrahiert die MQTT-Kommunikation und bietet
 * typisierte, universelle APIs für Display, Buttons, LEDs und Navigation.
 *
 * ============================================================================
 * WICHTIG: Button-Nummerierung (Single Source of Truth: MQTT-TOPICS-REFERENCE.md)
 * ============================================================================
 * - Intern (Modell/Frontend/Runtime) sind Buttons **0-basiert** (0..N-1),
 *   passend zur Connector-Zuordnung `id = connectorIndex * 2 (+1)`.
 * - Das **Gerät** adressiert Buttons über physische **Positionen 1..8**.
 * - Umrechnung: `position = buttonId + 1`. Diese Konvertierung passiert
 *   AUSSCHLIESSLICH hier, an der Geräte-Grenze. Alle anderen Schichten
 *   arbeiten konsequent mit 0-basierten buttonIds.
 *
 * Analog werden Seiten intern 0-basiert geführt; das Gerät erwartet bei
 * V2/V3-Firmware 1-basierte Seitennummern (`devicePage = pageIndex + 1`).
 *
 * Topic-Formate (verifiziert, siehe MQTT-TOPICS-REFERENCE.md):
 * - Button-Labels:  button/{position}/label|toplabel/set             (OHNE Seite)
 * - Button-SVG:     button/{position}-{page}/svg/set                 (MIT Seite!)
 * - Button-LEDs:    button/{position}-{page}/led/{side}/{param}/set  (MIT Seite)
 * - Display-Items:  displayitem/{id}/label|value|unit|svg/set
 * - Page-Wechsel:   page/set  {devicePage}
 *
 * Button-SVG ist wie die LEDs seitenspezifisch (so publiziert es auch das
 * offizielle Node-RED-Package, siehe backend/package/nodes/lib/topics.js).
 */

import { MqttService } from "../buttonplus/mqttService.js";

/** Physische LED-Seite eines Buttons. „wall“ – NICHT „back“! */
export type LedSide = "front" | "wall";

/** Volle Helligkeit (0-255) – LEDs benötigen einen Brightness-Wert um zu leuchten. */
const FULL_BRIGHTNESS = 255;

/**
 * Basiskonfiguration für Device-Kommunikation
 */
export interface DeviceConfig {
  baseTopic: string;    // z.B. "buttonplus"
  deviceId: string;     // z.B. "btn_9182a0"
  firmwareV2: boolean;  // V2/V3 (1-basierte Seiten) vs. Legacy (0-basiert)
}

/**
 * Display-Item-Werte für MQTT-Publishing
 */
export interface DisplayItemUpdate {
  label?: string;
  value?: string;
  unit?: string;
  svg?: string;
}

/**
 * Button-Werte für MQTT-Publishing.
 * SVG ist bewusst NICHT enthalten — es ist seitenspezifisch (→ setButtonSvg).
 */
export interface ButtonUpdate {
  label?: string;
  topLabel?: string;
}

/**
 * LED-Konfiguration einer einzelnen Button-Seite.
 */
export interface LedUpdate {
  /** Hex-Farbe ("#ff0000"). Wird für das Gerät in Dezimal konvertiert. */
  color?: string;
  /** Helligkeit 0-255 (Default: 255). */
  brightness?: number;
  /** Ein/Aus. */
  on?: boolean;
}

/**
 * Zentrale Device-Service-Klasse
 *
 * Verwendet intern MqttService für Publishing, bietet aber
 * eine höhere, typisierte API.
 */
export class DeviceService {
  private config: DeviceConfig;

  constructor(
    private mqtt: MqttService,
    config: DeviceConfig,
  ) {
    this.config = config;
  }

  /**
   * Aktualisiert Device-Config (z.B. nach neuem Deploy)
   */
  updateConfig(config: Partial<DeviceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** Aktuelle Device-Config zurückgeben. */
  getConfig(): DeviceConfig {
    return { ...this.config };
  }

  // ==================== DISPLAY API ====================

  /**
   * Publiziert Display-Item-Werte auf das Gerät.
   *
   * @param itemId Display-Item-ID (0-basiert)
   * @param update Werte zum Publizieren
   * @param retain MQTT retain flag (default: true)
   */
  updateDisplay(itemId: number, update: DisplayItemUpdate, retain = true): void {
    const base = this.displayItemTopic(itemId);

    if (update.label !== undefined) {
      this.publish(`${base}/label/set`, update.label, retain);
    }
    if (update.value !== undefined) {
      this.publish(`${base}/value/set`, update.value, retain);
    }
    if (update.unit !== undefined) {
      this.publish(`${base}/unit/set`, update.unit, retain);
    }
    if (update.svg !== undefined) {
      this.publish(`${base}/svg/set`, update.svg, retain);
    }
  }

  /**
   * Löscht alle Werte eines Display-Items
   */
  clearDisplay(itemId: number): void {
    this.updateDisplay(itemId, { label: "", value: "", unit: "", svg: "" });
  }

  // ==================== BUTTON API ====================

  /**
   * Aktualisiert Button-Labels.
   *
   * Button-Labels sind NICHT seitenspezifisch → Topic ohne Seiten-Suffix.
   *
   * @param buttonId Button-ID (0-basiert)
   * @param update Werte zum Publizieren
   * @param retain MQTT retain flag (default: true)
   */
  updateButton(buttonId: number, update: ButtonUpdate, retain = true): void {
    const base = this.buttonTopic(buttonId);

    if (update.label !== undefined) {
      this.publish(`${base}/label/set`, update.label, retain);
    }
    if (update.topLabel !== undefined) {
      this.publish(`${base}/toplabel/set`, update.topLabel, retain);
    }
  }

  /**
   * Setzt das SVG-Icon eines Buttons für eine bestimmte Seite.
   *
   * Button-SVG ist SEITENSPEZIFISCH → Topic mit Seiten-Suffix `{position}-{page}`
   * (wie beim offiziellen Node-RED-Package). Ein leerer String löscht das
   * Icon auf dem Gerät.
   *
   * @param buttonId  Button-ID (0-basiert)
   * @param pageIndex Seiten-Index (0-basiert)
   * @param svg       SVG Tiny 1.2 oder "" (Icon löschen)
   * @param retain    MQTT retain flag (default: true)
   */
  setButtonSvg(buttonId: number, pageIndex: number, svg: string, retain = true): void {
    // Frühere Versionen publizierten SVG retained OHNE Seiten-Suffix. Diesen
    // Alt-Topic immer leeren, damit auf dem Broker/Gerät kein Phantom-Icon
    // hängen bleibt (dedupliziert → kostet effektiv einen Publish pro Button).
    this.publish(`${this.buttonTopic(buttonId)}/svg/set`, "", true);

    this.publish(`${this.buttonPageTopic(buttonId, pageIndex)}/svg/set`, svg, retain);
  }

  /**
   * Löscht Button-Labels und das Icon der angegebenen Seite.
   */
  clearButton(buttonId: number, pageIndex: number): void {
    this.updateButton(buttonId, { label: "", topLabel: "" });
    this.setButtonSvg(buttonId, pageIndex, "");
  }

  // ==================== LED API ====================

  /**
   * Setzt eine einzelne Button-LED (front oder wall) für eine bestimmte Seite.
   *
   * LEDs sind PAGE-SPEZIFISCH → Topic mit Seiten-Suffix `{position}-{page}`.
   * Damit eine LED leuchtet, müssen ALLE drei Parameter gesetzt werden:
   * rgb (dezimal), brightness (0-255), on ("true"/"false").
   *
   * @param buttonId  Button-ID (0-basiert)
   * @param pageIndex Seiten-Index (0-basiert)
   * @param side      "front" oder "wall"
   * @param led       LED-Werte
   * @param retain    MQTT retain flag (default: true)
   */
  setLed(buttonId: number, pageIndex: number, side: LedSide, led: LedUpdate, retain = true): void {
    const ledBase = `${this.buttonPageTopic(buttonId, pageIndex)}/led/${side}`;

    // RGB zuerst, dann Helligkeit, dann on – alle Werte als String.
    if (led.color !== undefined) {
      this.publish(`${ledBase}/rgb/set`, String(this.hexToDecimal(led.color)), retain);
    }
    if (led.on) {
      // Beim Einschalten immer eine gültige Helligkeit mitsenden.
      const brightness = led.brightness ?? FULL_BRIGHTNESS;
      this.publish(`${ledBase}/brightness/set`, String(this.clampByte(brightness)), retain);
    } else if (led.brightness !== undefined) {
      this.publish(`${ledBase}/brightness/set`, String(this.clampByte(led.brightness)), retain);
    }
    if (led.on !== undefined) {
      // On/Off ist ein String "true"/"false" (NICHT "1"/"0" oder boolean).
      this.publish(`${ledBase}/on/set`, led.on ? "true" : "false", retain);
    }
  }

  /**
   * Setzt die (sichtbare) Front-LED eines Buttons auf eine Farbe und schaltet sie ein.
   */
  setButtonColor(buttonId: number, pageIndex: number, color: string): void {
    this.setLed(buttonId, pageIndex, "front", { color, brightness: FULL_BRIGHTNESS, on: true });
  }

  /**
   * Schaltet beide LEDs (front + wall) eines Buttons für eine Seite aus.
   */
  ledOff(buttonId: number, pageIndex: number): void {
    this.setLed(buttonId, pageIndex, "front", { on: false });
    this.setLed(buttonId, pageIndex, "wall", { on: false });
  }

  // ==================== PAGE / NAVIGATION API ====================

  /**
   * Wechselt zur angegebenen Seite.
   *
   * @param pageIndex Seiten-Index (0-basiert)
   */
  setPage(pageIndex: number): void {
    const topic = `${this.deviceBase()}/page/set`;
    this.publish(topic, String(this.devicePage(pageIndex)), false);
  }

  /**
   * Setzt Display-Helligkeit (0-100)
   */
  setBrightness(brightness: number): void {
    const topic = `${this.deviceBase()}/brightness/set`;
    const clamped = Math.max(0, Math.min(100, Math.round(brightness)));
    this.publish(topic, String(clamped), false);
  }

  // ==================== ROH-MQTT (für Befehle/Quell-Variablen) ==============

  /** Publiziert auf ein beliebiges Topic (mqttPublish-Befehl). */
  publishRaw(topic: string, payload: string, retain = false): boolean {
    console.log(`[DeviceService] 📤 (raw) ${topic} = "${payload}"${retain ? " (retain)" : ""}`);
    return this.mqtt.publishRaw(topic, payload, retain);
  }

  /** Setzt zusätzliche Abo-Topics (MQTT-Quell-Variablen). */
  setExtraSubscriptions(topics: string[]): void {
    this.mqtt.setExtraSubscriptions(topics);
  }

  // ==================== HELPER METHODS ====================

  /** Basis-Topic des Geräts: `{baseTopic}/{deviceId}`. */
  private deviceBase(): string {
    return `${this.config.baseTopic}/${this.config.deviceId}`;
  }

  /** 0-basierte Button-ID → physische Geräte-Position (1-basiert). */
  private position(buttonId: number): number {
    return buttonId + 1;
  }

  /** 0-basierter Seiten-Index → Geräte-Seitennummer (V2/V3: 1-basiert). */
  private devicePage(pageIndex: number): number {
    return this.config.firmwareV2 ? pageIndex + 1 : pageIndex;
  }

  /**
   * Display-Item Base-Topic.
   * @example displayItemTopic(0) → "buttonplus/btn_9182a0/displayitem/0"
   */
  private displayItemTopic(itemId: number): string {
    return `${this.deviceBase()}/displayitem/${itemId}`;
  }

  /**
   * Button Base-Topic OHNE Seiten-Suffix (für Labels).
   * @example buttonTopic(0) → "buttonplus/btn_9182a0/button/1"
   */
  private buttonTopic(buttonId: number): string {
    return `${this.deviceBase()}/button/${this.position(buttonId)}`;
  }

  /**
   * Button Base-Topic MIT Seiten-Suffix (für LEDs).
   * @example buttonPageTopic(0, 0) → "buttonplus/btn_9182a0/button/1-1"
   */
  private buttonPageTopic(buttonId: number, pageIndex: number): string {
    return `${this.deviceBase()}/button/${this.position(buttonId)}-${this.devicePage(pageIndex)}`;
  }

  /** Konvertiert Hex-Farbe ("#rrggbb") zu Dezimal für MQTT. */
  private hexToDecimal(hex: string): number {
    const clean = hex.replace("#", "").trim();
    const parsed = parseInt(clean, 16);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  /** Begrenzt einen Wert auf 0-255 (Byte). */
  private clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  /**
   * Cache der zuletzt publizierten retained-Werte pro Topic.
   * Ermöglicht Publish-Deduplizierung: unveränderte Zustände werden nicht
   * erneut gesendet → drastisch weniger Geräte-Last pro Interaktion.
   */
  private lastPublished = new Map<string, string>();

  /**
   * Verwirft den Publish-Cache; das nächste Rendern sendet wieder ALLE Werte.
   *
   * Muss aufgerufen werden, wenn der retained-Zustand am Gerät nicht mehr mit
   * unserem Cache übereinstimmen könnte:
   * - nach (Re-)Deploy (Gerät hat neue Config übernommen)
   * - nach MQTT-Reconnect (Gerät wurde evtl. neu gestartet)
   */
  resetPublishCache(): void {
    this.lastPublished.clear();
  }

  /**
   * Publiziert und loggt einheitlich.
   *
   * Retained State-Topics (Labels, LEDs, Display-Werte, SVG) werden
   * dedupliziert: Ist der Wert unverändert, wird nicht erneut publiziert.
   * Nicht-retained Steuerbefehle (page/set, brightness/set) werden immer
   * gesendet.
   */
  private publish(topic: string, payload: string, retain: boolean): void {
    if (retain && this.lastPublished.get(topic) === payload) {
      return; // Unveränderter Zustand → überspringen
    }

    console.log(`[DeviceService] 📤 ${topic} = "${payload}"${retain ? " (retain)" : ""}`);
    const ok = this.mqtt.publishRaw(topic, payload, retain);

    // Nur cachen, wenn tatsächlich gesendet wurde (bei fehlender Verbindung
    // erneut versuchen).
    if (retain && ok) {
      this.lastPublished.set(topic, payload);
    }
  }

  /**
   * Gibt Status zurück ob MQTT verbunden ist
   */
  isConnected(): boolean {
    return this.mqtt.getStatus().connected;
  }
}
