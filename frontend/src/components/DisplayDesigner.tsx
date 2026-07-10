import { useRef, useState } from "react";
import { DisplayElement, VarValue } from "../lib/types";
import { Button, Field, Input, Select } from "./ui";
import { ALIGN_OPTIONS, FONT_PX, FONT_SIZES, alignToAnchorTransform, alignToCss } from "../lib/uiConstants";
import { previewFormatValue, previewInterpolate } from "../lib/interp";
import { IconPicker } from "./IconPicker";
import { uid } from "../lib/uid";

interface Props {
  elements: DisplayElement[];
  onChange: (elements: DisplayElement[]) => void;
  runtimeVars: Record<string, VarValue>;
}

/** Button+ Großdisplay – ungefähres Seitenverhältnis für die Vorschau. */
const CANVAS_W = 400;
const CANVAS_H = 280;
/** Statusleiste oben (core.statusbar) – Anteil der Displayhöhe. */
const STATUS_BAR_H = 0.1;

function pctInputValue(n: number): string | number {
  return Number.isFinite(n) ? n : "";
}

function parsePct(raw: string, fallback = 0): number {
  if (raw.trim() === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10) / 10)) : fallback;
}

function elementSummary(el: DisplayElement): string {
  const parts = [el.label, el.value].filter(Boolean);
  return parts.length ? parts.join(" / ") : "(leer)";
}

/** Umbruch-Markierungen (\n, <br>) für die Vorschau in echte Zeilenumbrüche. */
function withLineBreaks(text: string): string {
  return (text ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/\\n/g, "\n");
}

