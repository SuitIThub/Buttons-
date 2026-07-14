/**
 * Verifikation des Trigger/Timeline-Modells der AutomationRuntime.
 * Ausführen: npx tsx verify-runtime.ts
 */
import { readFileSync } from "node:fs";
import { DeviceService } from "./src/device/DeviceService.js";
import { SceneRenderer } from "./src/device/SceneRenderer.js";
import { AutomationRuntime } from "./src/device/AutomationRuntime.js";
import { DeviceConfigBuilder } from "./src/device/DeviceConfigBuilder.js";
import { VariableState } from "./src/engine/variables.js";
import { DEFAULT_NAV, type Command, type Page, type Scene, type Trigger, type VariableDef } from "./src/model.js";
import type { BPConfig } from "./src/buttonplus/types.js";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}
const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
let uid = 0;
const cmd = (c: Partial<Command>): Command => ({ id: `c${uid++}`, type: "label", ...c } as Command);
const trig = (t: Partial<Trigger>): Trigger => ({ id: `t${uid++}`, type: "startup", groupId: "", ...t } as Trigger);

class FakeMqtt {
  count = 0;
  pubs: { topic: string; payload: string }[] = [];
  publishRaw(topic: string, payload: string) { this.count++; this.pubs.push({ topic, payload }); return true; }
  getStatus() { return { connected: true, url: "", error: null }; }
  setExtraSubscriptions() {}
  reset() { this.count = 0; this.pubs = []; }
  last(suffix: string): string | undefined {
    for (let i = this.pubs.length - 1; i >= 0; i--) if (this.pubs[i].topic.endsWith(suffix)) return this.pubs[i].payload;
    return undefined;
  }
}

const raw = JSON.parse(readFileSync("./data/_cfg.json", "utf-8")).config as BPConfig;

const variables: VariableDef[] = [
  { name: "c", type: "int", initial: 0 },
  { name: "sum", type: "int", initial: 0 },
  { name: "i", type: "int", initial: 0 },
  { name: "sum2", type: "int", initial: 0 },
  { name: "it", type: "int", initial: 0 },
  { name: "nums", type: "list", initial: [10, 20, 30] },
  { name: "data", type: "dict", initial: {} },
  { name: "p", type: "int", initial: 0 },
  { name: "r", type: "int", initial: 0 },
  { name: "wetter", type: "dict", initial: { temp: 5, "main/humidity": 80 } },
  { name: "out", type: "string", initial: "" },
  { name: "out2", type: "string", initial: "" },
  // Quelle mit gemischten Werttypen + Ziele je Typ (für Typ-Kompatibilität).
  { name: "mixed", type: "dict", initial: { lst: ["a", "b"], obj: { k: 1 }, num: 7, str: "hi" } },
  { name: "tLst", type: "list", initial: [] },
  { name: "tStr", type: "string", initial: "" },
  { name: "tInt", type: "int", initial: 0 },
  { name: "tNum", type: "int", initial: 0 },
  { name: "tDict", type: "dict", initial: {} },
];

// dictGet-Befehle mit festen Referenzen (für Ergebnis-Checks).
const dgOk = cmd({ type: "dictGet", target: "out", from: "wetter", key: "temp" });
const dgMiss = cmd({ type: "dictGet", target: "out2", from: "wetter", key: "temperatur" });
// Typ-Kombinationen: Liste→Liste (nativ), Liste→String (String-Form), Liste→Int (blockiert),
// Dict→Dict (nativ), Zahl→Int (nativ).
const dgListNative = cmd({ type: "dictGet", target: "tLst", from: "mixed", key: "lst" });
const dgListStr = cmd({ type: "dictGet", target: "tStr", from: "mixed", key: "lst" });
const dgListBlock = cmd({ type: "dictGet", target: "tInt", from: "mixed", key: "lst" });
const dgDictNative = cmd({ type: "dictGet", target: "tDict", from: "mixed", key: "obj" });
const dgNumNative = cmd({ type: "dictGet", target: "tNum", from: "mixed", key: "num" });

