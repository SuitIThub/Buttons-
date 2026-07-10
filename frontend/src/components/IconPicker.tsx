import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { COMMON_ICONS, ICON_CATEGORIES } from "../lib/icons";
import { Button } from "./ui";

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

interface IconHit {
  name: string;
  path: string;
}

/** Modul-weiter Cache: Icon-Name (ohne "mdi:") → SVG-Path. */
const pathCache = new Map<string, string>();

function cacheHits(hits: IconHit[]): void {
  for (const h of hits) pathCache.set(h.name, h.path);
}

/** "mdi:home" / "home" → "home"; rohes SVG oder Ausdrücke → null. */
function mdiName(value: string): string | null {
  const v = value.trim().toLowerCase();
  const name = v.startsWith("mdi:") ? v.slice(4) : v;
  return /^[a-z0-9-]+$/.test(name) ? name : null;
}

/** Kleine SVG-Vorschau eines MDI-Paths (erbt die Textfarbe). */
function IconPreview({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className ?? "h-6 w-6"} fill="currentColor" aria-hidden>
      <path d={path} />
    </svg>
  );
}

export function IconPicker({ value, onChange, placeholder }: Props) {
  const [showPicker, setShowPicker] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("Alle");
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<IconHit[]>([]);
  const [total, setTotal] = useState(0);
  const [curatedReady, setCuratedReady] = useState(false);
  const [valuePath, setValuePath] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // Vorschau-Paths der kuratierten Icons einmalig laden (beim ersten Öffnen).
  useEffect(() => {
    if (!showPicker || curatedReady) return;
    const names = COMMON_ICONS.map((i) => i.value.replace(/^mdi:/, ""));
    api
      .lookupIcons(names)
      .then((r) => {
        cacheHits(r.icons);
        setCuratedReady(true);
      })
      .catch(() => setCuratedReady(true));
  }, [showPicker, curatedReady]);

  // Live-Suche über die volle MDI-Bibliothek (debounced).
  useEffect(() => {
    const q = search.trim();
    if (!showPicker || !q) {
      setResults([]);
      setTotal(0);
      return;
    }
    const seq = ++requestSeq.current;
    const timer = setTimeout(() => {
      api
        .searchIcons(q)
        .then((r) => {
          if (requestSeq.current !== seq) return; // veraltete Antwort
          cacheHits(r.icons);
          setResults(r.icons);
          setTotal(r.total);
        })
        .catch(() => {
          if (requestSeq.current !== seq) return;
          setResults([]);
          setTotal(0);
        });
    }, 200);
    return () => clearTimeout(timer);
  }, [search, showPicker]);

  // Vorschau des aktuell gesetzten Werts auflösen.
  useEffect(() => {
    const name = value ? mdiName(value) : null;
    if (!name) {
      setValuePath(null);
      return;
    }
    const cached = pathCache.get(name);
    if (cached) {
      setValuePath(cached);
      return;
    }
    let cancelled = false;
    api
      .lookupIcons([name])
      .then((r) => {
        cacheHits(r.icons);
        if (!cancelled) setValuePath(r.icons[0]?.path ?? null);
      })
      .catch(() => {
        if (!cancelled) setValuePath(null);
      });
    return () => {
      cancelled = true;
    };
  }, [value]);

  const handleSelect = (name: string) => {
    onChange(`mdi:${name}`);
    setShowPicker(false);
    setSearch("");
  };

  const isRawSvg = value.trim().toLowerCase().startsWith("<svg");
  const searching = search.trim().length > 0;

  const curated = COMMON_ICONS.filter(
    (icon) => selectedCategory === "Alle" || icon.category === selectedCategory,
  ).map((icon) => {
    const name = icon.value.replace(/^mdi:/, "");
    return { name, label: icon.name, path: pathCache.get(name) };
  });

  const gridButton = (name: string, path: string | undefined, label: string) => (
    <button
      key={name}
      type="button"
      onClick={() => handleSelect(name)}
      className={`flex flex-col items-center gap-1 rounded-lg p-2 transition-colors ${
        mdiName(value) === name ? "bg-brand/20 text-brand" : "text-slate-300 hover:bg-white/10"
      }`}
      title={`mdi:${name}`}
    >
      {path ? (
        <IconPreview path={path} />
      ) : (
        <span className="h-6 w-6 rounded bg-white/5" />
      )}
      <span className="max-w-full truncate text-[10px] text-slate-500">{label}</span>
    </button>
  );

  return (
    <div className="relative">
      <div className="flex items-center gap-2">
        {/* Vorschau des aktuellen Werts */}
        <span
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-200"
          title={value ? value : "Kein Icon gesetzt"}
        >
          {valuePath ? (
            <IconPreview path={valuePath} className="h-5 w-5" />
          ) : isRawSvg ? (
            <span className="text-[9px] font-semibold text-slate-400">SVG</span>
          ) : (
            <span className="text-slate-600">–</span>
          )}
        </span>

        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? "z.B. mdi:home (leer = kein Icon)"}
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 outline-none ring-brand/50 transition-colors placeholder:text-slate-500 hover:border-white/20 focus:border-brand focus:ring-2"
        />
        <Button
          type="button"
          variant="subtle"
          onClick={() => setShowPicker(!showPicker)}
          className="shrink-0"
        >
          {showPicker ? "Schließen" : "Icon wählen"}
        </Button>
      </div>

      {showPicker && (
        <div className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-hidden rounded-xl border border-white/10 bg-slate-900 shadow-2xl">
          {/* Header */}
          <div className="border-b border-white/10 bg-white/[0.02] p-3">
            <div className="mb-2 flex gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Alle Material-Design-Icons durchsuchen…"
                autoFocus
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-slate-200 outline-none ring-brand/50 transition-colors placeholder:text-slate-500 focus:border-brand focus:ring-2"
              />
              <button
                type="button"
                onClick={() => {
                  onChange("");
                  setShowPicker(false);
                  setSearch("");
                }}
                className="shrink-0 rounded-lg bg-white/5 px-3 py-1.5 text-xs text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
                title="Icon entfernen — Button/Element zeigt garantiert kein SVG"
              >
                Kein Icon
              </button>
            </div>
            {!searching && (
              <div className="flex flex-wrap gap-1">
                {["Alle", ...ICON_CATEGORIES].map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`rounded px-2 py-1 text-xs transition-colors ${
                      selectedCategory === cat
                        ? "bg-brand/20 text-brand"
                        : "bg-white/5 text-slate-400 hover:bg-white/10"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Icon Grid */}
          <div className="max-h-64 overflow-y-auto p-2">
            {searching ? (
              results.length === 0 ? (
                <p className="p-4 text-center text-sm text-slate-500">Keine Icons gefunden</p>
              ) : (
                <>
                  <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                    {results.map((icon) => gridButton(icon.name, icon.path, icon.name))}
                  </div>
                  {total > results.length && (
                    <p className="p-2 text-center text-[11px] text-slate-500">
                      {results.length} von {total} Treffern — Suche verfeinern
                    </p>
                  )}
                </>
              )
            ) : (
              <div className="grid grid-cols-4 gap-1 sm:grid-cols-6">
                {curated.map((icon) => gridButton(icon.name, icon.path, icon.label))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