export function DisplayDesigner({ elements, onChange, runtimeVars }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const selected = elements.find((e) => e.id === selectedId) ?? null;

  const update = (id: string, patch: Partial<DisplayElement>) =>
    onChange(elements.map((e) => (e.id === id ? { ...e, ...patch } : e)));

  const addElement = () => {
    const el: DisplayElement = {
      id: uid(),
      x: 10,
      y: 12,
      width: 80,
      fontSize: 3,
      align: 0,
      color: "#ffffff",
      label: "Label",
      value: "{VariableName}",
      svg: "",
      unit: "",
      boxtype: 0,
    };
    onChange([...elements, el]);
    setSelectedId(el.id);
  };

  const removeElement = (id: string) => {
    onChange(elements.filter((e) => e.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const onPointerDown = (e: React.PointerEvent, el: DisplayElement) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    e.preventDefault();
    setSelectedId(el.id);
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    drag.current = { id: el.id, dx: px - el.x, dy: py - el.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = ((e.clientX - rect.left) / rect.width) * 100;
    const py = ((e.clientY - rect.top) / rect.height) * 100;
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n * 10) / 10));
    update(drag.current.id, { x: clamp(px - drag.current.dx), y: clamp(py - drag.current.dy) });
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
      {/* Vorschau */}
      <div className="flex shrink-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="subtle" onClick={addElement}>
            + Anzeige
          </Button>
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-400">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Live-Vorschau
          </label>
        </div>

        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
          className="relative touch-none select-none overflow-hidden rounded-xl border border-white/15 bg-black"
          style={{ width: CANVAS_W, height: CANVAS_H, maxWidth: "100%" }}
        >
          <div
            className="pointer-events-none absolute inset-x-0 top-0 border-b border-white/10 bg-white/[0.04]"
            style={{ height: `${STATUS_BAR_H * 100}%` }}
            title="Statusleiste (Gerät)"
          />
          {elements.map((el) => {
            const css = alignToCss(el.align);
            const labelText = withLineBreaks(live ? previewInterpolate(el.label, runtimeVars) : el.label);
            const valueText = withLineBreaks(live
              ? previewFormatValue(el.value, runtimeVars)
              : el.value);
            const unitText = live && el.unit ? previewInterpolate(el.unit, runtimeVars) : el.unit;
            return (
              <div
                key={el.id}
                onPointerDown={(e) => onPointerDown(e, el)}
                className={`absolute flex cursor-move flex-col overflow-hidden leading-tight ${
                  selectedId === el.id ? "outline outline-1 outline-brand" : ""
                }`}
                style={{
                  left: `${el.x}%`,
                  top: `${el.y}%`,
                  width: `${el.width}%`,
                  color: el.color,
                  fontSize: FONT_PX[el.fontSize] ?? 16,
                  transform: alignToAnchorTransform(el.align),
                  justifyContent: css.justifyContent,
                  alignItems: css.alignItems,
                  textAlign: css.textAlign,
                }}
              >
                {labelText ? (
                  <span className="w-full whitespace-pre-line break-words text-[0.55em] opacity-80">{labelText}</span>
                ) : null}
                {labelText && valueText ? (
                  <span
                    className="my-0.5 h-px w-full shrink-0 opacity-60"
                    style={{ backgroundColor: el.color }}
                  />
                ) : null}
                {valueText || unitText ? (
                  <span className="w-full whitespace-pre-line break-words">
                    {valueText || " "}
                    {unitText ? ` ${unitText}` : ""}
                  </span>
                ) : null}
              </div>
            );
          })}
          {elements.length === 0 && (
            <div className="grid h-full place-items-center px-4 text-center text-xs text-slate-600">
              Anzeige über „+ Anzeige“ hinzufügen
            </div>
          )}
        </div>

        <p className="max-w-[400px] text-xs leading-relaxed text-slate-500">
          Jedes Element entspricht einem Button+-Displayblock: kleines Label oben, großer Wert darunter.
          X/Y in % wie auf dem Gerät. Beide Felder unterstützen <code className="text-slate-400">{"{Variable}"}</code>.
        </p>
      </div>

      {/* Eigenschaften + Liste */}
      <div className="flex min-w-0 flex-1 flex-col gap-3 xl:max-w-md">
        {elements.length > 0 && (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="mb-2 text-xs font-medium text-slate-400">Elemente</p>
            <div className="flex max-h-36 flex-col gap-1 overflow-y-auto">
              {elements.map((el) => (
                <button
                  key={el.id}
                  type="button"
                  onClick={() => setSelectedId(el.id)}
                  className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                    selectedId === el.id ? "bg-brand/20 text-brand" : "hover:bg-white/5 text-slate-300"
                  }`}
                >
                  <span className="truncate">{elementSummary(el)}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-500">
                    {el.x}%, {el.y}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {selected ? (
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-slate-200">Anzeige-Element</span>
              <Button variant="danger" onClick={() => removeElement(selected.id)}>
                Löschen
              </Button>
            </div>

            <div className="flex flex-col gap-3">
              <Field label="Label (kleine Überschrift)">
                <Input
                  value={selected.label}
                  onChange={(e) => update(selected.id, { label: e.target.value })}
                  placeholder="z. B. Temperatur oder Test {var0} -"
                />
              </Field>

              <Field label="Wert (große Anzeige)">
                <Input
                  value={selected.value}
                  onChange={(e) => update(selected.id, { value: e.target.value })}
                  placeholder="z. B. {TestVal}"
                />
              </Field>

              <p className="-mt-1 text-[11px] text-slate-500">
                Zeilenumbruch in Label/Wert: <code>\n</code> oder <code>&lt;br&gt;</code> einfügen.
              </p>

              <Field label="SVG-Icon (optional)">
                <IconPicker
                  value={selected.svg ?? ""}
                  onChange={(val) => update(selected.id, { svg: val })}
                  placeholder="z. B. mdi:thumb-up oder {iconVar}"
                />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <Field label="X %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    className="min-w-0 tabular-nums"
                    value={pctInputValue(selected.x)}
                    onChange={(e) => update(selected.id, { x: parsePct(e.target.value, selected.x) })}
                  />
                </Field>
                <Field label="Y %">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    className="min-w-0 tabular-nums"
                    value={pctInputValue(selected.y)}
                    onChange={(e) => update(selected.id, { y: parsePct(e.target.value, selected.y) })}
                  />
                </Field>
                <Field label="Breite %">
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    step={0.1}
                    className="min-w-0 tabular-nums"
                    value={pctInputValue(selected.width)}
                    onChange={(e) => update(selected.id, { width: parsePct(e.target.value, selected.width) })}
                  />
                </Field>
              </div>

              <Field label="Schriftgröße">
                <Select
                  value={selected.fontSize}
                  onChange={(e) => update(selected.id, { fontSize: Number(e.target.value) })}
                >
                  {FONT_SIZES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Ausrichtung">
                <Select
                  value={selected.align}
                  onChange={(e) => update(selected.id, { align: Number(e.target.value) })}
                >
                  {ALIGN_OPTIONS.map((a) => (
                    <option key={a.value} value={a.value}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Farbe">
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => update(selected.id, { color: e.target.value })}
                    className="h-9 w-full cursor-pointer rounded-lg border border-white/10 bg-black/30"
                  />
                </Field>
                <Field label="Einheit">
                  <Input
                    value={selected.unit ?? ""}
                    onChange={(e) => update(selected.id, { unit: e.target.value })}
                    placeholder="optional, z. B. °C"
                  />
                </Field>
              </div>

              <Field label="Box-Stil">
                <Select
                  value={selected.boxtype ?? 0}
                  onChange={(e) => update(selected.id, { boxtype: Number(e.target.value) })}
                >
                  <option value={0}>Mit Unterstrich</option>
                  <option value={1}>Ohne Unterstrich</option>
                </Select>
              </Field>
            </div>
          </div>
        ) : (
          <div className="grid place-items-center rounded-xl border border-dashed border-white/10 p-8 text-center text-sm text-slate-500">
            Element in der Liste oder auf der Vorschau auswählen
          </div>
        )}
      </div>
    </div>
  );
}
