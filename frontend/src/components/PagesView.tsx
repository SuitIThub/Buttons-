import { api } from "../lib/api";
import { Page, RuntimeState, Scene } from "../lib/types";
import { Button, Card, Input, Select } from "./ui";

interface Props {
  pages: Page[];
  scenes: Scene[];
  runtime: RuntimeState | null;
  refreshPages: () => Promise<void> | void;
  onToast: (msg: string) => void;
}

export function PagesView({ pages, scenes, runtime, refreshPages, onToast }: Props) {
  const guard = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      onToast((e as Error).message);
    }
  };

  const addPage = () =>
    guard(async () => {
      await api.createPage({ name: `Seite ${pages.length + 1}` });
      await refreshPages();
    });

  const renamePage = (p: Page, name: string) =>
    guard(async () => {
      await api.updatePage(p.id, { name });
      await refreshPages();
    });

  const assignScene = (p: Page, sceneId: string) =>
    guard(async () => {
      await api.updatePage(p.id, { sceneId: sceneId || null });
      await refreshPages();
    });

  const removePage = (p: Page) =>
    guard(async () => {
      await api.deletePage(p.id);
      await refreshPages();
    });

  const move = (index: number, delta: number) =>
    guard(async () => {
      const arr = [...pages];
      const target = index + delta;
      if (target < 0 || target >= arr.length) return;
      [arr[index], arr[target]] = [arr[target], arr[index]];
      await api.reorderPages(arr.map((x) => x.id));
      await refreshPages();
    });

  return (
    <Card
      title="Seiten"
      actions={
        <Button variant="subtle" onClick={addPage}>
          + Seite
        </Button>
      }
    >
      {pages.length === 0 && (
        <p className="text-sm text-slate-400">
          Noch keine Seiten. Lege eine Seite an und weise ihr eine Szene zu.
        </p>
      )}
      {scenes.length === 0 && pages.length > 0 && (
        <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Noch keine Szenen vorhanden. Erstelle und konfiguriere Szenen unter dem Tab „Szenen“.
        </p>
      )}
      <div className="flex flex-col gap-2">
        {pages.map((p, i) => {
          const isCurrent = runtime?.active && runtime.currentPage === i;
          const scene = scenes.find((s) => s.id === p.sceneId);
          return (
            <div
              key={p.id}
              className={`flex flex-wrap items-center gap-2 rounded-xl border p-2 ${
                isCurrent ? "border-brand/60 bg-brand/10" : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <span
                className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${
                  isCurrent ? "bg-brand text-white" : "bg-white/10 text-slate-300"
                }`}
                title={isCurrent ? "Aktive Seite" : undefined}
              >
                {i}
              </span>
              <Input
                className="w-40"
                defaultValue={p.name}
                onBlur={(e) => e.target.value !== p.name && renamePage(p, e.target.value)}
              />
              <Select
                className="w-56"
                value={p.sceneId ?? ""}
                onChange={(e) => assignScene(p, e.target.value)}
                disabled={scenes.length === 0}
              >
                <option value="">— keine Szene —</option>
                {scenes.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.category !== "custom" ? ` (${s.category})` : ""}
                  </option>
                ))}
              </Select>
              {scene && (
                <span className="text-xs text-slate-500">{scene.display.length} Elemente</span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <Button variant="subtle" onClick={() => move(i, -1)} disabled={i === 0}>
                  ↑
                </Button>
                <Button variant="subtle" onClick={() => move(i, 1)} disabled={i === pages.length - 1}>
                  ↓
                </Button>
                <Button variant="danger" onClick={() => removePage(p)}>
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
