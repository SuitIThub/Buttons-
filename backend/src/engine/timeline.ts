/**
 * Timeline-Parser: wandelt die flache Befehlsliste einer Event-Gruppe in einen
 * Baum aus Blöcken (if/while/repeat/forEach) und Blattbefehlen um.
 *
 * Die flache Speicherung ist ideal für Drag&Drop und eingerückte Darstellung;
 * die Ausführung (AutomationRuntime) interpretiert den Baum rekursiv.
 */

import { Command, CommandType } from "../model.js";

export type TimelineNode =
  | { kind: "leaf"; cmd: Command }
  | { kind: "if"; branches: IfBranch[] }
  | { kind: "while"; cmd: Command; body: TimelineNode[] }
  | { kind: "repeat"; cmd: Command; body: TimelineNode[] }
  | { kind: "forEach"; cmd: Command; body: TimelineNode[] };

export interface IfBranch {
  /** Bedingungsbefehl (if/elseif) – bei `else` undefined. */
  cmd?: Command;
  body: TimelineNode[];
}

export interface ParseResult {
  nodes: TimelineNode[];
  error?: string;
}

const OPENERS: Record<string, CommandType> = {
  if: "endif",
  while: "endwhile",
  repeat: "endrepeat",
  forEach: "endforeach",
};

/**
 * Parst eine flache Befehlsliste. Deaktivierte Befehle werden übersprungen.
 * Bei unbalancierten Blöcken wird `error` gesetzt und `nodes` bleibt leer.
 */
export function parseTimeline(commands: Command[]): ParseResult {
  const active = commands.filter((c) => c.enabled !== false);
  try {
    const [nodes, next] = parseSequence(active, 0, null);
    if (next !== active.length) {
      return { nodes: [], error: `Unerwarteter Befehl „${active[next]?.type}“ ohne offenen Block.` };
    }
    return { nodes };
  } catch (e) {
    return { nodes: [], error: (e as Error).message };
  }
}

/**
 * Parst eine Befehlsfolge bis zu einem schließenden/mittleren Marker.
 * @param stop Menge von Command-Typen, die die Folge beenden (nicht konsumiert).
 * @returns [Knotenliste, Index des beendenden Markers oder Listenende]
 */
function parseSequence(
  cmds: Command[],
  start: number,
  stop: Set<string> | null,
): [TimelineNode[], number] {
  const nodes: TimelineNode[] = [];
  let i = start;

  while (i < cmds.length) {
    const cmd = cmds[i];
    if (stop && stop.has(cmd.type)) return [nodes, i];

    if (cmd.type in OPENERS) {
      const [node, next] = parseBlock(cmds, i);
      nodes.push(node);
      i = next;
      continue;
    }

    // Verirrte Marker (endif/else/… ohne Opener) → Fehler
    if (isCloser(cmd.type) || cmd.type === "elseif" || cmd.type === "else") {
      throw new Error(`„${cmd.type}“ ohne passenden Block-Anfang.`);
    }

    nodes.push({ kind: "leaf", cmd });
    i++;
  }
  return [nodes, i];
}

function parseBlock(cmds: Command[], start: number): [TimelineNode, number] {
  const opener = cmds[start];

  if (opener.type === "if") return parseIf(cmds, start);

  const closer = OPENERS[opener.type];
  const [body, markerIdx] = parseSequence(cmds, start + 1, new Set([closer]));
  if (markerIdx >= cmds.length) throw new Error(`„${opener.type}“ ohne „${closer}“.`);

  const kind = opener.type as "while" | "repeat" | "forEach";
  return [{ kind, cmd: opener, body }, markerIdx + 1];
}

function parseIf(cmds: Command[], start: number): [TimelineNode, number] {
  const branches: IfBranch[] = [];
  const stop = new Set(["elseif", "else", "endif"]);

  // if-Zweig
  let [body, idx] = parseSequence(cmds, start + 1, stop);
  branches.push({ cmd: cmds[start], body });

  // elseif-Zweige
  while (idx < cmds.length && cmds[idx].type === "elseif") {
    const cond = cmds[idx];
    [body, idx] = parseSequence(cmds, idx + 1, stop);
    branches.push({ cmd: cond, body });
  }

  // else-Zweig
  if (idx < cmds.length && cmds[idx].type === "else") {
    [body, idx] = parseSequence(cmds, idx + 1, stop);
    branches.push({ body });
  }

  if (idx >= cmds.length || cmds[idx].type !== "endif") {
    throw new Error("„if“ ohne „endif“.");
  }
  return [{ kind: "if", branches }, idx + 1];
}

function isCloser(type: string): boolean {
  return type === "endif" || type === "endwhile" || type === "endrepeat" || type === "endforeach";
}

/**
 * Berechnet für jede (flache) Zeile die Einrückungstiefe für die UI.
 * Marker wie else/elseif/end* rücken relativ zu ihrem Block-Level aus.
 */
export function computeIndentLevels(commands: Command[]): number[] {
  const levels: number[] = [];
  let depth = 0;
  for (const c of commands) {
    if (isCloser(c.type) || c.type === "elseif" || c.type === "else") {
      levels.push(Math.max(0, depth - 1));
    } else {
      levels.push(depth);
    }
    if (c.type in OPENERS) depth++;
    else if (isCloser(c.type)) depth = Math.max(0, depth - 1);
  }
  return levels;
}

/** Kurze Validierungsmeldung für die UI (undefined = gültig). */
export function validateTimeline(commands: Command[]): string | undefined {
  return parseTimeline(commands).error;
}