const scenes: Scene[] = [
  {
    id: "s1", name: "Page1", category: "custom",
    display: [{ id: "e1", x: 10, y: 12, width: 80, fontSize: 3, align: 0, color: "#fff", label: "L", value: "{c}", round: 0 }],
    buttons: [],
    triggers: [
      // Button 2 (0-based) = physische Position 3, Klick → Gruppe „inc"
      trig({ type: "button", buttonId: 2, press: "click", groupId: "g-inc" }),
    ],
    groups: [
      { id: "g-inc", name: "inc", commands: [cmd({ type: "incVar", variable: "c" })] },
      { id: "g-repeat", name: "repeat", commands: [
        cmd({ type: "setVar", variable: "sum", expression: "0" }),
        cmd({ type: "repeat", count: "3" }),
        cmd({ type: "incVar", variable: "sum" }),
        cmd({ type: "endrepeat" }),
      ] },
      { id: "g-while", name: "while", commands: [
        cmd({ type: "setVar", variable: "i", expression: "0" }),
        cmd({ type: "while", condition: "i < 10" }),
        cmd({ type: "incVar", variable: "i" }),
        cmd({ type: "if", condition: "i >= 3" }),
        cmd({ type: "break" }),
        cmd({ type: "endif" }),
        cmd({ type: "endwhile" }),
      ] },
      { id: "g-foreach", name: "foreach", commands: [
        cmd({ type: "setVar", variable: "sum2", expression: "0" }),
        cmd({ type: "forEach", listVar: "nums", itemVar: "it" }),
        cmd({ type: "setVar", variable: "sum2", expression: "sum2 + it" }),
        cmd({ type: "endforeach" }),
      ] },
      { id: "g-if", name: "if", commands: [
        cmd({ type: "if", condition: "c > 100" }),
        cmd({ type: "setVar", variable: "r", expression: "1" }),
        cmd({ type: "else" }),
        cmd({ type: "setVar", variable: "r", expression: "2" }),
        cmd({ type: "endif" }),
      ] },
      { id: "g-return", name: "return", commands: [
        cmd({ type: "setVar", variable: "r", expression: "1" }),
        cmd({ type: "return" }),
        cmd({ type: "setVar", variable: "r", expression: "2" }),
      ] },
      { id: "g-override", name: "override", commands: [
        cmd({ type: "setDisplay", elementId: "e1", props: { value: "OVERRIDE" } }),
        cmd({ type: "setButton", buttonId: 3, props: { label: "Neu" } }),
      ] },
      { id: "g-pause", name: "pause", commands: [
        cmd({ type: "setVar", variable: "p", expression: "1" }),
        cmd({ type: "pause", durationMs: "40" }),
        cmd({ type: "setVar", variable: "p", expression: "2" }),
      ] },
      { id: "g-http", name: "http", commands: [
        cmd({ type: "httpRequest", method: "GET", url: "http://test.local/api?c={c}", variable: "data" }),
      ] },
      { id: "g-dict", name: "dict", commands: [dgOk, dgMiss] },
      { id: "g-dicttypes", name: "dicttypes", commands: [dgListNative, dgListStr, dgListBlock, dgDictNative, dgNumNative] },
    ],
    createdAt: 0, updatedAt: 0,
  },
  {
    id: "s2", name: "Page2", category: "custom",
    display: [{ id: "e2", x: 10, y: 12, width: 80, fontSize: 3, align: 0, color: "#fff", label: "L2", value: "", round: 0 }],
    buttons: [], triggers: [], groups: [], createdAt: 0, updatedAt: 0,
  },
];
const pages: Page[] = [
  { id: "p1", name: "Page1", order: 0, sceneId: "s1" },
  { id: "p2", name: "Page2", order: 1, sceneId: "s2" },
];

const out = DeviceConfigBuilder.build({ baseConfig: raw, pages, scenes, baseTopic: "buttonplus" });
const mqtt = new FakeMqtt();
const device = new DeviceService(mqtt as any, { baseTopic: "buttonplus", deviceId: "btn_9182a0", firmwareV2: true });
const vars = new VariableState();
vars.reset(variables);
const renderer = new SceneRenderer(device, () => vars.scope());
const runtime = new AutomationRuntime(device, renderer, vars);
runtime.activate(out, scenes, DEFAULT_NAV);

const T = (pos: number, page: number) => `buttonplus/btn_9182a0/button/${pos}-${page}/pushbutton`;
const press = JSON.stringify({ event_type: "shortpress" });

