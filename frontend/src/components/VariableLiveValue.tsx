import { useState } from "react";
import { api } from "../lib/api";
import { RuntimeState, VarType } from "../lib/types";

/** Live-Wert einer Variable aus der Runtime, klickbar zum direkten Setzen. */
export function VariableLiveValue({
  name,
  runtime,
  type,
  onToast,
}: {
  name: string;
  runtime: RuntimeState | null;
  type: VarType;
  onToast: (m: string) => void;
}) {
  const live = runtime?.variables?.[name];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  if (live === undefined) return null;

  const display = typeof live === "object" ? JSON.stringify(live) : String(live);

  const commit = async () => {
    setEditing(false);
    let value: unknown = draft;
    try {
      if (type === "int" || type === "float") value = Number(draft);
      else if (type === "bool") value = draft === "true" || draft === "1";
      else if (type === "list" || type === "dict") value = JSON.parse(draft);
    } catch {
      onToast("Ungültiger Wert.");
      return;
    }
    try {
      await api.setVariableValue(name, value);
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-28 rounded border border-brand bg-black/40 px-2 py-0.5 text-xs text-slate-100 outline-none"
      />
    );
  }

  return (
    <button
      onClick={() => {
        setDraft(display);
        setEditing(true);
      }}
      className="max-w-[10rem] truncate rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-300 hover:bg-emerald-500/25"
      title="Klicken zum Setzen (live)"
    >
      live: {display}
    </button>
  );
}
