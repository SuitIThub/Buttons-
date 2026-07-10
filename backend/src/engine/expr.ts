import jsep from "jsep";
import { VarValue } from "../model.js";

/**
 * Kleine, sichere Ausdrucks-Engine für Bedingungen, Wertberechnungen und
 * Text-Interpolation. Kein eval(); es wird nur ein whitelisteter AST ausgewertet.
 *
 * Unterstützt: Zahlen/Strings/Bool, Variablen (inkl. $system), Arithmetik,
 * Vergleiche, &&/||/!, Ternär a?b:c, Member-Zugriff obj.k / list[i] und eine
 * feste Funktionsbibliothek.
 */

export type Scope = Record<string, VarValue | undefined>;

type Node = ReturnType<typeof jsep>;

const parseCache = new Map<string, Node>();

function parse(expr: string): Node {
  let node = parseCache.get(expr);
  if (!node) {
    node = jsep(expr);
    parseCache.set(expr, node);
  }
  return node;
}

export function toStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) ? 0 : n;
}

export function toBool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "" && v !== "false" && v !== "0";
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === "object") return Object.keys(v).length > 0;
  return Boolean(v);
}

const FUNCS: Record<string, (...args: any[]) => VarValue> = {
  len: (a) =>
    a == null
      ? 0
      : typeof a === "string" || Array.isArray(a)
        ? a.length
        : typeof a === "object"
          ? Object.keys(a).length
          : 0,
  round: (a, d = 0) => {
    const f = Math.pow(10, toNum(d));
    return Math.round(toNum(a) * f) / f;
  },
  floor: (a) => Math.floor(toNum(a)),
  ceil: (a) => Math.ceil(toNum(a)),
  abs: (a) => Math.abs(toNum(a)),
  min: (...xs) => Math.min(...xs.map(toNum)),
  max: (...xs) => Math.max(...xs.map(toNum)),
  upper: (a) => toStr(a).toUpperCase(),
  lower: (a) => toStr(a).toLowerCase(),
  str: (a) => toStr(a),
  int: (a) => {
    const n = parseInt(toStr(a), 10);
    return Number.isNaN(n) ? 0 : n;
  },
  num: (a) => toNum(a),
  bool: (a) => toBool(a),
  not: (a) => !toBool(a),
  contains: (a, b) =>
    typeof a === "string"
      ? a.includes(toStr(b))
      : Array.isArray(a)
        ? a.some((x) => x === b)
        : a && typeof a === "object"
          ? Object.prototype.hasOwnProperty.call(a, toStr(b))
          : false,
  get: (a: any, k: any, def: VarValue = "") => {
    if (a == null) return def;
    const v = a[k];
    return v === undefined ? def : v;
  },
  join: (a, sep = ",") => (Array.isArray(a) ? a.map(toStr).join(toStr(sep)) : toStr(a)),
  keys: (a) => (a && typeof a === "object" && !Array.isArray(a) ? Object.keys(a) : []),
};

function evalNode(node: any, scope: Scope): VarValue {
  switch (node.type) {
    case "Literal":
      return node.value as VarValue;
    case "Identifier": {
      const v = scope[node.name];
      return v === undefined ? "" : v;
    }
    case "MemberExpression": {
      const obj = evalNode(node.object, scope) as any;
      const key = node.computed ? evalNode(node.property, scope) : node.property.name;
      if (obj == null) return "";
      const val = obj[key as any];
      return val === undefined ? "" : (val as VarValue);
    }
    case "UnaryExpression": {
      const arg = evalNode(node.argument, scope);
      if (node.operator === "!") return !toBool(arg);
      if (node.operator === "-") return -toNum(arg);
      if (node.operator === "+") return toNum(arg);
      return arg;
    }
    case "BinaryExpression":
      return evalBinary(node.operator, evalNode(node.left, scope), evalNode(node.right, scope));
    case "LogicalExpression": {
      const left = evalNode(node.left, scope);
      if (node.operator === "&&") return toBool(left) ? evalNode(node.right, scope) : left;
      if (node.operator === "||") return toBool(left) ? left : evalNode(node.right, scope);
      return left;
    }
    case "ConditionalExpression":
      return toBool(evalNode(node.test, scope))
        ? evalNode(node.consequent, scope)
        : evalNode(node.alternate, scope);
    case "CallExpression": {
      const fnName = node.callee?.name;
      const fn = fnName ? FUNCS[fnName] : undefined;
      if (!fn) throw new Error(`Unbekannte Funktion: ${fnName}`);
      const args = node.arguments.map((a: any) => evalNode(a, scope));
      return fn(...args);
    }
    case "ArrayExpression":
      return node.elements.map((e: any) => evalNode(e, scope));
    case "Compound":
      // Nur das letzte Teil-Ergebnis zurückgeben.
      return node.body.map((n: any) => evalNode(n, scope)).pop() ?? "";
    default:
      throw new Error(`Nicht unterstützter Ausdruck: ${node.type}`);
  }
}

