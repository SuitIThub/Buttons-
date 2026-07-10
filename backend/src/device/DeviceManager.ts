/**
 * Device Manager - Zentrale Orchestrierung aller Device-Services.
 *
 * **Verantwortlichkeiten:**
 * - Store-Integration (Daten laden/speichern)
 * - Device-HTTP-Client (Config Pull/Push)
 * - MQTT-Service-Management
 * - Deploy-Workflow-Orchestrierung
 * - Service-Koordination
 *
 * **Clean Architecture:**
 * - Verwendet DeviceConfigBuilder für Config-Generierung
 * - Verwendet DeviceService für MQTT-Publishing
 * - Verwendet SceneRenderer für Scene-zu-Device-Mapping
 * - Verwendet AutomationRuntime für Event-Logic
 */

import { Store } from "../store.js";
import { DeviceClient } from "../buttonplus/deviceClient.js";
import { MqttService } from "../buttonplus/mqttService.js";
import { DeviceService } from "./DeviceService.js";
import { SceneRenderer } from "./SceneRenderer.js";
import { AutomationRuntime } from "./AutomationRuntime.js";
import { DeviceConfigBuilder, DeviceConfigOutput } from "./DeviceConfigBuilder.js";
import { VariableState } from "../engine/variables.js";
import { BPConfig } from "../buttonplus/types.js";
import { ConfigDialect, detectDialect, toCanonical, toDevice } from "../buttonplus/schema.js";
import { ensureBrokers } from "../buttonplus/brokers.js";

/**
 * Device Manager
 */
export class DeviceManager {
  readonly store = new Store();
  readonly mqtt = new MqttService();
  readonly vars = new VariableState();

  // Services
  private deviceService!: DeviceService;
  private renderer!: SceneRenderer;
  private runtime!: AutomationRuntime;

  // State
  private deviceConfig: BPConfig | null = null;
  private compiledOutput: DeviceConfigOutput | null = null;
  private dialect: ConfigDialect = "v2";
  private mqttWasConnected = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  /** True, sobald das Modell geändert, aber noch nicht aufs Gerät deployed wurde. */
  private undeployed = false;

  /** Markiert nicht-deployte Modelländerungen (Szenen/Seiten). */
  markUndeployed(): void {
    this.undeployed = true;
  }

  hasUndeployedChanges(): boolean {
    return this.undeployed;
  }

