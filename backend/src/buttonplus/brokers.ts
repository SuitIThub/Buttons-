import { AppSettings, BPBroker, BPConfig } from "./types.js";

/** Parst mqtt://host:port oder mqtts://host:port. */
export function parseMqttUrl(mqttUrl: string): { host: string; port: number } | null {
  const raw = mqttUrl.trim();
  if (!raw) return null;
  try {
    const httpish = raw.replace(/^mqtts:/i, "https:").replace(/^mqtt:/i, "http:");
    const u = new URL(httpish);
    const host = u.hostname;
    if (!host) return null;
    const port = u.port
      ? Number(u.port)
      : raw.toLowerCase().startsWith("mqtts:")
        ? 8883
        : 1883;
    return { host, port };
  } catch {
    return null;
  }
}

/**
 * Stellt sicher, dass der MQTT-Broker in der Gerätekonfiguration vorhanden und
 * aktuell ist (V2-Geräte brauchen brokers[] für Display-Subscriptions).
 */
export function ensureBrokers(cfg: BPConfig, settings: AppSettings, brokerId = "buttonplus"): void {
  const parsed = parseMqttUrl(settings.mqttUrl);
  if (!parsed?.host) return;

  // URL: mqtt://host (OHNE Port - Port ist separates Feld!)
  const protocol = settings.mqttUrl.toLowerCase().startsWith("mqtts:") ? "mqtts://" : "mqtt://";
  const brokerUrl = protocol + parsed.host;

  const patch: BPBroker = {
    brokerid: brokerId,
    url: brokerUrl,  // mqtt://host OHNE Port
    port: parsed.port,  // Port ist separates Feld
    wsport: 0,
    defaultschema: true,
  };
  if (settings.mqttUsername) patch.username = settings.mqttUsername;
  if (settings.mqttPassword) patch.password = settings.mqttPassword;

  cfg.mqttbrokers = cfg.mqttbrokers ?? [];
  const idx = cfg.mqttbrokers.findIndex((b) => b.brokerid === brokerId);
  if (idx >= 0) {
    cfg.mqttbrokers[idx] = { ...cfg.mqttbrokers[idx], ...patch };
  } else {
    cfg.mqttbrokers.push(patch);
  }
}
