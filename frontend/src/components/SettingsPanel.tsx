import { useEffect, useState } from "react";
import { NavSettings, Page, Settings, StatusResponse } from "../lib/types";
import { api } from "../lib/api";
import { Button, Card, Field, Input, Select } from "./ui";
import { connectorLabel } from "../lib/helpers";

export function SettingsPanel({
  status,
  pages,
  onSaved,
  onPull,
  onDeploy,
  onError,
}: {
  status: StatusResponse | null;
  pages: Page[];
  onSaved: () => void;
  onPull: () => void;
  onDeploy: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Settings>({
    deviceIp: "",
    mqttUrl: "",
    mqttUsername: "",
    mqttPassword: "",
    baseTopic: "buttonplus",
    deviceId: "",
  });
  const [nav, setNav] = useState<NavSettings>({ wrap: false, ledOnHex: "#00ff00", ledOffHex: "#ff0000", homePageId: "", homeTimeoutSeconds: 300 });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status?.settings) setForm({ ...status.settings, mqttPassword: "" });
    if (status?.nav) setNav(status.nav);
  }, [status]);

  const set = (patch: Partial<Settings>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    setSaving(true);
    try {
      await api.updateSettings(form);
      onSaved();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const saveNav = async (patch: Partial<NavSettings>) => {
    const next = { ...nav, ...patch };
    setNav(next);
    try {
      await api.updateNav(next);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Verbindung"
        actions={
          <Button onClick={save} disabled={saving}>
            {saving ? "Speichern…" : "Speichern & Verbinden"}
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Geräte-IP (Button+)">
            <Input value={form.deviceIp} onChange={(e) => set({ deviceIp: e.target.value })} placeholder="192.168.1.50" />
          </Field>
          <Field label="MQTT-Broker-URL">
            <Input value={form.mqttUrl} onChange={(e) => set({ mqttUrl: e.target.value })} placeholder="mqtt://192.168.1.10:1883" />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="MQTT-Benutzer">
              <Input value={form.mqttUsername} onChange={(e) => set({ mqttUsername: e.target.value })} />
            </Field>
            <Field label={`MQTT-Passwort${status?.settings.hasMqttPassword ? " (gesetzt)" : ""}`}>
              <Input
                type="password"
                value={form.mqttPassword}
                onChange={(e) => set({ mqttPassword: e.target.value })}
                placeholder={status?.settings.hasMqttPassword ? "•••• (leer = behalten)" : ""}
              />
            </Field>
          </div>
          <Field label="Basis-Topic">
            <Input value={form.baseTopic} onChange={(e) => set({ baseTopic: e.target.value })} />
          </Field>
        </div>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Gerät & Deploy">
          <div className="mb-3 flex flex-col gap-1 text-sm text-slate-300">
            <div>
              MQTT:{" "}
              <span className={status?.mqtt.connected ? "text-emerald-400" : "text-red-400"}>
                {status?.mqtt.connected ? "verbunden" : "getrennt"}
              </span>
            </div>
            <div>Geräte-ID: {status?.device.id ?? "—"}</div>
            <div>Firmware: {status?.device.firmware ?? "—"}</div>
          </div>
          {status?.device.connectors && status.device.connectors.length > 0 && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium text-slate-400">Module</p>
              {status.device.connectors.map((c, i) => (
                <div key={c.id} className="text-xs text-slate-400">
                  Modul {i}: {connectorLabel(c.type)}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onPull}>
              Konfig vom Gerät laden
            </Button>
            <Button onClick={onDeploy}>Auf Gerät deployen</Button>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            „Deployen“ übersetzt Seiten, Szenen und Logik automatisch in die Gerätekonfiguration und
            alle MQTT-Topics – du musst dich nie mit Topics befassen.
          </p>
        </Card>

        <Card title="Navigation (Display-Modul)">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={nav.wrap}
                onChange={(e) => saveNav({ wrap: e.target.checked })}
              />
              Am Rand umbrechen (Wrap-Around)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Field label="LED: Richtung verfügbar">
                <input
                  type="color"
                  value={nav.ledOnHex}
                  onChange={(e) => saveNav({ ledOnHex: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/30"
                />
              </Field>
              <Field label="LED: nicht verfügbar">
                <input
                  type="color"
                  value={nav.ledOffHex}
                  onChange={(e) => saveNav({ ledOffHex: e.target.value })}
                  className="h-9 w-full rounded-lg border border-white/10 bg-black/30"
                />
              </Field>
            </div>
            <p className="text-xs text-slate-500">
              Die beiden Buttons des Display-Moduls blättern vor/zurück. Ihre Front-LED zeigt, ob es in
              die Richtung eine Seite gibt.
            </p>

            <div className="mt-1 border-t border-white/10 pt-3">
              <div className="grid grid-cols-2 gap-2">
                <Field label="Hauptseite">
                  <Select
                    value={nav.homePageId ?? ""}
                    onChange={(e) => saveNav({ homePageId: e.target.value })}
                  >
                    <option value="">— keine —</option>
                    {[...pages].sort((a, b) => a.order - b.order).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rücksprung nach (Sek.)">
                  <Input
                    type="number"
                    min={0}
                    value={nav.homeTimeoutSeconds ?? 300}
                    onChange={(e) => saveNav({ homeTimeoutSeconds: Number(e.target.value) || 0 })}
                    disabled={!nav.homePageId}
                  />
                </Field>
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Ohne Eingabe springt das Gerät nach dieser Zeit auf die Hauptseite zurück
                (0 = aus). Nach einem Deploy startet immer die erste Seite.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
