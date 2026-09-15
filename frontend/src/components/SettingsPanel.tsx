import { useEffect, useRef, useState } from "react";
import { LedDimSettings, NavSettings, Page, RuntimeState, Settings, StatusResponse } from "../lib/types";
import { api } from "../lib/api";
import { Button, Card, Field, Input, Select } from "./ui";
import { connectorLabel } from "../lib/helpers";

const DEFAULT_LED_DIM: LedDimSettings = {
  enabled: false,
  brightnessPercent: 20,
  timeZone: "Europe/Berlin",
  windows: [{ start: "22:00", end: "06:00" }],
};

function toTimeValue(value: string | undefined): string {
  const v = (value ?? "").slice(0, 5);
  return /^\d{2}:\d{2}$/.test(v) ? v : "22:00";
}

function zonedHhmm(timeZone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      timeZone: timeZone || "Europe/Berlin",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at);
  } catch {
    return new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  }
}

function parseMinutes(value: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})/.exec((value ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function isDimWindowActive(ledDim: LedDimSettings, at = new Date()): boolean {
  if (!ledDim.enabled) return false;
  const [hh, mm] = zonedHhmm(ledDim.timeZone ?? "Europe/Berlin", at).split(":").map(Number);
  const now = hh * 60 + mm;
  return (ledDim.windows ?? []).some((w) => {
    const s = parseMinutes(w.start);
    const e = parseMinutes(w.end);
    if (s === null || e === null || s === e) return false;
    if (s < e) return now >= s && now < e;
    return now >= s || now < e;
  });
}

export function SettingsPanel({
  status,
  runtime,
  pages,
  onSaved,
  onImported,
  onPull,
  onDeploy,
  onError,
}: {
  status: StatusResponse | null;
  runtime: RuntimeState | null;
  pages: Page[];
  onSaved: () => void;
  onImported: () => void;
  onPull: () => void;
  onDeploy: () => void;
  onError: (msg: string) => void;
}) {
  const importInputRef = useRef<HTMLInputElement>(null);

  const exportConfig = async () => {
    try {
      const res = await fetch("/api/export");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `buttonsplus-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      onError(`Export fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  const importConfig = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      await api.importConfig(data);
      onImported();
    } catch (e) {
      onError(`Import fehlgeschlagen: ${(e as Error).message}`);
    }
  };
  const [form, setForm] = useState<Settings>({
    deviceIp: "",
    mqttUrl: "",
    mqttUsername: "",
    mqttPassword: "",
    baseTopic: "buttonplus",
    deviceId: "",
  });
  const [nav, setNav] = useState<NavSettings>({ wrap: false, ledOnHex: "#00ff00", ledOffHex: "#ff0000", homePageId: "", homeTimeoutSeconds: 300 });
  const [ledDim, setLedDim] = useState<LedDimSettings>(DEFAULT_LED_DIM);
  const [saving, setSaving] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const ledDimTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ledDimRef = useRef(ledDim);
  ledDimRef.current = ledDim;

  useEffect(() => {
    if (status?.settings) setForm({ ...status.settings, mqttPassword: "" });
    if (status?.nav) setNav(status.nav);
    if (status?.ledDim) {
      const next = {
        ...DEFAULT_LED_DIM,
        ...status.ledDim,
        windows: Array.isArray(status.ledDim.windows) ? status.ledDim.windows : DEFAULT_LED_DIM.windows,
      };
      ledDimRef.current = next;
      setLedDim(next);
    }
  }, [status]);

  useEffect(() => () => {
    if (ledDimTimer.current) clearTimeout(ledDimTimer.current);
  }, []);

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 15_000);
    return () => clearInterval(id);
  }, []);

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

  const persistLedDim = async (next: LedDimSettings) => {
    try {
      const saved = await api.updateLedDim(next);
      ledDimRef.current = saved;
      setLedDim(saved);
    } catch (e) {
      onError((e as Error).message);
    }
  };

  const saveLedDim = (patch: Partial<LedDimSettings>, debounce = false) => {
    const next: LedDimSettings = { ...ledDimRef.current, ...patch };
    ledDimRef.current = next;
    setLedDim(next);
    if (ledDimTimer.current) clearTimeout(ledDimTimer.current);
    const flush = () => {
      ledDimTimer.current = null;
      void persistLedDim(ledDimRef.current);
    };
    if (!debounce) {
      flush();
      return;
    }
    ledDimTimer.current = setTimeout(flush, 400);
  };

  const updateWindow = (index: number, patch: Partial<LedDimSettings["windows"][number]>) => {
    const windows = ledDimRef.current.windows.map((w, i) => (i === index ? { ...w, ...patch } : w));
    saveLedDim({ windows });
  };

  const removeWindow = (index: number) => {
    saveLedDim({ windows: ledDimRef.current.windows.filter((_, i) => i !== index) });
  };

  const addWindow = () => {
    saveLedDim({ windows: [...ledDimRef.current.windows, { start: "22:00", end: "06:00" }] });
  };

  const tz = ledDim.timeZone || "Europe/Berlin";
  void clockTick;
  const dimNowActive = isDimWindowActive(ledDim) || Boolean(runtime?.ledDimActive);
  const dimClock = zonedHhmm(tz);

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

          <div className="mt-3 border-t border-white/10 pt-3">
            <p className="mb-2 text-xs font-medium text-slate-400">Konfiguration sichern</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" onClick={exportConfig}>Exportieren</Button>
              <Button variant="ghost" onClick={() => importInputRef.current?.click()}>Importieren</Button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void importConfig(file);
                  e.target.value = ""; // gleiche Datei erneut wählbar machen
                }}
              />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Sichert bzw. lädt die komplette Konfiguration (Seiten, Szenen, Variablen, Einstellungen).
              Import <span className="text-amber-300">ersetzt</span> alles und enthält Zugangsdaten im
              Klartext. Danach „Auf Gerät deployen“, um die Änderungen aufs Gerät zu bringen.
            </p>
          </div>
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

        <Card title="LED-Helligkeit">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={ledDim.enabled}
                onChange={(e) => saveLedDim({ enabled: e.target.checked })}
              />
              Button-LEDs in Zeitspannen reduzieren
            </label>
            <p className={`text-xs ${dimNowActive ? "text-amber-300" : "text-slate-500"}`}>
              Jetzt {dimClock} ({tz})
              {ledDim.enabled
                ? dimNowActive
                  ? " — Dimmung aktiv, LEDs reduziert."
                  : " — außerhalb der Zeitspannen, volle Helligkeit."
                : " — Dimmung aus."}
            </p>
            <Field label={`Helligkeit in den Zeitspannen (${ledDim.brightnessPercent} %)`}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={ledDim.brightnessPercent}
                disabled={!ledDim.enabled}
                onChange={(e) => saveLedDim({ brightnessPercent: Number(e.target.value) }, true)}
                className="w-full accent-brand disabled:opacity-40"
              />
            </Field>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-medium text-slate-400">Zeitspannen (Ortszeit)</p>
              {ledDim.windows.map((w, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field label="Von">
                    <Input
                      type="time"
                      value={toTimeValue(w.start)}
                      disabled={!ledDim.enabled}
                      onChange={(e) => updateWindow(i, { start: e.target.value.slice(0, 5) })}
                    />
                  </Field>
                  <Field label="Bis">
                    <Input
                      type="time"
                      value={toTimeValue(w.end)}
                      disabled={!ledDim.enabled}
                      onChange={(e) => updateWindow(i, { end: e.target.value.slice(0, 5) })}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    className="mb-0.5 shrink-0"
                    disabled={!ledDim.enabled}
                    onClick={() => removeWindow(i)}
                  >
                    Entfernen
                  </Button>
                </div>
              ))}
              <Button variant="ghost" disabled={!ledDim.enabled} onClick={addWindow}>
                Zeitspanne hinzufügen
              </Button>
            </div>
            <p className="text-xs text-slate-500">
              Gilt für alle Button-LEDs (Front, Wand, Navigation). Zeiten gelten in Europe/Berlin,
              unabhängig von der Server-Uhr. Spannen über Mitternacht sind möglich, z. B. 22:00–06:00.
              Die Display-Helligkeit bleibt unverändert.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
