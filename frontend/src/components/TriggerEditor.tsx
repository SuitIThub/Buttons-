import { EventGroup, Trigger, TriggerType, VariableDef } from "../lib/types";
import { Button, Input, Select } from "./ui";

interface Props {
  triggers: Trigger[];
  groups: EventGroup[];
  variables: VariableDef[];
  onChange: (triggers: Trigger[]) => void;
}

/** Auslöser-Typen des Event-Tabs (Button-Trigger werden im Buttons-Tab verwaltet). */
const TRIGGER_TYPES: { value: TriggerType; label: string }[] = [
  { value: "page_enter", label: "Beim Öffnen der Seite" },
  { value: "page_leave", label: "Beim Verlassen der Seite" },
  { value: "interval", label: "Intervall (Sekunden)" },
  { value: "time", label: "Uhrzeit (HH:MM)" },
  { value: "startup", label: "Beim Start der Runtime" },
  { value: "mqtt_connected", label: "MQTT verbunden" },
  { value: "mqtt_disconnected", label: "MQTT getrennt" },
  { value: "mqtt_message", label: "MQTT-Nachricht empfangen" },
  { value: "variable_changed", label: "Variable geändert" },
];

function newTrigger(): Trigger {
  return { id: crypto.randomUUID(), type: "page_enter", groupId: "", condition: "" };
}

export function TriggerEditor({ triggers, groups, variables, onChange }: Props) {
  // Nur Nicht-Button-Trigger in diesem Editor.
  const rows = triggers.filter((t) => t.type !== "button");
  const buttonTriggers = triggers.filter((t) => t.type === "button");

  const commit = (nonButton: Trigger[]) => onChange([...buttonTriggers, ...nonButton]);
  const update = (id: string, patch: Partial<Trigger>) =>
    commit(rows.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const remove = (id: string) => commit(rows.filter((t) => t.id !== id));

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        Ein Trigger verbindet ein Ereignis (Seitenwechsel, Intervall, Variable …) mit einer Event-Gruppe.
        Mehrere Trigger dürfen dieselbe Gruppe ausführen. Bei „MQTT-Nachricht empfangen“ stehen in der
        Gruppe <code className="text-slate-300">{"{$mqttTopic}"}</code> und
        {" "}<code className="text-slate-300">{"{$mqttPayload}"}</code> zur Verfügung.
      </p>

      {rows.length === 0 && <p className="text-sm text-slate-500">Noch keine Trigger.</p>}

      {rows.map((t) => (
        <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <Select className="w-56" value={t.type} onChange={(e) => update(t.id, { type: e.target.value as TriggerType })}>
            {TRIGGER_TYPES.map((x) => (
              <option key={x.value} value={x.value}>{x.label}</option>
            ))}
          </Select>

          {t.type === "interval" && (
            <Input className="w-28" type="number" min={1} placeholder="Sek." value={t.intervalSeconds ?? 60} onChange={(e) => update(t.id, { intervalSeconds: Number(e.target.value) || 60 })} />
          )}
          {t.type === "time" && (
            <Input className="w-32" type="time" value={t.timeOfDay ?? "12:00"} onChange={(e) => update(t.id, { timeOfDay: e.target.value })} />
          )}
          {t.type === "variable_changed" && (
            <Select className="w-44" value={t.variableName ?? ""} onChange={(e) => update(t.id, { variableName: e.target.value })}>
              <option value="">— Variable —</option>
              {variables.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </Select>
          )}
          {t.type === "mqtt_message" && (
            <Input className="w-56" placeholder="Topic (z. B. home/+/state, #)" value={t.mqttTopic ?? ""} onChange={(e) => update(t.id, { mqttTopic: e.target.value })} />
          )}

          <span className="text-xs text-slate-500">→ führt aus:</span>
          <Select className="w-48" value={t.groupId} onChange={(e) => update(t.id, { groupId: e.target.value })}>
            <option value="">— Gruppe —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </Select>

          <Input className="min-w-0 flex-1" placeholder="Bedingung (optional)" value={t.condition ?? ""} onChange={(e) => update(t.id, { condition: e.target.value })} />

          <Button variant="danger" onClick={() => remove(t.id)}>Löschen</Button>
        </div>
      ))}

      <div>
        <Button variant="subtle" onClick={() => commit([...rows, newTrigger()])}>+ Trigger</Button>
      </div>
    </div>
  );
}
