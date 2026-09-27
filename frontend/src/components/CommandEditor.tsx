import { useEffect, useState } from "react";
import { Command, CommandResult, CommandType, DisplayElement, EventGroup, HttpMethod, ListMode, SensorInfo, VariableDef } from "../lib/types";
import { api } from "../lib/api";
import { uid } from "../lib/uid";
import { Button, Input, Select } from "./ui";
import { IconPicker } from "./IconPicker";
import {
  COMMAND_META,
  CLOSER_OF,
  commandLabel,
  computeIndentLevels,
  isMarker,
  isOpener,
  matchingCloserIndex,
  newCommand,
  validateTimeline,
} from "../lib/commands";

/** Szene-Kontext für setDisplay-/setButton-Befehle. */
export interface SceneContext {
  displayElements: DisplayElement[];
  buttonIds: number[];
}

interface Props {
  commands: Command[];
  variables: VariableDef[];
  groups: EventGroup[];
  scene: SceneContext;
  /** ID der aktuellen Gruppe (wird aus der runGroup-Auswahl ausgeblendet). */
  selfGroupId?: string;
  /** Letzte Ausführungsergebnisse pro Befehl-ID (aus der Runtime). */
  results?: Record<string, CommandResult>;
  onChange: (commands: Command[]) => void;
}

function ResultBadge({ result }: { result?: CommandResult }) {
  if (!result) return null;
  const tone =
    result.status === "error"
      ? "border-red-500/30 bg-red-500/10 text-red-300"
      : result.status === "warn"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
        : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  const icon = result.status === "error" ? "✕" : result.status === "warn" ? "⚠" : "✓";
  return (
    <div className={`mt-1 w-full truncate rounded border px-2 py-0.5 text-[11px] ${tone}`} title={result.message}>
      {icon} {result.message}
    </div>
  );
}

const CATEGORIES = Array.from(new Set(COMMAND_META.map((m) => m.category)));

