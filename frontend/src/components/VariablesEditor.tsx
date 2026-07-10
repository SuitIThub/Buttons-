import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { RuntimeState, VarType, VariableDef } from "../lib/types";
import { Button, Card, Input, Select } from "./ui";
import { VAR_TYPES } from "../lib/uiConstants";
import { IconPicker } from "./IconPicker";
import { VariableLiveValue } from "./VariableLiveValue";

interface Props {
  variables: VariableDef[];
  runtime: RuntimeState | null;
  onSaved: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Row mit stabiler lokaler Identität, damit Umbenennen nicht die Zeile „verliert". */
interface Row extends VariableDef {
  _key: string;
  /** Name beim Laden (undefined = neu, noch nicht gespeichert). */
  _original?: string;
}

let rowSeq = 0;
function toRows(defs: VariableDef[]): Row[] {
  return defs.map((d) => ({ ...d, _key: `r${rowSeq++}`, _original: d.name }));
}

function defaultInitial(type: VarType): unknown {
  switch (type) {
    case "string":
    case "enum":
      return "";
    case "int":
    case "float":
      return 0;
    case "bool":
      return false;
    case "list":
      return [];
    case "dict":
      return {};
  }
}

export function VariablesEditor({ variables, runtime, onSaved, onToast }: Props) {
  const [rows, setRows] = useState<Row[]>(() => toRows(variables));
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => setRows(toRows(variables)), [variables]);

