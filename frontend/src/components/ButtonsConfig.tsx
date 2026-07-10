import { BPConnector, ButtonBinding, EventGroup, Trigger } from "../lib/types";
import { Button, Field, Input } from "./ui";
import { ConnectorType, connectorLabel, mapButtons } from "../lib/helpers";
import { IconPicker } from "./IconPicker";

interface Props {
  buttons: ButtonBinding[];
  connectors: BPConnector[];
  groups: EventGroup[];
  triggers: Trigger[];
  onChange: (buttons: ButtonBinding[]) => void;
  onTriggersChange: (triggers: Trigger[]) => void;
}

export function ButtonsConfig({ buttons, connectors, groups, triggers, onChange, onTriggersChange }: Props) {
  const physical = mapButtons(connectors);
  const displayIndex = connectors.findIndex(
    (c) => c.type === ConnectorType.DISPLAY || c.type === ConnectorType.DISPLAY_V2,
  );
  const navIds = new Set(displayIndex >= 0 ? [displayIndex * 2, displayIndex * 2 + 1] : []);
  const configurable = physical.filter((p) => !navIds.has(p.id));

  const getBinding = (id: number) => buttons.find((b) => b.buttonId === id);

  const upsert = (id: number, patch: Partial<ButtonBinding>) => {
    const existing = getBinding(id);
    if (existing) {
      onChange(buttons.map((b) => (b.buttonId === id ? { ...b, ...patch } : b)));
    } else {
      onChange([...buttons, { buttonId: id, label: "", toplabel: "", svg: "", ledColor: "", ...patch }]);
    }
  };

  // Button-Trigger dieses Buttons.
  const triggersFor = (id: number) => triggers.filter((t) => t.type === "button" && t.buttonId === id);
  const addTrigger = (id: number) =>
    onTriggersChange([
      ...triggers,
      { id: crypto.randomUUID(), type: "button", buttonId: id, press: "click", groupId: "", condition: "" },
    ]);
  const updateTrigger = (tid: string, patch: Partial<Trigger>) =>
    onTriggersChange(triggers.map((t) => (t.id === tid ? { ...t, ...patch } : t)));
  const removeTrigger = (tid: string) => onTriggersChange(triggers.filter((t) => t.id !== tid));

  if (configurable.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        Keine konfigurierbaren Buttons. Lade zuerst die Gerätekonfiguration.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {navIds.size > 0 && (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
          Die zwei Display-Modul-Buttons sind fest für Vorherige/Nächste Seite reserviert.
        </p>
      )}
      <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
        Buttons definieren nur ihr Aussehen. Für Logik fügst du <strong>Trigger</strong> hinzu, die eine
        Event-Gruppe (Tab „Event-Gruppen") ausführen.
      </p>

      {configurable.map((p) => {
        const b = getBinding(p.id);
        const btnTriggers = triggersFor(p.id);
        return (
          <div key={p.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand/20 text-xs font-bold text-brand">{p.id}</span>
              <span className="text-sm font-semibold text-slate-200">
                {connectorLabel(p.connectorType)} · {p.side === "left" ? "links" : "rechts"}
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Field label="Label">
                <Input value={b?.label ?? ""} onChange={(e) => upsert(p.id, { label: e.target.value })} />
              </Field>
              <Field label="Top-Label">
                <Input value={b?.toplabel ?? ""} onChange={(e) => upsert(p.id, { toplabel: e.target.value })} />
              </Field>
              <Field label="SVG-Icon">
                <IconPicker placeholder="z.B. mdi:home oder {iconVar}" value={b?.svg ?? ""} onChange={(val) => upsert(p.id, { svg: val })} />
              </Field>
              <Field label="LED-Farbe">
                <Input placeholder="#00ff00 oder on ? '#0f0' : '#f00'" value={b?.ledColor ?? ""} onChange={(e) => upsert(p.id, { ledColor: e.target.value })} />
              </Field>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">Trigger</span>
                <Button variant="subtle" onClick={() => addTrigger(p.id)}>+ Trigger</Button>
              </div>
              {btnTriggers.length === 0 && <p className="text-xs text-slate-500">Noch keine Trigger.</p>}
              <div className="flex flex-col gap-2">
                {btnTriggers.map((t) => (
                  <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                    <select
                      className="w-40 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand"
                      value={t.press ?? "click"}
                      onChange={(e) => updateTrigger(t.id, { press: e.target.value as Trigger["press"] })}
                    >
                      <option value="click">Bei Klick</option>
                      <option value="long_press">Bei langem Druck</option>
                    </select>
                    <span className="text-xs text-slate-500">→</span>
                    <select
                      className="w-48 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5 text-sm text-slate-100 outline-none focus:border-brand"
                      value={t.groupId}
                      onChange={(e) => updateTrigger(t.id, { groupId: e.target.value })}
                    >
                      <option value="">— Gruppe —</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>{g.name}</option>
                      ))}
                    </select>
                    <Input className="min-w-0 flex-1" placeholder="Bedingung (optional)" value={t.condition ?? ""} onChange={(e) => updateTrigger(t.id, { condition: e.target.value })} />
                    <Button variant="danger" onClick={() => removeTrigger(t.id)}>✕</Button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
      <p className="text-xs text-slate-500">
        In Textfeldern kannst du Variablen einfügen, z. B. <code className="text-slate-300">{"{TestVal}"}</code>{" "}
        oder <code className="text-slate-300">{"{on ? '#0f0' : '#f00'}"}</code> für LED-Farben.
      </p>
    </div>
  );
}