  /** Sichert persist=true-Variablenwerte gebündelt (debounced). */
  private schedulePersistVars(): void {
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      void this.store.saveVarValues(this.vars.persistSnapshot());
    }, 800);
  }

  /** Synchronisiert die Variablen-Engine mit den Definitionen, ohne Werte zu verlieren. */
  private syncVars(): void {
    this.vars.resync(this.store.getVariables(), this.store.getVarValues());
  }

  async init(): Promise<void> {
    await this.store.init();

    // Services initialisieren
    this.deviceService = new DeviceService(this.mqtt, {
      baseTopic: this.store.getSettings().baseTopic || "buttonplus",
      deviceId: this.store.getSettings().deviceId || "device",
      firmwareV2: true,
    });

    this.renderer = new SceneRenderer(
      this.deviceService,
      () => this.vars.scope(),
    );

    this.runtime = new AutomationRuntime(
      this.deviceService,
      this.renderer,
      this.vars,
    );

    // MQTT-Events
    this.mqtt.on("status", (s) => {
      if (s.connected && !this.mqttWasConnected) {
        // Bei Reconnect könnte das Gerät neu gestartet sein → Publish-Cache
        // verwerfen und den vollständigen Zustand neu rendern.
        this.deviceService.resetPublishCache();
        this.runtime.syncDevicePage();
        this.runtime.render();
        this.runtime.onMqttConnected();
      } else if (!s.connected && this.mqttWasConnected) {
        this.runtime.onMqttDisconnected();
      }
      this.mqttWasConnected = s.connected;
    });

    this.mqtt.on("message", (m) => {
      this.runtime.handleMessage(m.topic, m.payload);
    });

    // Persistierte Variablenwerte (persist=true) debounced sichern.
    this.vars.on("change", () => this.schedulePersistVars());

    // MQTT verbinden
    this.reconnectMqtt();

    // Config vom Gerät laden
    try {
      await this.pullConfig();
    } catch {
      console.warn("[Manager] Device offline - Config Pull fehlgeschlagen");
    }

    // Runtime starten (best-effort)
    this.startRuntime();
  }

  // ==================== DEVICE CONFIG ====================

  /**
   * Lädt Config vom Gerät.
   */
  async pullConfig(): Promise<BPConfig> {
    const client = this.createDeviceClient();
    const raw = await client.fetchConfig();

    this.dialect = detectDialect(raw);
    const config = toCanonical(raw);
    this.deviceConfig = this.normalizeConfig(config);

    // Device-ID aktualisieren
    const deviceId = config.info?.id;
    if (deviceId && this.store.getSettings().deviceId !== deviceId) {
      await this.store.updateSettings({ deviceId });
    }

    // DeviceService-Config aktualisieren
    this.updateDeviceServiceConfig();

    return this.deviceConfig;
  }

  /**
   * Schreibt Config aufs Gerät.
   */
  async pushConfig(config: BPConfig): Promise<string> {
    const client = this.createDeviceClient();
    const deviceFormat = toDevice(config, this.dialect);
    // `info` (mac, firmware, Connector-/Sensor-Hardware) ist geräteeigen und wird
    // beim Speichern NICHT benötigt. Die offizielle App entfernt es ebenfalls vor
    // `/configsave`; das spart Bytes gegen das feste Payload-Limit des Geräts.
    delete (deviceFormat as Record<string, unknown>).info;
    const result = await client.pushConfig(deviceFormat);

    this.deviceConfig = this.normalizeConfig(config);
    this.updateDeviceServiceConfig();

    return result;
  }

  /**
   * Gibt aktuelle Device-Config zurück.
   */
  getConfig(): BPConfig | null {
    return this.deviceConfig;
  }

  /**
   * Liste der integrierten Sensoren mit Beschreibung (für die UI, z.B.
   * sensorRead-Auswahl). Verknüpft die Slot-Konfig (`mqttsensors`) mit den
   * Hardware-Beschreibungen (`info.sensors`) über den Sensor-Typ.
   */
  getSensors(): { sensorid: string; type: number; description: string }[] {
    const cfg = this.deviceConfig;
    if (!cfg) return [];
    const descByType = new Map((cfg.info?.sensors ?? []).map((s) => [s.type, s.description]));
    return (cfg.mqttsensors ?? []).map((s) => ({
      sensorid: String(s.sensorid),
      type: s.type,
      description: descByType.get(s.type) ?? `Sensor ${s.sensorid}`,
    }));
  }

  // ==================== COMPILE ====================

  /**
   * Kompiliert Datenmodell zu Device-Config.
   */
  private compile(): DeviceConfigOutput {
    if (!this.deviceConfig) {
      throw new Error("Keine Device-Config vorhanden. Bitte zuerst pullConfig() aufrufen.");
    }

    const output = DeviceConfigBuilder.build({
      baseConfig: this.deviceConfig,
      pages: this.store.getPages(),
      scenes: this.store.getScenes(),
      variables: this.store.getVariables(),
      baseTopic: this.store.getSettings().baseTopic || "buttonplus",
    });

    // MQTT-Broker in Config einfügen
    ensureBrokers(output.config, this.store.getSettings());

    this.compiledOutput = output;
    return output;
  }

  // ==================== DEPLOY ====================

  /**
   * Vollständiges Deploy: Kompilieren → Pushen → Runtime aktivieren.
   *
   * **Workflow:**
   * 1. Datenmodell kompilieren
   * 2. Config aufs Gerät schreiben
   * 3. Warten auf Device-Stabilisierung
   * 4. Config vom Gerät neu lesen (Verification)
   * 5. Neu kompilieren mit aktueller Config
   * 6. Runtime aktivieren
   * 7. Initial Rendering
   */
  async deploy(): Promise<{ pages: number; buttons: number; displays: number }> {
    console.log("[Deploy] Starting deployment...");

    // 0. Frische Config vom Gerät holen. Direkt am Gerät vorgenommene
    //    Einstellungen (z.B. Sensor-Config, Broker) leben nur im Gerät; ohne
    //    diesen Pull würde der erste Push mit einem veralteten Cache sie
    //    überschreiben, BEVOR die spätere Verifikation sie sichern kann.
    try {
      console.log("[Deploy] Pulling current device config first...");
      await this.pullConfig();
    } catch (err) {
      console.warn("[Deploy] Pre-pull failed - using cached config:", err);
    }

    // 1. Kompilieren
    console.log("[Deploy] Compiling...");
    let output = this.compile();

    // 2. Pushen
    console.log("[Deploy] Pushing config to device...");
    await this.pushConfig(output.config);

    // 3. Warten auf Device
    console.log("[Deploy] Waiting for device to apply config...");
    await this.waitForDeviceStable(2000);

    // 4. Verification
    try {
      console.log("[Deploy] Verifying config on device...");
      await this.pullConfig();
      output = this.compile();
    } catch (err) {
      console.warn("[Deploy] Verification failed - using pushed config:", err);
    }

    // 5. Runtime aktivieren (nach Deploy immer auf der ersten Seite starten).
    console.log("[Deploy] Activating runtime...");
    this.syncVars();
    this.runtime.activate(output, this.store.getScenes(), this.store.getNav(), this.store.getPages(), {
      resetPage: true,
    });

    // 6. Device synchronisieren und rendern
    console.log("[Deploy] Syncing device page...");
    this.runtime.syncDevicePage();
    this.runtime.render();

    this.undeployed = false;
    console.log("[Deploy] Deployment complete!");

    return {
      pages: output.displayMappings.reduce((s, m) => Math.max(s, m.pageIndex + 1), 0),
      buttons: output.buttonCount,
      displays: output.config.mqttdisplays.length,
    };
  }

  /**
   * Wartet bis Device-Config stable ist.
   */
  private async waitForDeviceStable(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ==================== RUNTIME ====================

  /**
   * Startet/Aktualisiert Runtime OHNE Deploy.
   * Für Änderungen die nur Runtime betreffen (Logik, Variablen-Werte).
   */
  startRuntime(): boolean {
    try {
      const output = this.compile();
      this.syncVars();
      this.runtime.activate(output, this.store.getScenes(), this.store.getNav(), this.store.getPages());
      console.log("[Runtime] Started successfully");
      return true;
    } catch (err) {
      console.error("[Runtime] Failed to start:", err);
      return false;
    }
  }

  /**
   * Stoppt Runtime.
   */
  stopRuntime(): void {
    this.runtime.deactivate();
  }

  /**
   * Führt eine benannte Event-Gruppe einer Szene manuell aus (z.B. zum Testen).
   */
  runGroup(sceneId: string, groupId: string): boolean {
    return this.runtime.runGroupById(sceneId, groupId);
  }

  /** Benennt eine Variable um (inkl. Referenzen in Szenen) und startet die Runtime neu. */
  async renameVariable(oldName: string, newName: string): Promise<void> {
    await this.store.renameVariable(oldName, newName);
    this.startRuntime();
  }

  /**
   * Gibt Runtime-Status zurück.
   */
  getRuntimeState() {
    return this.runtime.getState();
  }

  /**
   * Registriert einen Listener für Runtime-State-Änderungen (z.B. für WebSocket-
   * Broadcasts). Die Runtime-Instanz bleibt über ihre Lebensdauer bestehen.
   */
  onRuntimeState(listener: (state: ReturnType<AutomationRuntime["getState"]>) => void): void {
    this.runtime.on("state", listener);
  }

  // ==================== MQTT ====================

  /**
   * Verbindet/Reconnected MQTT mit aktuellen Einstellungen.
   */
  reconnectMqtt(): void {
    const settings = this.store.getSettings();
    this.mqtt.connect(settings);
    this.updateDeviceServiceConfig();
  }

  /**
   * Gibt MQTT-Status zurück.
   */
  getMqttStatus() {
    return this.mqtt.getStatus();
  }

  // ==================== HELPERS ====================

  /**
   * Erstellt Device-HTTP-Client.
   */
  private createDeviceClient(): DeviceClient {
    return new DeviceClient(this.store.getSettings().deviceIp);
  }

  /**
   * Normalisiert Device-Config (fügt fehlende Felder hinzu).
   */
  private normalizeConfig(cfg: BPConfig): BPConfig {
    const c = cfg ?? ({} as BPConfig);
    c.info = c.info ?? { id: "device", connectors: [], sensors: [] };
    c.info.id = c.info.id ?? "device";
    c.info.connectors = c.info.connectors ?? [];
    c.info.sensors = c.info.sensors ?? [];
    c.core = c.core ?? { name: c.info.id, topics: [] };
    c.core.topics = c.core.topics ?? [];
    c.mqttbuttons = (c.mqttbuttons ?? []).map((b) => ({ ...b, topics: b.topics ?? [] }));
    c.mqttdisplays = (c.mqttdisplays ?? []).map((d) => ({ ...d, topics: d.topics ?? [] }));
    c.mqttbrokers = c.mqttbrokers ?? [];
    c.mqttsensors = c.mqttsensors ?? [];
    return c;
  }

  /**
   * Aktualisiert DeviceService-Config basierend auf aktuellen Settings/Config.
   */
  private updateDeviceServiceConfig(): void {
    const settings = this.store.getSettings();
    const firmwareV2 = this.deviceConfig?.info?.firmware
      ? this.deviceConfig.info.firmware.includes("-V2") || /^[23]\./.test(this.deviceConfig.info.firmware)
      : true;

    this.deviceService.updateConfig({
      baseTopic: settings.baseTopic || "buttonplus",
      deviceId: settings.deviceId || this.deviceConfig?.info?.id || "device",
      firmwareV2,
    });
  }

  /**
   * Gibt compiled Output zurück (für Debugging).
   */
  getCompiledOutput(): DeviceConfigOutput | null {
    return this.compiledOutput;
  }
}
