import { EventEmitter } from "node:events";
import mqtt, { MqttClient } from "mqtt";
import { AppSettings } from "./types.js";

export interface MqttStatus {
  connected: boolean;
  url: string;
  error: string | null;
}

export interface IncomingMessage {
  topic: string;
  payload: string;
  ts: number;
}

/**
 * Kapselt die MQTT-Verbindung: Verbinden, Abonnieren aller Geräte-Topics und
 * generisches Publizieren. Die Interpretation eingehender Nachrichten (Button-
 * Events etc.) übernimmt die AutomationRuntime; das Erzeugen ausgehender
 * Steuer-Topics übernimmt der DeviceService.
 */
export class MqttService extends EventEmitter {
  private client: MqttClient | null = null;
  private status: MqttStatus = { connected: false, url: "", error: null };
  private baseTopic = "buttonplus";
  private deviceId = "";
  /** Zusätzliche (externe) Topics, z. B. für MQTT-Quell-Variablen. */
  private extraTopics = new Set<string>();

  getStatus(): MqttStatus {
    return { ...this.status };
  }

  connect(settings: AppSettings): void {
    this.disconnect();
    if (!settings.mqttUrl) {
      this.updateStatus({ connected: false, url: "", error: "Keine MQTT-URL konfiguriert." });
      return;
    }
    this.baseTopic = settings.baseTopic || "buttonplus";
    this.deviceId = settings.deviceId || this.deviceId;
    this.status.url = settings.mqttUrl;

    const client = mqtt.connect(settings.mqttUrl, {
      username: settings.mqttUsername || undefined,
      password: settings.mqttPassword || undefined,
      reconnectPeriod: 4000,
      connectTimeout: 8000,
      clientId: `bpmanager_${Math.random().toString(16).slice(2, 10)}`,
    });

    client.on("connect", () => {
      this.updateStatus({ connected: true, url: settings.mqttUrl, error: null });
      this.resubscribe();
    });
    client.on("reconnect", () => this.updateStatus({ ...this.status, connected: false }));
    client.on("error", (err) =>
      this.updateStatus({ ...this.status, error: err.message ?? String(err) }),
    );
    client.on("close", () => this.updateStatus({ ...this.status, connected: false }));
    client.on("message", (topic, payloadBuf) =>
      this.emit("message", { topic, payload: payloadBuf.toString(), ts: Date.now() } satisfies IncomingMessage),
    );

    this.client = client;
  }

  disconnect(): void {
    if (this.client) {
      this.client.end(true);
      this.client = null;
    }
    this.updateStatus({ ...this.status, connected: false });
  }

  private resubscribe(): void {
    if (!this.client || !this.status.connected) return;
    // Alles unter dem Gerätepräfix mitlesen -> vollständiger Live-Einblick.
    const wildcard = `${this.baseTopic}/${this.deviceId || "+"}/#`;
    this.client.subscribe(wildcard, { qos: 0 });
    for (const t of this.extraTopics) this.client.subscribe(t, { qos: 0 });
  }

  /**
   * Setzt die Liste zusätzlicher (externer) Abo-Topics. Wird bei jedem
   * (Re-)Connect erneut abonniert. Für MQTT-Quell-Variablen.
   */
  setExtraSubscriptions(topics: string[]): void {
    const next = new Set(topics.filter((t) => t && t.trim()));
    if (this.client && this.status.connected) {
      for (const t of this.extraTopics) if (!next.has(t)) this.client.unsubscribe(t);
      for (const t of next) if (!this.extraTopics.has(t)) this.client.subscribe(t, { qos: 0 });
    }
    this.extraTopics = next;
  }

  private updateStatus(next: MqttStatus): void {
    this.status = next;
    this.emit("status", this.getStatus());
  }

  /** Publiziert eine rohe Nachricht auf ein beliebiges Topic. */
  publishRaw(topic: string, payload: string, retain = false): boolean {
    if (!this.client || !this.status.connected) {
      console.warn(`[MQTT] Publish fehlgeschlagen (nicht verbunden): ${topic}`);
      return false;
    }
    this.client.publish(topic, payload, { qos: 0, retain });
    return true;
  }
}
