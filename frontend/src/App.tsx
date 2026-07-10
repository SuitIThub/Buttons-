import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/api";
import { useWs } from "./lib/useWs";
import { Page, RuntimeState, Scene, StatusResponse, VariableDef, WsEvent } from "./lib/types";
import { Badge, Button } from "./components/ui";
import { PagesView } from "./components/PagesView";
import { ScenesView } from "./components/ScenesView";
import { VariablesEditor } from "./components/VariablesEditor";
import { VariablesSidebar } from "./components/VariablesSidebar";
import { SettingsPanel } from "./components/SettingsPanel";
import { SceneConfigurator } from "./components/SceneConfigurator";

type Tab = "pages" | "scenes" | "variables" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "pages", label: "Seiten" },
  { id: "scenes", label: "Szenen" },
  { id: "variables", label: "Variablen" },
  { id: "settings", label: "Einstellungen" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("pages");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [runtime, setRuntime] = useState<RuntimeState | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [variables, setVariables] = useState<VariableDef[]>([]);
  const [openSceneId, setOpenSceneId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      setRuntime(s.runtime);
    } catch (e) {
      showToast(`Status-Fehler: ${(e as Error).message}`);
    }
  }, [showToast]);

  const refreshPages = useCallback(async () => {
    try {
      setPages(await api.getPages());
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [showToast]);

  const refreshScenes = useCallback(async () => {
    try {
      setScenes(await api.getScenes());
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [showToast]);

  const refreshVariables = useCallback(async () => {
    try {
      setVariables(await api.getVariables());
    } catch (e) {
      showToast((e as Error).message);
    }
  }, [showToast]);

  // Kombinierte Refreshes: nach Szenen-/Seiten-Änderungen auch den Status neu
  // laden, damit die „nicht deployt"-Warnung sofort erscheint.
  const refreshScenesAndStatus = useCallback(async () => {
    await refreshScenes();
    await refreshStatus();
  }, [refreshScenes, refreshStatus]);

  const refreshPagesAndStatus = useCallback(async () => {
    await refreshPages();
    await refreshStatus();
  }, [refreshPages, refreshStatus]);

  const reloadAll = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshPages(), refreshScenes(), refreshVariables()]);
  }, [refreshStatus, refreshPages, refreshScenes, refreshVariables]);

  const openScene = useCallback((sceneId: string) => {
    setTab("scenes");
    setOpenSceneId(sceneId);
  }, []);

  const closeScene = useCallback(() => {
    setOpenSceneId(null);
    setTab("scenes");
    void refreshScenesAndStatus();
  }, [refreshScenesAndStatus]);

  useEffect(() => {
    refreshStatus();
    refreshPages();
    refreshScenes();
    refreshVariables();
  }, [refreshStatus, refreshPages, refreshScenes, refreshVariables]);

  const onWsEvent = useCallback((ev: WsEvent) => {
    if (ev.type === "status" && ev.status) {
      setStatus((s) => (s ? { ...s, mqtt: ev.status! } : s));
    } else if (ev.type === "runtime" && ev.state) {
      setRuntime(ev.state);
    }
  }, []);

  const { connected: wsConnected } = useWs(onWsEvent);

  const pullFromDevice = useCallback(async () => {
    try {
      await api.pullConfig();
      await refreshStatus();
      showToast("Konfiguration vom Gerät geladen.");
    } catch (e) {
      showToast(`Laden fehlgeschlagen: ${(e as Error).message}`);
    }
  }, [refreshStatus, showToast]);

  const deploy = useCallback(async () => {
    try {
      const res = await api.deploy();
      await refreshStatus();
      showToast(`Deployed: ${res.pages} Seiten, ${res.buttons} Buttons, ${res.displays} Elemente.`);
    } catch (e) {
      showToast(`Deploy fehlgeschlagen: ${(e as Error).message}`);
    }
  }, [refreshStatus, showToast]);

  const mqtt = status?.mqtt;
  const connectors = status?.device.connectors ?? [];

  return (
    <div className="flex min-h-screen">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-lg font-bold text-white">
            B+
          </div>
          <div>
            <h1 className="text-lg font-semibold">Button+ Automations-Manager</h1>
            <p className="text-xs text-slate-400">
              {status?.device.id ? `Gerät ${status.device.id}` : "Kein Gerät geladen"}
              {status?.device.firmware ? ` · FW ${status.device.firmware}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {runtime?.active && (
            <Badge tone="blue">
              Seite {runtime.currentPage + 1}/{runtime.pageCount}
              {runtime.pageName ? ` · ${runtime.pageName}` : ""}
            </Badge>
          )}
          <Badge tone={mqtt?.connected ? "green" : "red"}>
            MQTT {mqtt?.connected ? "verbunden" : "getrennt"}
          </Badge>
          <Badge tone={wsConnected ? "green" : "slate"}>Live {wsConnected ? "an" : "aus"}</Badge>
          {status?.undeployed && <Badge tone="red">Nicht deployt</Badge>}
          <Button variant="subtle" onClick={() => setSidebarOpen((v) => !v)} title="Variablen-Seitenleiste">
            ☰ Variablen
          </Button>
          <Button onClick={deploy} className={status?.undeployed ? "ring-2 ring-amber-400/70" : ""}>
            Deploy
          </Button>
        </div>
      </header>

      {mqtt?.error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          MQTT-Fehler: {mqtt.error}
        </div>
      )}

      {status?.undeployed && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          <span>⚠️ Es gibt gespeicherte Änderungen, die noch nicht auf das Gerät deployt wurden.</span>
          <Button variant="subtle" className="ml-auto" onClick={deploy}>Jetzt deployen</Button>
        </div>
      )}

      {openSceneId ? (
        <SceneConfigurator
          sceneId={openSceneId}
          connectors={connectors}
          variables={variables}
          runtime={runtime}
          onClose={closeScene}
          onSaved={refreshScenesAndStatus}
          onToast={showToast}
        />
      ) : (
        <>
          <nav className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  tab === t.id ? "bg-brand text-white" : "text-slate-300 hover:bg-white/5"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>

          {tab === "pages" && (
            <PagesView
              pages={pages}
              scenes={scenes}
              runtime={runtime}
              refreshPages={refreshPagesAndStatus}
              onToast={showToast}
            />
          )}

          {tab === "scenes" && (
            <ScenesView
              scenes={scenes}
              pages={pages}
              onConfigure={openScene}
              refreshScenes={refreshScenesAndStatus}
              onToast={showToast}
            />
          )}

          {tab === "variables" && (
            <VariablesEditor
              variables={variables}
              runtime={runtime}
              onSaved={refreshVariables}
              onToast={showToast}
            />
          )}

          {tab === "settings" && (
            <SettingsPanel
              status={status}
              pages={pages}
              onSaved={async () => {
                await refreshStatus();
                showToast("Einstellungen gespeichert.");
              }}
              onImported={async () => {
                await reloadAll();
                showToast("Konfiguration importiert.");
              }}
              onPull={pullFromDevice}
              onDeploy={deploy}
              onError={showToast}
            />
          )}
        </>
      )}
      </div>

      {sidebarOpen && (
        <VariablesSidebar
          variables={variables}
          runtime={runtime}
          onSaved={refreshVariables}
          onToast={showToast}
          onOpenFull={() => {
            setOpenSceneId(null);
            setTab("variables");
          }}
          onClose={() => setSidebarOpen(false)}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 rounded-lg border border-white/10 bg-slate-800 px-4 py-2 text-sm shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
