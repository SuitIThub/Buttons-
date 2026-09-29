import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  BPConnector,
  ButtonBinding,
  CookBookConfig,
  DisplayElement,
  TransitConfig,
  EventGroup,
  RuntimeState,
  Scene,
  Trigger,
  VariableDef,
  VarValue,
} from "../lib/types";
import { Button, Input } from "./ui";
import { DisplayDesigner } from "./DisplayDesigner";
import { ButtonsConfig } from "./ButtonsConfig";
import { EventGroupsEditor } from "./EventGroupsEditor";
import { TriggerEditor } from "./TriggerEditor";
import { CookBookConfigurator } from "./CookBookConfigurator";
import { TransitConfigurator } from "./TransitConfigurator";
import { SceneContext } from "./CommandEditor";
import { ConnectorType, mapButtons } from "../lib/helpers";

interface Props {
  sceneId: string;
  connectors: BPConnector[];
  variables: VariableDef[];
  runtime: RuntimeState | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (msg: string) => void;
}

type SubTab = "display" | "buttons" | "events";

export function SceneConfigurator({
  sceneId,
  connectors,
  variables,
  runtime,
  onClose,
  onSaved,
  onToast,
}: Props) {
  const [scene, setScene] = useState<Scene | null>(null);
  const [tab, setTab] = useState<SubTab>("display");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .getScene(sceneId)
      .then((s) => setScene({ ...s, groups: s.groups ?? [], triggers: s.triggers ?? [] }))
      .catch((e) => onToast((e as Error).message));
  }, [sceneId, onToast]);

  const runtimeVars = useMemo(() => {
    const vars: Record<string, VarValue> = {
      ...(runtime?.variables ?? {}),
      ...(runtime?.system ?? {}),
    };
    // Vorschau: Initialwerte nutzen, wenn Runtime noch nicht aktiv ist.
    for (const v of variables) {
      if (vars[v.name] === undefined && v.initial !== undefined) {
        vars[v.name] = v.initial;
      }
    }
    return vars;
  }, [runtime, variables]);

  if (!scene) {
    return <div className="p-6 text-sm text-slate-400">Szene wird geladen…</div>;
  }

  // Kontext für setDisplay-/setButton-Aktionen: Elemente + konfigurierbare Buttons.
  const displayIndex = connectors.findIndex(
    (c) => c.type === ConnectorType.DISPLAY || c.type === ConnectorType.DISPLAY_V2,
  );
  const navIds = new Set(displayIndex >= 0 ? [displayIndex * 2, displayIndex * 2 + 1] : []);
  const sceneCtx: SceneContext = {
    displayElements: scene.display,
    buttonIds: mapButtons(connectors)
      .map((p) => p.id)
      .filter((id) => !navIds.has(id)),
  };

  const patch = (p: Partial<Scene>) => {
    setScene({ ...scene, ...p });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Partial<Scene> = {
        name: scene.name,
        display: scene.display,
        buttons: scene.buttons,
        groups: scene.groups,
        triggers: scene.triggers,
      };
      if (scene.category === "cookbook") {
        payload.cookbook = scene.cookbook;
      }
      if (scene.category === "transit") {
        payload.transit = scene.transit;
      }
      const saved = await api.updateScene(scene.id, payload);
      setScene(saved);
      setDirty(false);
      onSaved();
      onToast("Szene gespeichert.");
    } catch (e) {
      onToast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onClose}>
          ← Zurück zu Szenen
        </Button>
        <Input
          className="max-w-xs"
          value={scene.name}
          onChange={(e) => patch({ name: e.target.value })}
        />
        <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-xs text-slate-300">
          Kategorie:{" "}
          {scene.category === "cookbook" ? "CookBook" : scene.category === "transit" ? "Fahrplan" : "Custom"}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dirty && <span className="text-xs text-amber-300">Ungespeichert</span>}
          <Button onClick={save} disabled={saving}>
            {saving ? "Speichern…" : "Speichern"}
          </Button>
        </div>
      </div>

      {scene.category === "cookbook" ? (
        <>
          <CookBookConfigurator
            config={scene.cookbook ?? { endpoint: "", items: [] }}
            onChange={(cookbook: CookBookConfig) => patch({ cookbook })}
          />
          <p className="text-xs text-slate-500">
            Buttons 3-4 paginieren durch die Elemente. Buttons 5-8 senden das Element an die
            CookBook-Sammeleinkaufsliste. Einträge und Texte gelten nach dem Speichern.
            Ein Deploy ist nur nötig, wenn die Szene neu einer Seite zugewiesen wird.
          </p>
        </>
      ) : scene.category === "transit" ? (
        <TransitConfigurator
          config={scene.transit ?? { station: null, routes: [] }}
          onChange={(transit: TransitConfig) => patch({ transit })}
        />
      ) : (
        <>
          <div className="flex gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1">
            {(
              [
                { id: "display", label: "Display-Designer" },
                { id: "buttons", label: "Buttons & Logik" },
                { id: "events", label: "Event-Gruppen" },
              ] as { id: SubTab; label: string }[]
            ).map((t) => (
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
          </div>

          {tab === "display" && (
            <DisplayDesigner
              elements={scene.display}
              runtimeVars={runtimeVars}
              onChange={(display: DisplayElement[]) => patch({ display })}
            />
          )}
          {tab === "buttons" && (
            <ButtonsConfig
              buttons={scene.buttons}
              connectors={connectors}
              groups={scene.groups}
              triggers={scene.triggers}
              onChange={(btns: ButtonBinding[]) => patch({ buttons: btns })}
              onTriggersChange={(triggers: Trigger[]) => patch({ triggers })}
            />
          )}
          {tab === "events" && (
            <div className="flex flex-col gap-4">
              <TriggerEditor
                triggers={scene.triggers}
                groups={scene.groups}
                variables={variables}
                onChange={(triggers: Trigger[]) => patch({ triggers })}
              />
              <EventGroupsEditor
                sceneId={scene.id}
                groups={scene.groups}
                variables={variables}
                scene={sceneCtx}
                dirty={dirty}
                results={runtime?.commandResults}
                onChange={(groups: EventGroup[]) => patch({ groups })}
                onToast={onToast}
              />
            </div>
          )}

          <p className="text-xs text-slate-500">
            Ein Deploy ist nur für das Layout nötig (Display-Position, Größe, Farbe, neue oder entfernte
            Elemente und Buttons, Seiten). Texte, LEDs und Event-Gruppen gelten direkt nach dem Speichern.
          </p>
        </>
      )}
    </div>
  );
}
