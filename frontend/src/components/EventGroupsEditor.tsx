import { useState } from "react";
import { api } from "../lib/api";
import { CommandResult, EventGroup, VariableDef } from "../lib/types";
import { Button, Input } from "./ui";
import { CommandEditor, SceneContext } from "./CommandEditor";

interface Props {
  sceneId: string;
  groups: EventGroup[];
  variables: VariableDef[];
  scene: SceneContext;
  dirty: boolean;
  results?: Record<string, CommandResult>;
  onChange: (groups: EventGroup[]) => void;
  onToast: (msg: string) => void;
}

function newGroup(index: number): EventGroup {
  return { id: crypto.randomUUID(), name: `Gruppe ${index + 1}`, commands: [] };
}

export function EventGroupsEditor({ sceneId, groups, variables, scene, dirty, results, onChange, onToast }: Props) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const update = (id: string, patch: Partial<EventGroup>) =>
    onChange(groups.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const remove = (id: string) => onChange(groups.filter((g) => g.id !== id));

  const run = async (id: string) => {
    if (dirty) {
      onToast("Bitte zuerst speichern, dann ausführen.");
      return;
    }
    try {
      const res = await api.runGroup(sceneId, id);
      onToast(res.ok ? "Gruppe ausgeführt." : "Gruppe nicht gefunden.");
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        Jede Event-Gruppe ist eine prozedurale Timeline: Befehle laufen von oben nach unten. Ausgelöst
        werden Gruppen über Trigger (oben) oder Button-Trigger (Buttons-Tab). Struktur-Befehle
        (Wenn/Solange/Wiederhole/Für-jedes) bilden eingerückte Blöcke.
      </p>

      {groups.length === 0 && <p className="text-sm text-slate-500">Noch keine Gruppen.</p>}

      {groups.map((g) => {
        const isCollapsed = collapsed[g.id];
        return (
          <div key={g.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <button
                onClick={() => setCollapsed({ ...collapsed, [g.id]: !isCollapsed })}
                className="text-slate-400 hover:text-slate-200"
                title={isCollapsed ? "Ausklappen" : "Einklappen"}
              >
                {isCollapsed ? "▶" : "▼"}
              </button>
              <Input className="w-56" value={g.name} onChange={(e) => update(g.id, { name: e.target.value })} placeholder="Gruppenname" />
              <span className="text-xs text-slate-500">{g.commands.length} Befehle</span>
              <div className="ml-auto flex gap-2">
                <Button variant="ghost" onClick={() => run(g.id)}>Jetzt ausführen</Button>
                <Button variant="danger" onClick={() => remove(g.id)}>Löschen</Button>
              </div>
            </div>

            {!isCollapsed && (
              <CommandEditor
                commands={g.commands}
                variables={variables}
                groups={groups}
                scene={scene}
                selfGroupId={g.id}
                results={results}
                onChange={(commands) => update(g.id, { commands })}
              />
            )}
          </div>
        );
      })}

      <div>
        <Button variant="subtle" onClick={() => onChange([...groups, newGroup(groups.length)])}>+ Gruppe</Button>
      </div>
    </div>
  );
}
