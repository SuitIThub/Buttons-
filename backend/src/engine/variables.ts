import { EventEmitter } from "node:events";
import { VariableDef, VarType, VarValue, defaultVarValue } from "../model.js";
import { evaluate, toBool, toNum, toStr, Scope } from "./expr.js";

/** Wandelt einen beliebigen Wert in den deklarierten Variablentyp um. */
export function coerce(type: VarType, value: VarValue): VarValue {
  switch (type) {
    case "string":
    case "enum":
      return toStr(value);
    case "int":
      return Math.trunc(toNum(value));
    case "float":
      return toNum(value);
    case "bool":
      return toBool(value);
    case "list":
      return Array.isArray(value) ? value : value === "" || value == null ? [] : [value];
    case "dict":
      return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }
}

/**
 * Hält den Laufzeit-Zustand aller Variablen (typisiert) plus read-only
 * System-Variablen ($page etc.). Meldet Änderungen via "change"-Event.
 *
 * Abgeleitete (computed) Variablen werden nicht gespeichert, sondern bei jeder
 * scope()/snapshot()-Auswertung frisch berechnet.
 */
export class VariableState extends EventEmitter {
  private defs = new Map<string, VariableDef>();
  private values = new Map<string, VarValue>();
  private system: Record<string, VarValue> = {};

  /** (Neu-)Initialisiert alle Variablen aus ihren Definitionen. */
  reset(defs: VariableDef[]): void {
    this.defs.clear();
    this.values.clear();
    for (const d of defs) {
      this.defs.set(d.name, d);
      if (d.computed) continue; // abgeleitet → nicht speichern
      const initial = d.initial === undefined ? defaultVarValue(d.type) : d.initial;
      this.values.set(d.name, this.clamp(d, coerce(d.type, clone(initial))));
    }
    this.emit("change");
  }

  /**
   * Synchronisiert die Definitionen, ohne bestehende Laufzeitwerte zu verwerfen.
   *
   * - Vorhandene Variablen mit unverändertem Typ behalten ihren aktuellen Wert.
   * - Neue Variablen werden aus `seed` (persistierte Werte) oder ihrem
   *   Initialwert erzeugt.
   * - Entfernte Variablen werden gelöscht.
   *
   * Damit bleiben z. B. Zähler beim Speichern einer Szene erhalten.
   */
  resync(defs: VariableDef[], seed?: Record<string, VarValue>): void {
    const nextDefs = new Map<string, VariableDef>();
    const nextValues = new Map<string, VarValue>();

    for (const d of defs) {
      nextDefs.set(d.name, d);
      if (d.computed) continue;

      const prev = this.values.get(d.name);
      const prevType = this.defs.get(d.name)?.type;
      if (prev !== undefined && prevType === d.type) {
        nextValues.set(d.name, prev); // Laufzeitwert erhalten
      } else if (seed && Object.prototype.hasOwnProperty.call(seed, d.name)) {
        nextValues.set(d.name, this.clamp(d, coerce(d.type, clone(seed[d.name]))));
      } else {
        const initial = d.initial === undefined ? defaultVarValue(d.type) : d.initial;
        nextValues.set(d.name, this.clamp(d, coerce(d.type, clone(initial))));
      }
    }

    this.defs = nextDefs;
    this.values = nextValues;
    this.emit("change");
  }

  setSystem(key: string, value: VarValue): void {
    if (this.system[key] !== value) {
      this.system[key] = value;
      this.emit("change");
    }
  }

  /** Auswertungs-Scope: Nutzervariablen + System + abgeleitete Variablen. */
  scope(): Scope {
    const scope: Scope = {};
    for (const [k, v] of this.values) scope[k] = v;
    for (const [k, v] of Object.entries(this.system)) scope[k] = v;
    this.applyComputed(scope);
    return scope;
  }

  /** Fügt abgeleitete Variablen (in Definitionsreihenfolge) zum Scope hinzu. */
  private applyComputed(scope: Scope): void {
    for (const d of this.defs.values()) {
      if (!d.computed) continue;
      try {
        scope[d.name] = coerce(d.type, evaluate(d.computed, scope));
      } catch {
        scope[d.name] = defaultVarValue(d.type);
      }
    }
  }

  snapshot(): Record<string, VarValue> {
    const out: Record<string, VarValue> = {};
    for (const [k, v] of this.values) out[k] = clone(v);
    // Abgeleitete Werte für die UI mitliefern.
    const scope = this.scope();
    for (const d of this.defs.values()) {
      if (d.computed) out[d.name] = clone(scope[d.name] as VarValue);
    }
    return out;
  }

