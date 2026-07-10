import { CookBookConfig } from "../lib/types";
import { Button, Card, Field, Input } from "./ui";

interface Props {
  config: CookBookConfig;
  onChange: (config: CookBookConfig) => void;
}

const ITEMS_PER_PAGE = 4;

let nextId = 1;
function tempId(): string {
  return `cb-${Date.now()}-${nextId++}`;
}

export function CookBookConfigurator({ config, onChange }: Props) {
  const patch = (p: Partial<CookBookConfig>) => onChange({ ...config, ...p });

  const addItem = () => {
    patch({ items: [...config.items, { id: tempId(), name: "" }] });
  };

  const updateItem = (id: string, name: string) => {
    patch({ items: config.items.map((it) => (it.id === id ? { ...it, name } : it)) });
  };

  const removeItem = (id: string) => {
    patch({ items: config.items.filter((it) => it.id !== id) });
  };

  const totalPages = Math.max(1, Math.ceil(config.items.length / ITEMS_PER_PAGE));

  return (
    <div className="flex flex-col gap-4">
      <Card title="CookBook Konfiguration">
        <div className="flex flex-col gap-4">
          <Field label="Server-Endpunkt">
            <Input
              placeholder="https://cookbook.example.com"
              value={config.endpoint}
              onChange={(e) => patch({ endpoint: e.target.value })}
            />
          </Field>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">
                Elemente ({config.items.length})
              </span>
              <Button variant="subtle" onClick={addItem}>
                + Element
              </Button>
            </div>

            {config.items.length === 0 && (
              <p className="text-sm text-slate-500">
                Noch keine Elemente. Elemente werden auf den Buttons 5-8 angezeigt.
              </p>
            )}

            <p className="mb-2 text-xs text-slate-500">
              Tipp: Ein „~" markiert eine Umbruchstelle – z. B. „Taschen~tücher" wird auf
              dem Button als „Taschen-tücher" angezeigt, aber als „Taschentücher" an die
              CookBook-API gesendet.
            </p>

            <div className="flex flex-col gap-1.5">
              {config.items.map((item, idx) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-2 py-1"
                >
                  <span className="w-6 text-right text-xs text-slate-500">{idx + 1}.</span>
                  <Input
                    className="flex-1"
                    placeholder="Elementname"
                    value={item.name}
                    onChange={(e) => updateItem(item.id, e.target.value)}
                  />
                  <Button variant="danger" onClick={() => removeItem(item.id)}>
                    x
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </Card>

      {config.items.length > 0 && (
        <Card title="Button-Vorschau">
          <p className="mb-2 text-xs text-slate-500">
            {totalPages} Seite{totalPages !== 1 ? "n" : ""} mit je bis zu {ITEMS_PER_PAGE} Items.
            Buttons 3-4 paginieren, Buttons 5-8 senden das Item.
          </p>
          <div className="flex flex-col gap-2">
            {Array.from({ length: totalPages }, (_, pageIdx) => {
              const offset = pageIdx * ITEMS_PER_PAGE;
              const pageItems = config.items.slice(offset, offset + ITEMS_PER_PAGE);
              return (
                <div
                  key={pageIdx}
                  className="rounded-lg border border-white/10 bg-white/[0.02] p-2"
                >
                  <span className="mb-1 block text-xs text-slate-500">
                    Seite {pageIdx + 1}/{totalPages}
                  </span>
                  <div className="grid grid-cols-2 gap-1">
                    {pageItems.map((item, i) => (
                      <div
                        key={item.id}
                        className="rounded bg-white/5 px-2 py-1 text-xs text-slate-300"
                      >
                        <span className="text-slate-500">Button {5 + i}:</span>{" "}
                        {item.name ? item.name.replace(/~/g, "-") : "(leer)"}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
