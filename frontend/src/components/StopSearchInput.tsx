import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { TransitStop } from "../lib/types";
import { Button, Input } from "./ui";

interface Props {
  value: TransitStop | null;
  onChange: (stop: TransitStop | null) => void;
  placeholder?: string;
}

/**
 * Haltestellen-Suchfeld (GVH/HAFAS): Tippen → Trefferliste → Auswahl.
 * Eine gewählte Haltestelle erscheint als Chip mit „Ändern“.
 */
export function StopSearchInput({ value, onChange, placeholder = "Haltestelle suchen…" }: Props) {
  const [editing, setEditing] = useState(!value);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TransitStop[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!editing || q.length < 2) {
      setResults([]);
      setError(null);
      return;
    }
    const id = ++reqId.current;
    const timer = setTimeout(() => {
      setLoading(true);
      api
        .searchStops(q)
        .then((stops) => {
          if (id !== reqId.current) return;
          setResults(stops);
          setError(stops.length ? null : "Keine Haltestelle gefunden.");
        })
        .catch((e: Error) => id === reqId.current && setError(e.message))
        .finally(() => id === reqId.current && setLoading(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [query, editing]);

  if (value && !editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-3 py-1.5">
        <span className="flex-1 truncate text-sm text-slate-100" title={value.lid}>
          {value.name}
        </span>
        <Button
          variant="subtle"
          onClick={() => {
            setQuery("");
            setEditing(true);
          }}
        >
          Ändern
        </Button>
      </div>
    );
  }

  const pick = (stop: TransitStop) => {
    onChange(stop);
    setEditing(false);
    setQuery("");
    setResults([]);
  };

  return (
    <div className="relative">
      <div className="flex gap-2">
        <Input
          autoFocus={!!value}
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) pick(results[0]);
            if (e.key === "Escape" && value) setEditing(false);
          }}
        />
        {value && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Abbrechen
          </Button>
        )}
      </div>
      {(results.length > 0 || loading || error) && query.trim().length >= 2 && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-white/10 bg-slate-900 shadow-xl">
          {loading && results.length === 0 && <div className="px-3 py-2 text-xs text-slate-400">Suche…</div>}
          {error && !loading && <div className="px-3 py-2 text-xs text-amber-300">{error}</div>}
          {results.map((s) => (
            <button
              key={s.lid}
              type="button"
              onClick={() => pick(s)}
              className="block w-full px-3 py-1.5 text-left text-sm text-slate-200 hover:bg-white/10"
            >
              {s.name}
              <span className="ml-2 text-xs text-slate-500">{s.lid}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
