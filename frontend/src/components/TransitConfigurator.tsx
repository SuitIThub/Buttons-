import { TRANSIT_ROUTE_SLOTS, TransitConfig, TransitRoute, TransitStop } from "../lib/types";
import { uid } from "../lib/uid";
import { StopSearchInput } from "./StopSearchInput";
import { Button, Card, Field, Input } from "./ui";

interface Props {
  config: TransitConfig;
  onChange: (config: TransitConfig) => void;
}

/**
 * Route im Editor: Start/Ziel dürfen noch fehlen. Unvollständige Routen
 * verwirft das Backend beim Speichern.
 */
type RouteDraft = Omit<TransitRoute, "from" | "to"> & { from: TransitStop | null; to: TransitStop | null };

/** Route-Slot i liegt auf Button-ID 2+i (B2..B7) = Geräte-Position 3+i. */
const buttonLabel = (slot: number) => `B${slot + 2} · Position ${slot + 3}`;

export function TransitConfigurator({ config, onChange }: Props) {
  const routes: (RouteDraft | null)[] = Array.from(
    { length: TRANSIT_ROUTE_SLOTS },
    (_, i) => (config.routes[i] as RouteDraft | null | undefined) ?? null,
  );

  const setRoutes = (next: (RouteDraft | null)[]) =>
    onChange({ ...config, routes: next as (TransitRoute | null)[] });

  const patchRoute = (slot: number, p: Partial<RouteDraft>) => {
    const cur = routes[slot] ?? { id: uid(), name: "", from: null, to: null, walkMinutes: 0 };
    setRoutes(routes.map((r, i) => (i === slot ? { ...cur, ...p } : r)));
  };

  const clearRoute = (slot: number) => setRoutes(routes.map((r, i) => (i === slot ? null : r)));

  const swapRoute = (slot: number) => {
    const r = routes[slot];
    if (r) patchRoute(slot, { from: r.to, to: r.from });
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="Abfahrtsübersicht">
        <Field label="Haltestelle (Hauptdisplay)">
          <StopSearchInput value={config.station} onChange={(station) => onChange({ ...config, station })} />
        </Field>
        <p className="mt-2 text-xs text-slate-500">
          Das Hauptdisplay zeigt die nächsten Abfahrten dieser Haltestelle in Echtzeit (GVH).
        </p>
      </Card>

      <Card title="Routen">
        <p className="mb-3 text-xs text-slate-500">
          Jede Route liegt auf einem Button. In der Übersicht zeigt der Button den Routennamen, seine LED
          zeigt den Status der nächsten Verbindung (grün pünktlich, orange verspätet ab 3 min, gelb Hinweis, rot Störung).
          Die Übersicht teilt die Abfahrten in stadteinwärts und stadtauswärts auf (nicht bei Haltestellen
          in der Innenstadt).
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {routes.map((r, slot) => {
            const incomplete = r && (!r.from || !r.to);
            return (
              <div key={slot} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">{buttonLabel(slot)}</span>
                  {r ? (
                    <div className="flex gap-1">
                      <Button variant="subtle" onClick={() => swapRoute(slot)} title="Start und Ziel tauschen">
                        ⇄
                      </Button>
                      <Button variant="danger" onClick={() => clearRoute(slot)}>
                        Leeren
                      </Button>
                    </div>
                  ) : (
                    <Button variant="subtle" onClick={() => patchRoute(slot, {})}>
                      + Route
                    </Button>
                  )}
                </div>
                {r && (
                  <div className="flex flex-col gap-2">
                    <Field label="Name (Button-Anzeige)">
                      <Input
                        placeholder="z. B. Arbeit"
                        value={r.name}
                        maxLength={24}
                        onChange={(e) => patchRoute(slot, { name: e.target.value })}
                      />
                    </Field>
                    <Field label="Start">
                      <StopSearchInput value={r.from} onChange={(from) => patchRoute(slot, { from })} />
                    </Field>
                    <Field label="Ziel">
                      <StopSearchInput value={r.to} onChange={(to) => patchRoute(slot, { to })} />
                    </Field>
                    <Field label="Fußweg zum Start (min)">
                      <Input
                        type="number"
                        min={0}
                        max={60}
                        value={r.walkMinutes ?? 0}
                        onChange={(e) =>
                          patchRoute(slot, { walkMinutes: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })
                        }
                      />
                    </Field>
                    {incomplete && (
                      <p className="text-xs text-amber-300">
                        Start und Ziel wählen – unvollständige Routen werden nicht gespeichert.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card title="Bedienung am Gerät">
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
          <li>B0/B1 (Display-Buttons) blättern wie gewohnt zwischen den Seiten.</li>
          <li>Übersicht: B2–B7 öffnen die jeweilige Route.</li>
          <li>
            Verbindungsliste (3 je Seite): B2/B3 bewegen die Auswahl und blättern am Ende weiter, B4 öffnet
            die Verbindung, B5 zeigt einen QR-Code (GVH-Auskunft aufs Handy).
          </li>
          <li>Detail: Halte, Verspätungen und Umstiegszeiten; B2/B3 scrollen, B4 zurück.</li>
          <li>B6 ist bei Hinweisen (gelb) oder Störungen (rot) markiert und zeigt die Meldungen.</li>
          <li>B7 führt aus jeder Ansicht zurück zur Übersicht.</li>
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          Änderungen gelten nach dem Speichern. Ein Deploy ist nur nötig, wenn die Szene neu einer Seite
          zugewiesen wird.
        </p>
      </Card>
    </div>
  );
}
