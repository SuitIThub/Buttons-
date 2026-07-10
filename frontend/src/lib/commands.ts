import { Command, CommandType } from "./types";

/** Kategorie-Gruppierung für das „Befehl hinzufügen"-Menü. */
export interface CommandMeta {
  type: CommandType;
  label: string;
  category: string;
  /** Struktur-Öffner (fügt automatisch passenden End-Marker ein). */
  opener?: CommandType;
}

export const COMMAND_META: CommandMeta[] = [
  // Variablen
  { type: "setVar", label: "Variable setzen", category: "Variablen" },
  { type: "incVar", label: "Zahl erhöhen/verringern", category: "Variablen" },
  { type: "toggleVar", label: "Boolean umschalten", category: "Variablen" },
  { type: "getVar", label: "Variable kopieren", category: "Variablen" },
  { type: "randomVar", label: "Zufallszahl", category: "Variablen" },
  // Zahlen
  { type: "mathOp", label: "Runden / Abrunden / Aufrunden", category: "Zahlen" },
  { type: "formatNumber", label: "Zahl formatieren → Text", category: "Zahlen" },
  // Text
  { type: "strReplace", label: "Text ersetzen", category: "Text" },
  { type: "strSplit", label: "Text aufteilen → Liste", category: "Text" },
  // Listen
  { type: "listOp", label: "Listen-Operation", category: "Listen" },
  { type: "range", label: "Zahlenfolge", category: "Listen" },
  // Dictionary
  { type: "dictSet", label: "Dict-Wert setzen", category: "Dictionary" },
  { type: "dictRemove", label: "Dict-Wert entfernen", category: "Dictionary" },
  { type: "dictGet", label: "Dict-Wert lesen", category: "Dictionary" },
  // Steuerfluss
  { type: "if", label: "Wenn (if)", category: "Steuerfluss" },
  { type: "while", label: "Solange (while)", category: "Steuerfluss" },
  { type: "repeat", label: "Wiederhole n-mal", category: "Steuerfluss" },
  { type: "forEach", label: "Für jedes (Liste)", category: "Steuerfluss" },
  { type: "break", label: "Schleife abbrechen", category: "Steuerfluss" },
  { type: "continue", label: "Nächste Iteration", category: "Steuerfluss" },
  { type: "pause", label: "Warten (Pause)", category: "Steuerfluss" },
  { type: "return", label: "Gruppe beenden", category: "Steuerfluss" },
  { type: "runGroup", label: "Andere Gruppe ausführen", category: "Steuerfluss" },
  { type: "label", label: "Kommentar / Trenner", category: "Steuerfluss" },
  // Anzeige & Gerät
  { type: "setDisplay", label: "Display-Element ändern", category: "Anzeige & Gerät" },
  { type: "setButton", label: "Button ändern", category: "Anzeige & Gerät" },
  { type: "navigate", label: "Seite wechseln", category: "Anzeige & Gerät" },
  { type: "setBrightness", label: "Helligkeit setzen", category: "Anzeige & Gerät" },
  // Extern
  { type: "httpRequest", label: "HTTP-Request", category: "Extern" },
  { type: "mqttPublish", label: "MQTT publizieren", category: "Extern" },
  { type: "mqttRead", label: "MQTT lesen", category: "Extern" },
  { type: "sensorRead", label: "Sensor lesen", category: "Extern" },
  // Debug
  { type: "log", label: "Log-Ausgabe", category: "Debug" },
];

const META_BY_TYPE = new Map(COMMAND_META.map((m) => [m.type, m]));

/** End-Marker je Öffner. */
export const CLOSER_OF: Partial<Record<CommandType, CommandType>> = {
  if: "endif",
  while: "endwhile",
  repeat: "endrepeat",
  forEach: "endforeach",
};

const OPENERS = new Set<CommandType>(["if", "while", "repeat", "forEach"]);
const CLOSERS = new Set<CommandType>(["endif", "endwhile", "endrepeat", "endforeach"]);
const MIDDLE = new Set<CommandType>(["elseif", "else"]);

export function isOpener(t: CommandType): boolean {
  return OPENERS.has(t);
}
export function isCloser(t: CommandType): boolean {
  return CLOSERS.has(t);
}
export function isMiddle(t: CommandType): boolean {
  return MIDDLE.has(t);
}
/** Marker-Zeilen werden nicht frei bearbeitet (else/endif/…). */
export function isMarker(t: CommandType): boolean {
  return CLOSERS.has(t) || MIDDLE.has(t);
}

/** Anzeigename einer Befehlszeile (auch für Marker). */
export function commandLabel(type: CommandType): string {
  switch (type) {
    case "endif": return "Ende Wenn";
    case "endwhile": return "Ende Solange";
    case "endrepeat": return "Ende Wiederholung";
    case "endforeach": return "Ende Für-jedes";
    case "elseif": return "Sonst wenn";
    case "else": return "Sonst";
    default: return META_BY_TYPE.get(type)?.label ?? type;
  }
}

export function newCommand(type: CommandType): Command {
  const base: Command = { id: crypto.randomUUID(), type };
  if (type === "mathOp") base.mathMode = "round";
  if (type === "httpRequest") base.responseMode = "json";
  if (type === "formatNumber") base.pattern = "00.00";
  return base;
}

/** Einrückungstiefe pro flacher Zeile (mirror des Backends). */
export function computeIndentLevels(commands: Command[]): number[] {
  const levels: number[] = [];
  let depth = 0;
  for (const c of commands) {
    if (isCloser(c.type) || isMiddle(c.type)) levels.push(Math.max(0, depth - 1));
    else levels.push(depth);
    if (isOpener(c.type)) depth++;
    else if (isCloser(c.type)) depth = Math.max(0, depth - 1);
  }
  return levels;
}

/** Kurze Validierungsmeldung (undefined = gültig). Prüft Block-Balance. */
export function validateTimeline(commands: Command[]): string | undefined {
  const active = commands.filter((c) => c.enabled !== false);
  const stack: CommandType[] = [];
  for (const c of active) {
    if (isOpener(c.type)) {
      stack.push(c.type);
    } else if (isCloser(c.type)) {
      const open = stack.pop();
      if (!open || CLOSER_OF[open] !== c.type) {
        return `„${commandLabel(c.type)}“ ohne passenden Block-Anfang.`;
      }
    } else if (c.type === "elseif" || c.type === "else") {
      if (stack[stack.length - 1] !== "if") return `„${commandLabel(c.type)}“ außerhalb eines Wenn-Blocks.`;
    }
  }
  if (stack.length > 0) return `Block „${commandLabel(stack[stack.length - 1])}“ wurde nicht geschlossen.`;
  return undefined;
}

/**
 * Findet den Index des passenden End-Markers zu einem Öffner an `openIdx`
 * (unter Beachtung verschachtelter Blöcke). -1, wenn keiner existiert.
 */
export function matchingCloserIndex(commands: Command[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < commands.length; i++) {
    if (isOpener(commands[i].type)) depth++;
    else if (isCloser(commands[i].type)) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