  systemSnapshot(): Record<string, VarValue> {
    return { ...this.system };
  }

  /** Werte der als `persist` markierten Variablen (für die Store-Sicherung). */
  persistSnapshot(): Record<string, VarValue> {
    const out: Record<string, VarValue> = {};
    for (const d of this.defs.values()) {
      if (d.persist && !d.computed && this.values.has(d.name)) {
        out[d.name] = clone(this.values.get(d.name)!);
      }
    }
    return out;
  }

  get(name: string): VarValue | undefined {
    if (this.values.has(name)) return this.values.get(name);
    if (name in this.system) return this.system[name];
    // Abgeleitete Variable → aus Scope berechnen.
    if (this.defs.get(name)?.computed) return this.scope()[name];
    return undefined;
  }

  /** Deklarierter Typ einer Variable (undefined, wenn nicht definiert). */
  getType(name: string): VarType | undefined {
    return this.defs.get(name)?.type;
  }

  /** Vollständige Definition einer Variable (undefined, wenn nicht definiert). */
  getDef(name: string): VariableDef | undefined {
    return this.defs.get(name);
  }

  /** Alle Variablen mit MQTT-Quelle (für Abonnements & eingehende Nachrichten). */
  mqttSources(): VariableDef[] {
    return [...this.defs.values()].filter((d) => d.mqttTopic && d.mqttTopic.trim());
  }

  private typeOf(name: string): VarType {
    return this.defs.get(name)?.type ?? "string";
  }

  /** Begrenzt Zahlenwerte (int/float) auf [min, max], sofern definiert. */
  private clamp(def: VariableDef | undefined, value: VarValue): VarValue {
    if (!def || (def.type !== "int" && def.type !== "float") || typeof value !== "number") return value;
    let n = value;
    if (typeof def.min === "number") n = Math.max(def.min, n);
    if (typeof def.max === "number") n = Math.min(def.max, n);
    return n;
  }

  /** Setzt eine Nutzervariable (mit Typ-Coercion). Unbekannte/abgeleitete Namen werden ignoriert. */
  set(name: string, value: VarValue): boolean {
    const def = this.defs.get(name);
    if (!def || def.computed) return false;
    this.values.set(name, this.clamp(def, coerce(def.type, value)));
    this.emit("change");
    return true;
  }

  increment(name: string, by: number): boolean {
    const t = this.typeOf(name);
    if (t !== "int" && t !== "float") return false;
    return this.set(name, toNum(this.get(name)) + by);
  }

  toggle(name: string): boolean {
    if (this.typeOf(name) !== "bool") return false;
    return this.set(name, !toBool(this.get(name)));
  }

  listPush(name: string, value: VarValue): boolean {
    if (this.typeOf(name) !== "list") return false;
    const arr = Array.isArray(this.get(name)) ? [...(this.get(name) as VarValue[])] : [];
    arr.push(value);
    return this.set(name, arr);
  }

  listRemove(name: string, indexOrValue: VarValue): boolean {
    if (this.typeOf(name) !== "list") return false;
    const arr = Array.isArray(this.get(name)) ? [...(this.get(name) as VarValue[])] : [];
    const idx = typeof indexOrValue === "number" ? indexOrValue : arr.findIndex((x) => x === indexOrValue);
    if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
    return this.set(name, arr);
  }

  /** Liefert die aktuelle Liste (Kopie) einer Listenvariable. */
  getList(name: string): VarValue[] {
    return Array.isArray(this.get(name)) ? [...(this.get(name) as VarValue[])] : [];
  }

  dictSet(name: string, key: string, value: VarValue): boolean {
    if (this.typeOf(name) !== "dict") return false;
    const cur = this.get(name);
    const obj = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur } : {};
    (obj as Record<string, VarValue>)[key] = value;
    return this.set(name, obj);
  }

  dictRemove(name: string, key: string): boolean {
    if (this.typeOf(name) !== "dict") return false;
    const cur = this.get(name);
    const obj = cur && typeof cur === "object" && !Array.isArray(cur) ? { ...cur } : {};
    delete (obj as Record<string, VarValue>)[key];
    return this.set(name, obj);
  }
}

function clone<T>(v: T): T {
  return typeof v === "object" && v !== null ? (JSON.parse(JSON.stringify(v)) as T) : v;
}