async function main() {
  console.log("\n=== Button-Trigger → Gruppe ===");
  check("startet auf Seite 0", runtime.getState().currentPage, 0);
  runtime.handleMessage(T(3, 1), press);
  await flush();
  check("Button-Trigger führt Gruppe aus (c=1)", vars.get("c"), 1);

  runtime.handleMessage(T(3, 1), JSON.stringify({ event_type: "click" }));
  await flush();
  check("Zwischen-Event ignoriert (c=1)", vars.get("c"), 1);

  console.log("\n=== Navigation (fest verdrahtet) ===");
  runtime.handleMessage(T(2, 1), press); await flush();
  check("Nav NEXT → Seite 1", runtime.getState().currentPage, 1);
  runtime.handleMessage(T(1, 2), press); await flush();
  check("Nav PREV → Seite 0", runtime.getState().currentPage, 0);

  console.log("\n=== Timeline-Steuerfluss ===");
  runtime.runGroupById("s1", "g-repeat"); await flush();
  check("repeat 3× → sum=3", vars.get("sum"), 3);

  runtime.runGroupById("s1", "g-while"); await flush();
  check("while + break bei i>=3 → i=3", vars.get("i"), 3);

  runtime.runGroupById("s1", "g-foreach"); await flush();
  check("forEach über [10,20,30] → sum2=60", vars.get("sum2"), 60);

  runtime.runGroupById("s1", "g-if"); await flush();
  check("if/else (c<=100) → r=2", vars.get("r"), 2);

  runtime.runGroupById("s1", "g-return"); await flush();
  check("return bricht Timeline ab → r=1", vars.get("r"), 1);

  console.log("\n=== setDisplay/setButton-Overrides ===");
  mqtt.reset();
  runtime.runGroupById("s1", "g-override"); await flush();
  check("Display-Wert überschrieben", mqtt.last("displayitem/0/value/set"), "OVERRIDE");
  check("Button 3 (Pos 4) Label gesetzt", mqtt.last("button/4/label/set"), "Neu");

  console.log("\n=== pause (asynchrone Timeline) ===");
  runtime.runGroupById("s1", "g-pause");
  await flush(10);
  check("vor Ablauf der Pause: p=1", vars.get("p"), 1);
  await flush(60);
  check("nach Pause: p=2", vars.get("p"), 2);

  console.log("\n=== httpRequest → geflattetes dict ===");
  {
    const origFetch = globalThis.fetch;
    let requested: string | null = null;
    globalThis.fetch = (async (url: unknown) => {
      requested = String(url);
      return new Response(JSON.stringify({ key1: "val1", key2: { key3: "val2" } }), { status: 200 });
    }) as typeof fetch;
    try {
      runtime.runGroupById("s1", "g-http");
      await flush(60);
    } finally {
      globalThis.fetch = origFetch;
    }
    check("URL interpoliert", requested, `http://test.local/api?c=${vars.get("c")}`);
    check("Antwort geflattened", vars.get("data"), { key1: "val1", "key2/key3": "val2" });
  }

  console.log("\n=== Befehls-Ergebnisse (UI-Feedback) ===");
  runtime.runGroupById("s1", "g-dict"); await flush();
  {
    const cr = runtime.getState().commandResults;
    check("dictGet (Treffer) → ok, füllt out", vars.get("out"), "5");
    check("dictGet (Treffer) Ergebnis-Status ok", cr[dgOk.id]?.status, "ok");
    check("dictGet (fehlender Schlüssel) → warn", cr[dgMiss.id]?.status, "warn");
    check("Warnung nennt vorhandene Schlüssel", /temp/.test(cr[dgMiss.id]?.message ?? ""), true);
  }

  console.log("\n=== dictGet: Typ-Kompatibilität der Ziele ===");
  runtime.runGroupById("s1", "g-dicttypes"); await flush();
  {
    const cr = runtime.getState().commandResults;
    check("Liste → Listen-Variable (nativ)", vars.get("tLst"), ["a", "b"]);
    check("Liste → Listen-Variable Status ok", cr[dgListNative.id]?.status, "ok");
    check("Liste → String-Variable (String-Form)", vars.get("tStr"), '["a","b"]');
    check("Liste → String-Variable Status ok", cr[dgListStr.id]?.status, "ok");
    check("Liste → Int-Variable blockiert (Wert unverändert 0)", vars.get("tInt"), 0);
    check("Liste → Int-Variable Status warn", cr[dgListBlock.id]?.status, "warn");
    check("Dict → Dict-Variable (nativ)", vars.get("tDict"), { k: 1 });
    check("Zahl → Int-Variable (nativ)", vars.get("tNum"), 7);
  }

  console.log("\n=== VariableState: resync erhält Werte, computed, enum ===");
  {
    const vs = new VariableState();
    vs.reset([{ name: "x", type: "int", initial: 0 }]);
    vs.set("x", 5);
    vs.resync([{ name: "x", type: "int", initial: 0 }, { name: "n", type: "int", initial: 9 }]);
    check("resync erhält Laufzeitwert x=5", vs.get("x"), 5);
    check("resync legt neue Variable n=9 an", vs.get("n"), 9);

    vs.reset([{ name: "a", type: "int", initial: 2 }, { name: "b", type: "int", initial: 3 }, { name: "y", type: "int", initial: 0, computed: "a + b" }]);
    check("computed y = a + b = 5", vs.scope().y, 5);
    vs.set("a", 10);
    check("computed folgt Änderung (a=10 → y=13)", vs.scope().y, 13);

    vs.reset([{ name: "clamped", type: "int", initial: 0, min: 0, max: 5 }]);
    vs.set("clamped", 99);
    check("int-Clamping auf max=5", vs.get("clamped"), 5);
    vs.set("clamped", -3);
    check("int-Clamping auf min=0", vs.get("clamped"), 0);
  }

  runtime.deactivate();
  console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
  process.exit(fail === 0 ? 0 : 1);
}
void main();