function VarSelect({
  value,
  variables,
  filter,
  placeholder = "— Variable —",
  onChange,
}: {
  value?: string;
  variables: VariableDef[];
  filter?: VariableDef["type"][];
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const list = filter ? variables.filter((v) => filter.includes(v.type)) : variables;
  return (
    <Select className="w-40" value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {list.map((v) => (
        <option key={v.name} value={v.name}>
          {v.name} ({v.type})
        </option>
      ))}
    </Select>
  );
}

interface PropField {
  key: string;
  label: string;
  placeholder?: string;
  icon?: boolean;
}
const DISPLAY_FIELDS: PropField[] = [
  { key: "label", label: "Label", placeholder: "Überschrift" },
  { key: "value", label: "Wert", placeholder: "z. B. {temp}" },
  { key: "unit", label: "Einheit", placeholder: "°C" },
  { key: "svg", label: "Icon", icon: true },
  { key: "color", label: "Farbe", placeholder: "#ffffff" },
];
const BUTTON_FIELDS: PropField[] = [
  { key: "label", label: "Label", placeholder: "z. B. {on ? 'aus' : 'an'}" },
  { key: "toplabel", label: "Top-Label" },
  { key: "svg", label: "Icon", icon: true },
  { key: "ledColor", label: "Front-LED", placeholder: "#00ff00 oder Ausdruck" },
  { key: "wallColor", label: "Rück-LED", placeholder: "#ff0000 oder Ausdruck, leer = aus" },
];

function PropsFields({
  fields,
  props,
  onChange,
}: {
  fields: PropField[];
  props: Record<string, string>;
  onChange: (p: Record<string, string>) => void;
}) {
  const toggle = (key: string, on: boolean) => {
    const next = { ...props };
    if (on) next[key] = next[key] ?? "";
    else delete next[key];
    onChange(next);
  };
  return (
    <div className="mt-1 grid w-full gap-1.5 md:grid-cols-2">
      {fields.map((f) => {
        const active = f.key in props;
        return (
          <div key={f.key} className="flex items-center gap-2">
            <label className="flex w-28 shrink-0 cursor-pointer items-center gap-1.5 text-xs text-slate-400">
              <input type="checkbox" checked={active} onChange={(e) => toggle(f.key, e.target.checked)} className="accent-brand" />
              {f.label}
            </label>
            {active ? (
              f.icon ? (
                <div className="min-w-0 flex-1">
                  <IconPicker value={props[f.key] ?? ""} onChange={(v) => onChange({ ...props, [f.key]: v })} />
                </div>
              ) : (
                <Input className="min-w-0 flex-1" placeholder={f.placeholder} value={props[f.key] ?? ""} onChange={(e) => onChange({ ...props, [f.key]: e.target.value })} />
              )
            ) : (
              <span className="flex-1 text-xs text-slate-600">unverändert</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

const LIST_MODES: { value: ListMode; label: string }[] = [
  { value: "append", label: "Anhängen" },
  { value: "prepend", label: "Voranstellen" },
  { value: "insertAt", label: "Einfügen an Index" },
  { value: "set", label: "Ersetzen an Index" },
  { value: "extend", label: "Mit Liste erweitern" },
  { value: "removeAt", label: "Entfernen an Index" },
  { value: "removeValue", label: "Wert entfernen" },
  { value: "clear", label: "Leeren" },
  { value: "get", label: "Lesen an Index →" },
  { value: "first", label: "Erstes lesen →" },
  { value: "last", label: "Letztes lesen →" },
  { value: "length", label: "Länge →" },
  { value: "find", label: "Index von Wert →" },
];
const READ_MODES = new Set<ListMode>(["get", "first", "last", "length", "find"]);

function CommandFields({
  cmd,
  variables,
  groups,
  scene,
  sensors,
  selfGroupId,
  set,
}: {
  cmd: Command;
  variables: VariableDef[];
  groups: EventGroup[];
  scene: SceneContext;
  sensors: SensorInfo[];
  selfGroupId?: string;
  set: (patch: Partial<Command>) => void;
}) {
  switch (cmd.type) {
    case "setVar":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} onChange={(v) => set({ variable: v })} />
          <Input placeholder="Ausdruck, z. B. count + 1" value={cmd.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />
        </>
      );
    case "incVar":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["int", "float"]} onChange={(v) => set({ variable: v })} />
          <Input placeholder="Schritt (leer = Variablen-Schritt)" value={cmd.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />
        </>
      );
    case "toggleVar":
      return <VarSelect value={cmd.variable} variables={variables} filter={["bool"]} onChange={(v) => set({ variable: v })} />;
    case "getVar":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} placeholder="— Ziel —" onChange={(v) => set({ variable: v })} />
          <span className="text-xs text-slate-500">←</span>
          <VarSelect value={cmd.from} variables={variables} placeholder="— Quelle —" onChange={(v) => set({ from: v })} />
        </>
      );
    case "randomVar":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["int", "float"]} onChange={(v) => set({ variable: v })} />
          <Input className="w-24" placeholder="min" value={cmd.min ?? ""} onChange={(e) => set({ min: e.target.value })} />
          <Input className="w-24" placeholder="max" value={cmd.max ?? ""} onChange={(e) => set({ max: e.target.value })} />
        </>
      );
    case "mathOp":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["int", "float"]} placeholder="— Zahl —" onChange={(v) => set({ variable: v })} />
          <Select className="w-36" value={cmd.mathMode ?? "round"} onChange={(e) => set({ mathMode: e.target.value as "round" | "floor" | "ceil" })}>
            <option value="round">Runden</option>
            <option value="floor">Abrunden</option>
            <option value="ceil">Aufrunden</option>
          </Select>
          {(cmd.mathMode ?? "round") === "round" && (
            <Input className="w-28" placeholder="Dezimalstellen" value={cmd.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />
          )}
        </>
      );
    case "formatNumber":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["string"]} placeholder="— Ziel-Text —" onChange={(v) => set({ variable: v })} />
          <span className="text-xs text-slate-500">←</span>
          <Input className="w-36" placeholder="Zahl/Ausdruck, z. B. {temp}" value={cmd.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />
          <Input className="w-28" placeholder="Maske, z. B. 00.00" value={cmd.pattern ?? ""} onChange={(e) => set({ pattern: e.target.value })} />
        </>
      );
    case "strReplace":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["string"]} onChange={(v) => set({ variable: v })} />
          <Input className="w-32" placeholder="suchen" value={cmd.find ?? ""} onChange={(e) => set({ find: e.target.value })} />
          <Input className="w-32" placeholder="ersetzen" value={cmd.replace ?? ""} onChange={(e) => set({ replace: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={cmd.all !== false} onChange={(e) => set({ all: e.target.checked })} className="accent-brand" /> alle
          </label>
        </>
      );
    case "strSplit":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["list"]} placeholder="— Ziel-Liste —" onChange={(v) => set({ variable: v })} />
          <Input className="w-40" placeholder="Quelle, z. B. {text}" value={cmd.from ?? ""} onChange={(e) => set({ from: e.target.value })} />
          <Input className="w-24" placeholder="Trenner" value={cmd.separator ?? ""} onChange={(e) => set({ separator: e.target.value })} />
        </>
      );
    case "listOp": {
      const isRead = READ_MODES.has(cmd.listMode ?? "append");
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["list"]} placeholder="— Liste —" onChange={(v) => set({ variable: v })} />
          <Select className="w-44" value={cmd.listMode ?? "append"} onChange={(e) => set({ listMode: e.target.value as ListMode })}>
            {LIST_MODES.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </Select>
          {(cmd.listMode === "insertAt" || cmd.listMode === "set" || cmd.listMode === "removeAt" || cmd.listMode === "get") && (
            <Input className="w-20" placeholder="Index" value={cmd.index ?? ""} onChange={(e) => set({ index: e.target.value })} />
          )}
          {(cmd.listMode === "append" || cmd.listMode === "prepend" || cmd.listMode === "insertAt" || cmd.listMode === "set" || cmd.listMode === "removeValue" || cmd.listMode === "find") && (
            <Input className="w-32" placeholder="Wert" value={cmd.value ?? ""} onChange={(e) => set({ value: e.target.value })} />
          )}
          {cmd.listMode === "extend" && (
            <VarSelect value={cmd.from} variables={variables} filter={["list"]} placeholder="— andere Liste —" onChange={(v) => set({ from: v })} />
          )}
          {isRead && (
            <>
              <span className="text-xs text-slate-500">→</span>
              <VarSelect value={cmd.target} variables={variables} placeholder="— Ziel —" onChange={(v) => set({ target: v })} />
            </>
          )}
        </>
      );
    }
    case "range":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} onChange={(v) => set({ variable: v })} />
          <Input className="w-40" placeholder="z. B. 1-5,8,10-12" value={cmd.rangeExpr ?? ""} onChange={(e) => set({ rangeExpr: e.target.value })} />
          <Select className="w-32" value={cmd.rangeMode ?? "next"} onChange={(e) => set({ rangeMode: e.target.value as Command["rangeMode"] })}>
            <option value="next">nächster</option>
            <option value="rev">rückwärts</option>
            <option value="first">erster</option>
            <option value="last">letzter</option>
            <option value="list">ganze Liste</option>
          </Select>
        </>
      );
    case "dictSet":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["dict"]} onChange={(v) => set({ variable: v })} />
          <Input className="w-28" placeholder="Schlüssel ({var} ok)" value={cmd.key ?? ""} onChange={(e) => set({ key: e.target.value })} />
          <Input className="w-32" placeholder="Wert" value={cmd.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />
        </>
      );
    case "dictRemove":
      return (
        <>
          <VarSelect value={cmd.variable} variables={variables} filter={["dict"]} onChange={(v) => set({ variable: v })} />
          <Input className="w-28" placeholder="Schlüssel ({var} ok)" value={cmd.key ?? ""} onChange={(e) => set({ key: e.target.value })} />
        </>
      );
    case "dictGet":
      return (
        <>
          <VarSelect value={cmd.target} variables={variables} placeholder="— Ziel —" onChange={(v) => set({ target: v })} />
          <span className="text-xs text-slate-500">←</span>
          <VarSelect value={cmd.from} variables={variables} filter={["dict"]} placeholder="— Dict —" onChange={(v) => set({ from: v })} />
          <Input className="w-28" placeholder="Schlüssel ({var} ok)" value={cmd.key ?? ""} onChange={(e) => set({ key: e.target.value })} />
        </>
      );
    case "if":
    case "elseif":
      return <Input placeholder="Bedingung, z. B. count > 3" value={cmd.condition ?? ""} onChange={(e) => set({ condition: e.target.value })} />;
    case "while":
      return (
        <>
          <Input placeholder="Bedingung" value={cmd.condition ?? ""} onChange={(e) => set({ condition: e.target.value })} />
          <Input className="w-28" type="number" placeholder="max. Iterationen" value={cmd.maxIterations ?? ""} onChange={(e) => set({ maxIterations: Number(e.target.value) || undefined })} />
        </>
      );
    case "repeat":
      return <Input className="w-40" placeholder="Anzahl, z. B. 5" value={cmd.count ?? ""} onChange={(e) => set({ count: e.target.value })} />;
    case "forEach":
      return (
        <>
          <VarSelect value={cmd.listVar} variables={variables} filter={["list"]} placeholder="— Liste —" onChange={(v) => set({ listVar: v })} />
          <span className="text-xs text-slate-500">→ Item</span>
          <VarSelect value={cmd.itemVar} variables={variables} placeholder="— Item-Var —" onChange={(v) => set({ itemVar: v })} />
          <span className="text-xs text-slate-500">Index</span>
          <VarSelect value={cmd.indexVar} variables={variables} filter={["int"]} placeholder="— optional —" onChange={(v) => set({ indexVar: v })} />
        </>
      );
    case "pause":
      return (
        <>
          <Input className="w-40" placeholder="Dauer" value={cmd.durationMs ?? ""} onChange={(e) => set({ durationMs: e.target.value })} />
          <span className="text-xs text-slate-500">ms</span>
        </>
      );
    case "runGroup":
      return (
        <Select className="w-56" value={cmd.group ?? ""} onChange={(e) => set({ group: e.target.value })}>
          <option value="">— Gruppe —</option>
          {groups.filter((g) => g.id !== selfGroupId).map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </Select>
      );
    case "label":
    case "log":
      return <Input placeholder={cmd.type === "log" ? "Text/Ausdruck, z. B. Wert: {x}" : "Kommentar"} value={cmd.text ?? ""} onChange={(e) => set({ text: e.target.value })} />;
    case "navigate":
      return (
        <>
          <Select className="w-40" value={cmd.navTarget ?? "next"} onChange={(e) => set({ navTarget: e.target.value as Command["navTarget"] })}>
            <option value="next">Nächste Seite</option>
            <option value="prev">Vorherige Seite</option>
            <option value="goto">Zu Seite (Index)</option>
          </Select>
          {cmd.navTarget === "goto" && <Input className="w-32" placeholder="Seitenindex" value={cmd.page ?? ""} onChange={(e) => set({ page: e.target.value })} />}
        </>
      );
    case "setBrightness":
      return <Input className="w-40" placeholder="0–100 oder Ausdruck" value={cmd.expression ?? ""} onChange={(e) => set({ expression: e.target.value })} />;
    case "setDisplay":
      return (
        <div className="flex w-full flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-56" value={cmd.elementId ?? ""} onChange={(e) => set({ elementId: e.target.value })}>
              <option value="">— Display-Element —</option>
              {scene.displayElements.map((el, i) => (
                <option key={el.id} value={el.id}>Element {i + 1}: {el.label || el.value || "(leer)"}</option>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={cmd.reset ?? false} onChange={(e) => set({ reset: e.target.checked })} className="accent-brand" /> zurücksetzen
            </label>
          </div>
          {!cmd.reset && <PropsFields fields={DISPLAY_FIELDS} props={cmd.props ?? {}} onChange={(p) => set({ props: p })} />}
        </div>
      );
    case "setButton":
      return (
        <div className="flex w-full flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-40" value={cmd.buttonId !== undefined ? String(cmd.buttonId) : ""} onChange={(e) => set({ buttonId: e.target.value === "" ? undefined : Number(e.target.value) })}>
              <option value="">— Button —</option>
              {scene.buttonIds.map((id) => (
                <option key={id} value={id}>Button {id}</option>
              ))}
            </Select>
            <label className="flex items-center gap-1 text-xs text-slate-400">
              <input type="checkbox" checked={cmd.reset ?? false} onChange={(e) => set({ reset: e.target.checked })} className="accent-brand" /> zurücksetzen
            </label>
          </div>
          {!cmd.reset && <PropsFields fields={BUTTON_FIELDS} props={cmd.props ?? {}} onChange={(p) => set({ props: p })} />}
        </div>
      );
    case "httpRequest": {
      const m = cmd.method ?? "GET";
      return (
        <div className="flex w-full flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Select className="w-24" value={m} onChange={(e) => set({ method: e.target.value as HttpMethod })}>
              {(["GET", "POST", "PUT", "DELETE"] as HttpMethod[]).map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
            <Input className="min-w-0 flex-1" placeholder="https://api…/x?id={var}" value={cmd.url ?? ""} onChange={(e) => set({ url: e.target.value })} />
            <Select className="w-24" value={cmd.responseMode ?? "json"} onChange={(e) => set({ responseMode: e.target.value as "raw" | "json" | "xml" })}>
              <option value="raw">Raw</option>
              <option value="json">JSON</option>
              <option value="xml">XML</option>
            </Select>
            <span className="text-xs text-slate-500">→</span>
            <VarSelect value={cmd.variable} variables={variables} filter={(cmd.responseMode ?? "json") === "raw" ? ["string"] : ["dict", "string"]} placeholder="— Antwort —" onChange={(v) => set({ variable: v })} />
          </div>
          {(m === "POST" || m === "PUT") && (
            <Input placeholder='Body, z. B. {"v": {count}}' value={cmd.body ?? ""} onChange={(e) => set({ body: e.target.value })} />
          )}
          <Input placeholder='Header (JSON, optional), z. B. {"Authorization": "Bearer {token}"}' value={cmd.headers ?? ""} onChange={(e) => set({ headers: e.target.value })} />
          <p className="text-[11px] text-slate-500">
            String-Ziel = Rohtext 1:1. Dict-Ziel = geflattet (nur JSON/XML).
          </p>
        </div>
      );
    }
    case "mqttPublish":
      return (
        <>
          <Input className="w-52" placeholder="Topic, z. B. home/licht/set" value={cmd.topic ?? ""} onChange={(e) => set({ topic: e.target.value })} />
          <Input className="w-40" placeholder="Payload" value={cmd.payload ?? ""} onChange={(e) => set({ payload: e.target.value })} />
          <label className="flex items-center gap-1 text-xs text-slate-400">
            <input type="checkbox" checked={cmd.retain ?? false} onChange={(e) => set({ retain: e.target.checked })} className="accent-brand" /> retain
          </label>
        </>
      );
    case "mqttRead":
      return (
        <>
          <Input className="min-w-0 flex-1" placeholder="Topic, z. B. home/temp/state" value={cmd.topic ?? ""} onChange={(e) => set({ topic: e.target.value })} />
          <Input className="w-36" placeholder="JSON-Pfad (optional)" value={cmd.jsonPath ?? ""} onChange={(e) => set({ jsonPath: e.target.value })} />
          <span className="text-xs text-slate-500">→</span>
          <VarSelect value={cmd.variable} variables={variables} placeholder="— Ziel —" onChange={(v) => set({ variable: v })} />
        </>
      );
    case "sensorRead":
      return (
        <>
          <Select className="min-w-0 flex-1" value={cmd.sensorId ?? ""} onChange={(e) => set({ sensorId: e.target.value || undefined })}>
            <option value="">— Sensor —</option>
            {sensors.map((s) => (
              <option key={s.sensorid} value={s.sensorid}>{s.description} ({s.sensorid})</option>
            ))}
            {cmd.sensorId && !sensors.some((s) => s.sensorid === cmd.sensorId) && (
              <option value={cmd.sensorId}>{cmd.sensorId}</option>
            )}
          </Select>
          <span className="text-xs text-slate-500">→</span>
          <VarSelect value={cmd.variable} variables={variables} placeholder="— Ziel —" onChange={(v) => set({ variable: v })} />
        </>
      );
    default:
      return null; // Marker (else/endif/…) haben keine Felder
  }
}

/** Kategorisiertes „Befehl hinzufügen"-Menü. */
function AddMenu({ onPick, label = "+ Befehl" }: { onPick: (type: CommandType) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button variant="subtle" onClick={() => setOpen(!open)}>{label}</Button>
      {open && (
        <div className="absolute left-0 z-40 mt-1 max-h-80 w-64 overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-2 shadow-2xl">
          {CATEGORIES.map((cat) => (
            <div key={cat} className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{cat}</p>
              {COMMAND_META.filter((m) => m.category === cat).map((m) => (
                <button
                  key={m.type}
                  onClick={() => { onPick(m.type); setOpen(false); }}
                  className="block w-full rounded px-2 py-1 text-left text-xs text-slate-300 hover:bg-white/10"
                >
                  {m.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CommandEditor({ commands, variables, groups, scene, selfGroupId, results, onChange }: Props) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [sensors, setSensors] = useState<SensorInfo[]>([]);
  const indents = computeIndentLevels(commands);
  const error = validateTimeline(commands);

  // Sensorliste des Geräts einmalig laden (für die sensorRead-Auswahl).
  useEffect(() => {
    let alive = true;
    api.getSensors().then((s) => { if (alive) setSensors(s); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const set = (id: string, patch: Partial<Command>) =>
    onChange(commands.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  /** Fügt einen Befehl an Position `at` ein (Blöcke inkl. End-Marker). */
  const insertAt = (type: CommandType, at: number) => {
    const items: Command[] = [newCommand(type)];
    const closer = CLOSER_OF[type];
    if (closer) items.push(newCommand(closer));
    const next = [...commands];
    next.splice(at, 0, ...items);
    onChange(next);
  };

  /** Fügt elseif/else vor dem passenden endif eines if-Blocks ein. */
  const insertBranch = (ifIdx: number, type: "elseif" | "else") => {
    const endIdx = matchingCloserIndex(commands, ifIdx);
    if (endIdx < 0) return;
    const next = [...commands];
    next.splice(endIdx, 0, newCommand(type));
    onChange(next);
  };

  /** Löscht eine Zeile; Öffner/Schließer werden paarweise entfernt. */
  const remove = (idx: number) => {
    const c = commands[idx];
    const next = [...commands];
    if (isOpener(c.type)) {
      const end = matchingCloserIndex(commands, idx);
      if (end >= 0) next.splice(end, 1);
      next.splice(idx, 1);
    } else if (CLOSER_OF && Object.values(CLOSER_OF).includes(c.type)) {
      // Schließer → passenden Öffner finden
      let depth = 0;
      for (let i = idx; i >= 0; i--) {
        if (Object.values(CLOSER_OF).includes(commands[i].type)) depth++;
        else if (isOpener(commands[i].type)) {
          depth--;
          if (depth === 0) { next.splice(idx, 1); next.splice(i, 1); break; }
        }
      }
    } else {
      next.splice(idx, 1);
    }
    onChange(next);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= commands.length) return;
    const next = [...commands];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
  };

  /** Dupliziert einen Befehl; bei Block-Öffnern den gesamten Block (mit End-Marker). */
  const duplicate = (idx: number) => {
    const c = commands[idx];
    let block: Command[];
    let at: number;
    if (isOpener(c.type)) {
      const end = matchingCloserIndex(commands, idx);
      if (end < 0) return;
      block = commands.slice(idx, end + 1);
      at = end + 1;
    } else {
      block = [c];
      at = idx + 1;
    }
    // Tiefe Kopie mit neuen IDs (props/verschachtelte Felder nicht teilen).
    const clones = block.map((cmd) => ({ ...(JSON.parse(JSON.stringify(cmd)) as Command), id: uid() }));
    const next = [...commands];
    next.splice(at, 0, ...clones);
    onChange(next);
  };

  const onDrop = (target: number) => {
    if (dragIdx === null || dragIdx === target) return;
    move(dragIdx, dragIdx < target ? target - 1 : target);
    setDragIdx(null);
  };

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs text-amber-300">
          ⚠️ {error}
        </div>
      )}

      {commands.length === 0 && <p className="text-xs text-slate-500">Noch keine Befehle. Diese Timeline läuft von oben nach unten.</p>}

      <div className="flex flex-col gap-1">
        {commands.map((c, idx) => {
          const marker = isMarker(c.type);
          const disabled = c.enabled === false;
          return (
            <div
              key={c.id}
              draggable
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(idx)}
              style={{ marginLeft: `${indents[idx] * 20}px` }}
              className={`flex flex-wrap items-center gap-2 rounded-lg border p-2 ${
                marker ? "border-white/5 bg-white/[0.02]" : "border-white/10 bg-black/20"
              } ${disabled ? "opacity-50" : ""}`}
            >
              <span className="cursor-grab select-none text-slate-600" title="Ziehen zum Verschieben">≡</span>
              <input
                type="checkbox"
                checked={c.enabled !== false}
                onChange={(e) => set(c.id, { enabled: e.target.checked })}
                className="accent-brand"
                title="Aktiv"
              />
              <span className={`shrink-0 text-xs font-semibold ${marker ? "text-slate-400" : "text-brand"}`}>
                {commandLabel(c.type)}
              </span>
              {!marker && (
                <CommandFields
                  cmd={c}
                  variables={variables}
                  groups={groups}
                  scene={scene}
                  sensors={sensors}
                  selfGroupId={selfGroupId}
                  set={(patch) => set(c.id, patch)}
                />
              )}
              {/* „Sonst wenn" ist ein Marker (kein CommandFields), braucht aber eine Bedingung. */}
              {c.type === "elseif" && (
                <Input
                  className="min-w-0 flex-1"
                  placeholder="Bedingung, z. B. count > 3"
                  value={c.condition ?? ""}
                  onChange={(e) => set(c.id, { condition: e.target.value })}
                />
              )}
              {c.type === "if" && (
                <div className="flex gap-1">
                  <button onClick={() => insertBranch(idx, "elseif")} className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10">+ Sonst-wenn</button>
                  <button onClick={() => insertBranch(idx, "else")} className="rounded bg-white/5 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/10">+ Sonst</button>
                </div>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => move(idx, idx - 1)} className="rounded px-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200" title="Hoch">↑</button>
                <button onClick={() => move(idx, idx + 1)} className="rounded px-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200" title="Runter">↓</button>
                {!isMarker(c.type) && (
                  <button onClick={() => duplicate(idx)} className="rounded px-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-200" title={isOpener(c.type) ? "Block duplizieren" : "Duplizieren"}>⧉</button>
                )}
                {isOpener(c.type) && <InlineAdd onPick={(t) => insertAt(t, idx + 1)} />}
                <button onClick={() => remove(idx)} className="rounded px-1.5 text-red-300 hover:bg-red-500/20" title="Löschen">✕</button>
              </div>
              {!isMarker(c.type) && <ResultBadge result={results?.[c.id]} />}
            </div>
          );
        })}
      </div>

      <div>
        <AddMenu onPick={(t) => insertAt(t, commands.length)} />
      </div>
    </div>
  );
}

/** Kompaktes „im Block einfügen"-Menü (⊕ an Öffner-Zeilen). */
function InlineAdd({ onPick }: { onPick: (t: CommandType) => void }) {
  return <AddMenu onPick={onPick} label="⊕" />;
}