function evalBinary(op: string, l: VarValue, r: VarValue): VarValue {
  switch (op) {
    case "+":
      if (typeof l === "string" || typeof r === "string") return toStr(l) + toStr(r);
      return toNum(l) + toNum(r);
    case "-":
      return toNum(l) - toNum(r);
    case "*":
      return toNum(l) * toNum(r);
    case "/":
      return toNum(r) === 0 ? 0 : toNum(l) / toNum(r);
    case "%":
      return toNum(r) === 0 ? 0 : toNum(l) % toNum(r);
    case "==":
    case "===":
      return looseEq(l, r);
    case "!=":
    case "!==":
      return !looseEq(l, r);
    case "<":
      return toNum(l) < toNum(r);
    case ">":
      return toNum(l) > toNum(r);
    case "<=":
      return toNum(l) <= toNum(r);
    case ">=":
      return toNum(l) >= toNum(r);
    default:
      throw new Error(`Unbekannter Operator: ${op}`);
  }
}

function looseEq(l: VarValue, r: VarValue): boolean {
  if (typeof l === "number" || typeof r === "number") return toNum(l) === toNum(r);
  if (typeof l === "boolean" || typeof r === "boolean") return toBool(l) === toBool(r);
  return toStr(l) === toStr(r);
}

/** Wertet einen Ausdruck aus. Bei Fehlern wird das Ergebnis als leerer String geliefert. */
export function evaluate(expr: string | undefined, scope: Scope): VarValue {
  if (expr === undefined || expr === null || expr.trim() === "") return "";
  try {
    return evalNode(parse(expr), scope);
  } catch {
    return "";
  }
}

/**
 * Rendert Display-Wert: {…}-Interpolation. Der interpolierte String wird
 * unverändert ausgegeben (kein numerisches Umformatieren), damit z. B.
 * „{Temperatur} °C“ vollständig auf dem Gerät ankommt.
 */
export function formatDisplayValue(valueExpr: string, scope: Scope): string {
  let expr = valueExpr ?? "";
  const trimmed = expr.trim();
  // Kurzform „var0“ ohne Klammern → {var0}, wenn Variable existiert.
  if (trimmed && /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) && Object.prototype.hasOwnProperty.call(scope, trimmed)) {
    expr = `{${trimmed}}`;
  }
  return interpolate(expr, scope);
}

/** Wie evaluate, wirft aber bei Fehlern (für Preview/Validierung). */
export function evaluateStrict(expr: string, scope: Scope): VarValue {
  return evalNode(parse(expr), scope);
}

/**
 * Interpoliert einen Text: alle {ausdruck} werden ausgewertet und eingesetzt.
 * Ein fehlerhafter Ausdruck wird als "" eingesetzt und die Anzeige bleibt stabil.
 */
export function interpolate(template: string | undefined, scope: Scope): string {
  if (!template) return "";
  return template.replace(/\{([^}]*)\}/g, (_m, expr: string) => {
    try {
      return toStr(evaluate(expr, scope));
    } catch {
      return "";
    }
  });
}