  const update = (i: number, patch: Partial<VariableDef>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const changeType = (i: number, type: VarType) => update(i, { type, initial: defaultInitial(type) });

  const add = () =>
    setRows([...rows, { name: `var${rows.length + 1}`, type: "int", initial: 0, _key: `r${rowSeq++}` }]);
  const remove = (i: number) => setRows(rows.filter((_, idx) => idx !== i));

  const save = async () => {
    const names = rows.map((r) => r.name.trim());
    const bad = names.find((n) => !VALID_NAME.test(n));
    if (bad !== undefined) {
      onToast(`Ungültiger Variablenname: "${bad}". Nur Buchstaben, Zahlen, _.`);
      return;
    }
    if (new Set(names).size !== names.length) {
      onToast("Variablennamen müssen eindeutig sein.");
      return;
    }
    setSaving(true);
    try {
      // Lokale Felder (_key/_original) vor dem Speichern entfernen.
      await api.setVariables(
        rows.map(({ _key, _original, ...v }) => ({ ...v, name: v.name.trim() })),
      );
      await onSaved();
      onToast("Variablen gespeichert.");
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const rename = async (oldName: string) => {
    const newName = window.prompt(`Variable „${oldName}" umbenennen in:`, oldName);
    if (!newName || newName === oldName) return;
    if (!VALID_NAME.test(newName)) {
      onToast("Ungültiger Name. Nur Buchstaben, Zahlen, _.");
      return;
    }
    try {
      await api.renameVariable(oldName, newName);
      await onSaved();
      onToast(`Umbenannt in „${newName}" (Referenzen aktualisiert).`);
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  return (
    <Card
      title="Variablen"
      actions={
        <div className="flex gap-2">
          <Button variant="subtle" onClick={add}>+ Variable</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Speichern…" : "Speichern"}</Button>
        </div>
      }
    >
      {rows.length === 0 && (
        <p className="text-sm text-slate-400">Variablen sind global und in allen Szenen per {"{name}"} verfügbar.</p>
      )}

      <div className="flex flex-col gap-2">
        {rows.map((r, i) => {
          // „Existierend" hängt an der stabilen Identität, NICHT am aktuell
          // getippten Namen — sonst würde das Eintippen eines vorhandenen
          // Präfixes (z. B. „wetter" → „wettertemperatur") die Zeile sperren.
          const isSaved = r._original !== undefined;
          const isOpen = expanded[r._key];
          return (
            <div key={r._key} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setExpanded({ ...expanded, [r._key]: !isOpen })}
                  className="text-slate-400 hover:text-slate-200"
                  title="Erweitert"
                >
                  {isOpen ? "▼" : "▶"}
                </button>

                {isSaved ? (
                  <span className="w-40 truncate rounded-lg bg-black/30 px-3 py-1.5 text-sm text-slate-200" title={r._original}>{r._original}</span>
                ) : (
                  <Input className="w-40" value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="name" />
                )}

                <Select className="w-36" value={r.type} onChange={(e) => changeType(i, e.target.value as VarType)}>
                  {VAR_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </Select>

                {r.computed ? (
                  <span className="rounded bg-purple-500/15 px-2 py-1 text-xs text-purple-300" title={r.computed}>= {r.computed}</span>
                ) : (
                  <InitialInput def={r} onChange={(initial) => update(i, { initial })} onToast={onToast} />
                )}

                <VariableLiveValue name={r._original ?? r.name} runtime={runtime} type={r.type} onToast={onToast} />

                <div className="ml-auto flex items-center gap-1">
                  {r.persist && <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] text-brand" title="Persistent">💾</span>}
                  {r.mqttTopic && <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300" title={`MQTT: ${r.mqttTopic}`}>📡</span>}
                  {isSaved && r._original && (
                    <button onClick={() => rename(r._original!)} className="rounded px-2 py-1 text-xs text-slate-400 hover:bg-white/10 hover:text-slate-200" title="Umbenennen (mit Referenzen)">✎</button>
                  )}
                  <Button variant="danger" onClick={() => remove(i)}>✕</Button>
                </div>
              </div>

              {isOpen && <AdvancedPanel def={r} onChange={(patch) => update(i, patch)} />}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-xs text-slate-500">
        System-Variablen (nur lesen): {"{$page}"}, {"{$pageCount}"}, {"{$pageName}"}. Funktionen: len,
        round, upper, lower, min, max, contains, get, join, keys.
      </p>
    </Card>
  );
}

/** Erweiterter Bereich pro Variable: Beschreibung, Persistenz, Grenzen, enum, computed, MQTT. */
function AdvancedPanel({ def, onChange }: { def: VariableDef; onChange: (patch: Partial<VariableDef>) => void }) {
  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-white/5 bg-black/20 p-3 md:grid-cols-2">
      <label className="md:col-span-2">
        <span className="mb-1 block text-xs text-slate-400">Beschreibung</span>
        <Input value={def.description ?? ""} onChange={(e) => onChange({ description: e.target.value })} placeholder="Wozu dient diese Variable?" />
      </label>

      <label className="flex items-center gap-2 text-xs text-slate-300">
        <input type="checkbox" checked={def.persist ?? false} onChange={(e) => onChange({ persist: e.target.checked })} className="accent-brand" />
        Persistent (übersteht Neustart)
      </label>

      {(def.type === "int" || def.type === "float") && (
        <div className="flex items-center gap-2">
          <Input className="w-20" type="number" placeholder="min" value={def.min ?? ""} onChange={(e) => onChange({ min: e.target.value === "" ? undefined : Number(e.target.value) })} />
          <Input className="w-20" type="number" placeholder="max" value={def.max ?? ""} onChange={(e) => onChange({ max: e.target.value === "" ? undefined : Number(e.target.value) })} />
          <Input className="w-20" type="number" placeholder="Schritt" value={def.step ?? ""} onChange={(e) => onChange({ step: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </div>
      )}

      {def.type === "enum" && (
        <label className="md:col-span-2">
          <span className="mb-1 block text-xs text-slate-400">Optionen (kommagetrennt)</span>
          <Input
            value={(def.options ?? []).join(", ")}
            onChange={(e) => onChange({ options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
            placeholder="z. B. rot, grün, blau"
          />
        </label>
      )}

      <label className="md:col-span-2">
        <span className="mb-1 block text-xs text-slate-400">Berechnet (Ausdruck, read-only) — leer = normale Variable</span>
        <Input value={def.computed ?? ""} onChange={(e) => onChange({ computed: e.target.value || undefined })} placeholder="z. B. a + b oder $pageCount - 1" />
      </label>

      <label>
        <span className="mb-1 block text-xs text-slate-400">MQTT-Quelle: Topic</span>
        <Input value={def.mqttTopic ?? ""} onChange={(e) => onChange({ mqttTopic: e.target.value || undefined })} placeholder="z. B. home/sensor/temp" />
      </label>
      <label>
        <span className="mb-1 block text-xs text-slate-400">MQTT JSON-Pfad (optional)</span>
        <Input value={def.mqttJsonPath ?? ""} onChange={(e) => onChange({ mqttJsonPath: e.target.value || undefined })} placeholder="z. B. main/temp" />
      </label>
    </div>
  );
}

function InitialInput({ def, onChange, onToast }: { def: VariableDef; onChange: (v: unknown) => void; onToast: (m: string) => void }) {
  const [useIconPicker, setUseIconPicker] = useState(false);

  if (def.type === "bool") {
    return (
      <Select className="w-28" value={def.initial ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="false">false</option>
        <option value="true">true</option>
      </Select>
    );
  }
  if (def.type === "int" || def.type === "float") {
    return <Input className="w-28" type="number" step={def.type === "float" ? "any" : 1} min={def.min} max={def.max} value={Number(def.initial ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (def.type === "enum") {
    const opts = def.options ?? [];
    if (opts.length > 0) {
      return (
        <Select className="w-36" value={String(def.initial ?? "")} onChange={(e) => onChange(e.target.value)}>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      );
    }
    return <Input className="w-36" value={String(def.initial ?? "")} onChange={(e) => onChange(e.target.value)} placeholder="Optionen unten setzen" />;
  }
  if (def.type === "string") {
    return (
      <div className="flex items-center gap-2">
        {useIconPicker ? (
          <div className="min-w-0 flex-1"><IconPicker value={String(def.initial ?? "")} onChange={(val) => onChange(val)} placeholder="z.B. mdi:home" /></div>
        ) : (
          <Input className="w-44" value={String(def.initial ?? "")} onChange={(e) => onChange(e.target.value)} />
        )}
        <Button type="button" variant="subtle" onClick={() => setUseIconPicker(!useIconPicker)} title={useIconPicker ? "Text" : "Icon"}>
          {useIconPicker ? "ABC" : "⬡"}
        </Button>
      </div>
    );
  }
  // list / dict als JSON
  return (
    <Input
      className="w-44"
      defaultValue={JSON.stringify(def.initial ?? (def.type === "list" ? [] : {}))}
      placeholder={def.type === "list" ? "[1, 2, 3]" : '{"k": 1}'}
      onBlur={(e) => {
        try {
          onChange(JSON.parse(e.target.value || (def.type === "list" ? "[]" : "{}")));
        } catch {
          onToast("Ungültiges JSON – bitte korrigieren.");
        }
      }}
    />
  );
}
