import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { AppSettings } from "./buttonplus/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Repo-Root .env (backend/dist → ../../.env) und optional backend/.env
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../.env") });

/** Liest die Standardeinstellungen aus Umgebungsvariablen (siehe .env.example). */
export function loadEnvSettings(): AppSettings {
  return {
    deviceIp: process.env.BUTTONPLUS_DEVICE_IP ?? "",
    mqttUrl: process.env.MQTT_URL ?? "",
    mqttUsername: process.env.MQTT_USERNAME ?? "",
    mqttPassword: process.env.MQTT_PASSWORD ?? "",
    baseTopic: process.env.MQTT_BASE_TOPIC ?? "buttonplus",
    deviceId: process.env.BUTTONPLUS_DEVICE_ID ?? "",
  };
}

export const PORT = Number(process.env.PORT ?? 8080);
export const DATA_DIR = process.env.DATA_DIR ?? "./data";

/** Gespeicherte Werte haben Vorrang; Env füllt nur leere Felder. */
export function mergeSettings(stored: Partial<AppSettings> | undefined, env: AppSettings): AppSettings {
  const out = { ...env };
  if (!stored) return out;
  for (const key of ["deviceIp", "mqttUrl", "mqttUsername", "mqttPassword", "baseTopic", "deviceId"] as const) {
    const v = stored[key];
    if (typeof v === "string" && v.trim() !== "") out[key] = v;
  }
  return out;
}

/** True wenn leere Store-Felder durch .env aufgefüllt wurden. */
export function settingsHealedFromEnv(
  stored: Partial<AppSettings> | undefined,
  merged: AppSettings,
): boolean {
  if (!stored) return false;
  for (const key of ["deviceIp", "mqttUrl", "mqttUsername", "mqttPassword", "baseTopic", "deviceId"] as const) {
    const s = stored[key];
    if ((typeof s !== "string" || s.trim() === "") && merged[key]?.trim() !== "") return true;
  }
  return false;
}
