import { useState } from "react";
import { api } from "../lib/api";
import { RuntimeState, VarType, VariableDef } from "../lib/types";
import { Button, Input, Select } from "./ui";
import { VAR_TYPES } from "../lib/uiConstants";
import { VariableLiveValue } from "./VariableLiveValue";

interface Props {
  variables: VariableDef[];
  runtime: RuntimeState | null;
  onSaved: () => Promise<void> | void;
  onToast: (msg: string) => void;
  onOpenFull: () => void;
  onClose: () => void;
}

const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function initialFor(type: VarType): unknown {
  switch (type) {
    case "int": return 0;
    case "float": return 0;
    case "bool": return false;
    case "list": return [];
    case "dict": return {};
    default: return "";
  }
}

export function VariablesSidebar({ variables, runtime, onSaved, onToast, onOpenFull, onClose }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<VarType>("int");
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim();
    if (!VALID_NAME.test(n)) {
      onToast("Ungültiger Name. Nur Buchstaben, Zahlen, _.");
      return;
    }
    if (variables.some((v) => v.name === n)) {
      onToast(`Variable „${n}" existiert bereits.`);
      return;
    }
    setBusy(true);
    try {
      await api.setVariables([...variables, { name: n, type, initial: initialFor(type) }]);
      await onSaved();
      setName("");
      onToast(`Variable „${n}" angelegt.`);
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (v: VariableDef) => {
    setBusy(true);
    try {
      await api.setVariables(variables.filter((x) => x.name !== v.name));
      await onSaved();
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rename = async (v: VariableDef) => {
    const nn = window.prompt(`Variable „${v.name}" umbenennen in:`, v.name);
    if (!nn || nn === v.name) return;
    if (!VALID_NAME.test(nn)) {
      onToast("Ungültiger Name.");
      return;
    }
    try {
      await api.renameVariable(v.name, nn);
      await onSaved();
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  return (
    <aside className="sticky top-0 flex h-screen w-80 shrink-0 flex-col border-l border-white/10 bg-slate-900/60">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <h2 className="text-sm font-semibold text-slate-200">Variablen</h2>
        <button onClick={onClose} className="rounded px-2 py-1 text-slate-400 hover:bg-white/10 hover:text-slate-200" title="Seitenleiste schließen">✕</button>
      </div>

      {/* Schnell anlegen */}
      <div className="flex flex-col gap-2 border-b border-white/10 p-3">
        <div className="flex gap-2">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="neuer Name" onKeyDown={(e) => e.key === "Enter" && add()} />
          <Select className="w-28" value={type} onChange={(e) => setType(e.target.value as VarType)}>
            {VAR_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label.split(" ")[0]}</option>
            ))}
          </Select>
        </div>
        <Button variant="subtle" onClick={add} disabled={busy}>+ Anlegen</Button>
      </div>

      {/* Liste */}
      <div className="flex-1 overflow-y-auto p-2">
        {variables.length === 0 && <p className="p-2 text-xs text-slate-500">Noch keine Variablen.</p>}
        <div className="flex flex-col gap-1">
          {variables.map((v) => (
            <div key={v.name} className="rounded-lg border border-white/10 bg-white/[0.02] p-2">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium text-slate-200" title={v.description || v.name}>{v.name}</span>
                <span className="rounded bg-slate-500/20 px-1.5 py-0.5 text-[10px] text-slate-400">{v.type}</span>
                {v.computed && <span className="text-[10px] text-purple-300" title={`= ${v.computed}`}>ƒ</span>}
                {v.persist && <span className="text-[10px]" title="Persistent">💾</span>}
                {v.mqttTopic && <span className="text-[10px]" title={`MQTT: ${v.mqttTopic}`}>📡</span>}
                <div className="ml-auto flex items-center gap-0.5">
                  <button onClick={() => rename(v)} className="rounded px-1 text-xs text-slate-500 hover:bg-white/10 hover:text-slate-200" title="Umbenennen">✎</button>
                  <button onClick={() => remove(v)} className="rounded px-1 text-xs text-red-300 hover:bg-red-500/20" title="Löschen">✕</button>
                </div>
              </div>
              <div className="mt-1">
                <VariableLiveValue name={v.name} runtime={runtime} type={v.type} onToast={onToast} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="border-t border-white/10 p-2">
        <Button variant="ghost" className="w-full" onClick={onOpenFull}>Alle Einstellungen →</Button>
      </div>
    </aside>
  );
}
