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

/**
 * Feste Obergrenze des Geräts für den `/configsave`-Body. Darüber antwortet die
 * Firmware mit HTTP 413 und verwirft die Konfiguration (verifiziert 2026-09-29,
 * Firmware 3.1.8-V2: 16.115 B gingen durch, 20.985 B → 413).
 */
export const CONFIGSAVE_LIMIT_BYTES = 16 * 1024;

/**
 * Entfernt leere Felder aus Buttons und Display-Items, die das Gerät nicht
 * braucht: `payload: ""` in Topics sowie leere `label`/`toplabel`/`svg`
 * (Buttons) bzw. `label`/`unit` (Display-Items). Texte/Icons kommen ohnehin
 * zur Laufzeit per MQTT. Liefert eine Kopie – die Eingabe bleibt unverändert.
 *
 * Ausnahme `toplabel`: Fehlt das Feld, setzt die Firmware einen Werkstext
 * (Position 8: „Button+ Like“, verifiziert 2026-09-29). Ohne Toplabel-Topic
 * lässt sich der zur Laufzeit nicht mehr löschen – dort bleibt `toplabel: ""`.
 */
export function compactForDevice(raw: Raw): Raw {
  const out = structuredClone(raw);
  const strip = (items: unknown, emptyKeys: string[]) => {
    if (!isArr(items)) return;
    for (const item of items as Raw[]) {
      for (const k of emptyKeys) if (item[k] === "") delete item[k];
      if (isArr(item.topics)) {
        for (const t of item.topics as Raw[]) if (t.payload === "") delete t.payload;
      }
    }
  };
  const buttons = out.buttons ?? out.mqttbuttons;
  strip(buttons, ["label", "svg"]);
  if (isArr(buttons)) {
    for (const b of buttons as Raw[]) {
      const hasTopLabelTopic =
        isArr(b.topics) && (b.topics as Raw[]).some((t) => String(t.topic ?? "").endsWith("/toplabel/set"));
      if (b.toplabel === "" && hasTopLabelTopic) delete b.toplabel;
    }
  }
  strip(out.displayitems ?? out.mqttdisplays, ["label", "unit"]);
  return out;
}

/** Größe des `/configsave`-Bodys in Bytes (UTF-8, wie er gesendet wird). */
export function configPayloadBytes(raw: Raw): number {
  return Buffer.byteLength(JSON.stringify(raw), "utf8");
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
