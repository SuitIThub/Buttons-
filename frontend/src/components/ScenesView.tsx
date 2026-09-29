import { api } from "../lib/api";
import { Page, Scene } from "../lib/types";
import { Badge, Button, Card, Input } from "./ui";

const CATEGORY_LABELS: Record<Scene["category"], string> = {
  custom: "Custom",
  cookbook: "CookBook",
  transit: "Fahrplan",
};

interface Props {
  scenes: Scene[];
  pages: Page[];
  onConfigure: (sceneId: string) => void;
  refreshScenes: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

export function ScenesView({ scenes, pages, onConfigure, refreshScenes, onToast }: Props) {
  const usageCount = (sceneId: string) => pages.filter((p) => p.sceneId === sceneId).length;

  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const createScene = () =>
    guard(async () => {
      const scene = await api.createScene({ name: `Szene ${scenes.length + 1}`, category: "custom" });
      await refreshScenes();
      onConfigure(scene.id);
    });

  const createCookBookScene = () =>
    guard(async () => {
      const scene = await api.createScene({
        name: "CookBook",
        category: "cookbook",
        cookbook: { endpoint: "", items: [] },
      });
      await refreshScenes();
      onConfigure(scene.id);
    });

  const createTransitScene = () =>
    guard(async () => {
      const scene = await api.createScene({
        name: "Fahrplan",
        category: "transit",
        transit: { station: null, routes: [] },
      });
      await refreshScenes();
      onConfigure(scene.id);
    });

  const renameScene = (s: Scene, name: string) =>
    guard(async () => {
      await api.updateScene(s.id, { name });
      await refreshScenes();
    });

  const removeScene = (s: Scene) =>
    guard(async () => {
      const used = usageCount(s.id);
      if (used > 0) {
        onToast(`Szene wird noch von ${used} Seite(n) verwendet. Zuweisung zuerst entfernen.`);
        return;
      }
      await api.deleteScene(s.id);
      await refreshScenes();
      onToast("Szene gelöscht.");
    });

  return (
    <Card
      title="Szenen"
      actions={
        <div className="flex gap-1">
          <Button variant="subtle" onClick={createScene}>
            + Szene
          </Button>
          <Button variant="subtle" onClick={createCookBookScene}>
            + CookBook
          </Button>
          <Button variant="subtle" onClick={createTransitScene}>
            + Fahrplan
          </Button>
        </div>
      }
    >
      <p className="mb-3 text-xs text-slate-500">
        Szenen werden hier erstellt und konfiguriert. Auf der Seiten-Übersicht weist du einer Seite
        nur eine bestehende Szene zu. Weitere Szenentypen folgen später.
      </p>

      {scenes.length === 0 && (
        <p className="text-sm text-slate-400">
          Noch keine Szenen. Lege eine Szene an, um Display, Buttons und Event-Gruppen zu konfigurieren.
        </p>
      )}

      <div className="flex flex-col gap-2">
        {scenes.map((s) => {
          const used = usageCount(s.id);
          return (
            <div
              key={s.id}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-2"
            >
              <Input
                className="w-48"
                defaultValue={s.name}
                onBlur={(e) => e.target.value !== s.name && renameScene(s, e.target.value)}
              />
              <Badge tone="slate">{CATEGORY_LABELS[s.category] ?? s.category}</Badge>
              <span className="text-xs text-slate-500">
                {s.display.length} Display · {s.buttons.length} Buttons · {(s.groups ?? []).length}{" "}
                Gruppen
              </span>
              {used > 0 && (
                <Badge tone="blue">
                  {used} Seite{used === 1 ? "" : "n"}
                </Badge>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" onClick={() => onConfigure(s.id)}>
                  Konfigurieren
                </Button>
                <Button variant="danger" onClick={() => removeScene(s)}>
                  Löschen
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
