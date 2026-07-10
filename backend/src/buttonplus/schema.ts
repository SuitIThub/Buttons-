import { BPConfig } from "./types.js";

/**
 * Die Button+ Firmware benennt die Konfig-Sektionen je nach Version
 * unterschiedlich:
 *   - aktuell (V2):  info, core, buttons, displayitems, brokers, sensors
 *   - älter (legacy): info, core, mqttbuttons, mqttdisplays, mqttbrokers, mqttsensors
 *
 * Intern arbeiten wir immer mit den `mqtt*`-Namen (BPConfig). Beim Lesen wird der
 * Dialekt erkannt und normalisiert, beim Schreiben wieder in denselben Dialekt
 * zurückübersetzt – so bleiben Broker/IDs erhalten und das Gerät versteht die Config.
 */
export type ConfigDialect = "v2" | "legacy";

type Raw = Record<string, unknown>;

function isArr(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

export function detectDialect(raw: unknown): ConfigDialect {
  const r = (raw ?? {}) as Raw;
  if (isArr(r.displayitems) || isArr(r.buttons) || isArr(r.brokers)) return "v2";
  if (isArr(r.mqttdisplays) || isArr(r.mqttbuttons) || isArr(r.mqttbrokers)) return "legacy";
  return "v2";
}

/** Rohkonfiguration des Geräts in die interne kanonische Form bringen. */
export function toCanonical(raw: unknown): BPConfig {
  const r = (raw ?? {}) as Raw;
  const info = (r.info as BPConfig["info"]) ?? { id: "device", connectors: [] };
  return {
    info,
    core: (r.core as BPConfig["core"]) ?? { name: info.id ?? "device", topics: [] },
    mqttbuttons: (r.buttons as BPConfig["mqttbuttons"]) ?? (r.mqttbuttons as BPConfig["mqttbuttons"]) ?? [],
    mqttdisplays:
      (r.displayitems as BPConfig["mqttdisplays"]) ?? (r.mqttdisplays as BPConfig["mqttdisplays"]) ?? [],
    mqttbrokers: (r.brokers as BPConfig["mqttbrokers"]) ?? (r.mqttbrokers as BPConfig["mqttbrokers"]) ?? [],
    mqttsensors: (r.sensors as BPConfig["mqttsensors"]) ?? (r.mqttsensors as BPConfig["mqttsensors"]) ?? [],
  };
}

/** Interne Config in das vom Gerät erwartete JSON (passender Dialekt) übersetzen. */
export function toDevice(cfg: BPConfig, dialect: ConfigDialect): Raw {
  if (dialect === "legacy") {
    return {
      info: cfg.info,
      core: cfg.core,
      mqttbuttons: cfg.mqttbuttons,
      mqttdisplays: cfg.mqttdisplays,
      mqttbrokers: cfg.mqttbrokers,
      mqttsensors: cfg.mqttsensors,
    };
  }
  return {
    info: cfg.info,
    core: cfg.core,
    buttons: cfg.mqttbuttons,
    displayitems: cfg.mqttdisplays,
    brokers: cfg.mqttbrokers,
    sensors: cfg.mqttsensors,
  };
}
