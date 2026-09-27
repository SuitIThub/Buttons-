/**
 * Verifikation gegen MQTT-TOPICS-REFERENCE.md (Single Source of Truth).
 * Prüft DeviceService-Topics/Payloads, Event-Parsing und DeviceConfigBuilder.
 * Ausführen: npx tsx verify-fixes.ts
 */
import { readFileSync } from "node:fs";
import { DeviceService } from "./src/device/DeviceService.js";
import { deployFingerprint, DeviceConfigBuilder } from "./src/device/DeviceConfigBuilder.js";
import type { BPConfig } from "./src/buttonplus/types.js";
import type { Page, Scene } from "./src/model.js";
import {
  isInLedDimWindow,
  isLedDimActive,
  ledBrightnessScale,
  msUntilNextLedDimChange,
  normalizeLedDim,
} from "./src/ledDim.js";

let pass = 0;
let fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}\n       expected: ${e}\n       actual:   ${a}`); }
}

// --- Fake MQTT ---
interface Pub { topic: string; payload: string; retain: boolean; }
class FakeMqtt {
  pubs: Pub[] = [];
  publishRaw(topic: string, payload: string, retain = false) { this.pubs.push({ topic, payload, retain }); return true; }
  getStatus() { return { connected: true, url: "", error: null }; }
  last(n: number) { return this.pubs.slice(-n); }
  reset() { this.pubs = []; }
}

const mqtt = new FakeMqtt();
const svc = new DeviceService(mqtt as any, { baseTopic: "buttonplus", deviceId: "btn_9182a0", firmwareV2: true });

console.log("\n=== DeviceService: LED (Button 2 = Position 3, Page 0 = devicePage 1) ===");
mqtt.reset();
svc.setButtonColor(2, 0, "#FF0000");
check("rgb topic+decimal", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/rgb/set", payload: "16711680", retain: true });
check("brightness 255", mqtt.pubs[1], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/brightness/set", payload: "255", retain: true });
check("on = 'true'", mqtt.pubs[2], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/on/set", payload: "true", retain: true });

console.log("\n=== DeviceService: LED brightness scale (Nachtmodus) ===");
mqtt.reset();
svc.resetPublishCache();
svc.setLedBrightnessScale(0.2);
svc.setButtonColor(2, 0, "#FF0000");
check("rgb 20% → 0x330000", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/rgb/set", payload: "3342336", retain: true });
check("brightness 20% → 51", mqtt.pubs[1], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/brightness/set", payload: "51", retain: true });
check("on erneut 'true'", mqtt.pubs[2], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/on/set", payload: "true", retain: true });
svc.setLedBrightnessScale(1);
svc.resetPublishCache();
mqtt.reset();
svc.setButtonColor(2, 0, "#FF0000");
check("scale 1 → rgb voll", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/rgb/set", payload: "16711680", retain: true });
check("scale 1 → brightness 255", mqtt.pubs[1], { topic: "buttonplus/btn_9182a0/button/3-1/led/front/brightness/set", payload: "255", retain: true });

console.log("\n=== DeviceService: LED off (both sides) ===");
mqtt.reset();
svc.ledOff(2, 0);
check("front off = 'false'", mqtt.pubs.find(p => p.topic.includes("/front/on/set")), { topic: "buttonplus/btn_9182a0/button/3-1/led/front/on/set", payload: "false", retain: true });
check("wall off = 'false'", mqtt.pubs.find(p => p.topic.includes("/wall/on/set")), { topic: "buttonplus/btn_9182a0/button/3-1/led/wall/on/set", payload: "false", retain: true });

console.log("\n=== DeviceService: Button label (NO page suffix), nav button 0 = position 1 ===");
mqtt.reset();
svc.updateButton(0, { label: "◀" });
check("label topic", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/button/1/label/set", payload: "◀", retain: true });

console.log("\n=== DeviceService: Button-SVG (seitenspezifisch + Alt-Topic-Cleanup) ===");
mqtt.reset();
const svgTiny = '<svg viewBox="0 0 24 24"><path fill="white" d="M1,1"/></svg>';
svc.setButtonSvg(2, 0, svgTiny);
check("Alt-Topic (ohne Seite) wird geleert", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/button/3/svg/set", payload: "", retain: true });
check("SVG geht auf seitenspezifisches Topic", mqtt.pubs[1], { topic: "buttonplus/btn_9182a0/button/3-1/svg/set", payload: svgTiny, retain: true });
mqtt.reset();
svc.setButtonSvg(2, 0, "");
check("leerer String löscht das Icon (garantiert kein SVG)", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/button/3-1/svg/set", payload: "", retain: true });

console.log("\n=== DeviceService: Display item ===");
mqtt.reset();
svc.updateDisplay(0, { label: "Temperature", value: "23.5", unit: "°C" });
check("display label", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/displayitem/0/label/set", payload: "Temperature", retain: true });
check("display value", mqtt.pubs[1], { topic: "buttonplus/btn_9182a0/displayitem/0/value/set", payload: "23.5", retain: true });
check("display unit", mqtt.pubs[2], { topic: "buttonplus/btn_9182a0/displayitem/0/unit/set", payload: "°C", retain: true });

console.log("\n=== DeviceService: Page set (0-based -> device 1-based) ===");
mqtt.reset();
svc.setPage(1);
check("page/set = 2", mqtt.pubs[0], { topic: "buttonplus/btn_9182a0/page/set", payload: "2", retain: false });

console.log("\n=== DeviceConfigBuilder: heal + navButtons from real device config ===");
const raw = JSON.parse(readFileSync("./data/_cfg.json", "utf-8")).config as BPConfig;
const pages: Page[] = [
  { id: "p1", name: "S1", order: 0, sceneId: "s1" },
  { id: "p2", name: "S2", order: 1, sceneId: "s2" },
];
const scenes: Scene[] = [
  { id: "s1", name: "S1", category: "custom", display: [
      { id: "e1", x: 10, y: 12, width: 80, fontSize: 3, align: 0, color: "#fff", label: "L", value: "{v}", round: 0 },
    ], buttons: [], groups: [], triggers: [], createdAt: 0, updatedAt: 0 },
  { id: "s2", name: "S2", category: "custom", display: [
      { id: "e2", x: 10, y: 12, width: 80, fontSize: 3, align: 0, color: "#fff", label: "L2", value: "", round: 0 },
    ], buttons: [], groups: [], triggers: [], createdAt: 0, updatedAt: 0 },
];
const out = DeviceConfigBuilder.build({ baseConfig: raw, pages, scenes, baseTopic: "buttonplus" });
check("firmwareV2", out.firmwareV2, true);
check("buttonCount (4 connectors * 2)", out.buttonCount, 8);
check("navButtons 0-based {0,1}", out.navButtons, { prev: 0, next: 1 });
// Buttons sind seitenspezifisch: alle Positionen müssen auf JEDER Seite existieren,
// sonst feuert das Gerät auf Seiten >= 2 keine pushbutton-Events (Navigation hängt fest).
const positions = out.config.mqttbuttons.map(b => b.position);
check("positions 1..8 auf jeder Seite", positions, [1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8]);
const buttonids = out.config.mqttbuttons.map(b => b.buttonid);
check("buttonids '{pos}-{page}' für Seiten 1+2", buttonids,
  ["1-1","2-1","3-1","4-1","5-1","6-1","7-1","8-1","1-2","2-2","3-2","4-2","5-2","6-2","7-2","8-2"]);
const buttonPages = out.config.mqttbuttons.map(b => b.page);
check("page-Feld je Button", buttonPages, [1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2]);
const allHaveLeds = out.config.mqttbuttons.every(b =>
  b.leds?.length === 2 && b.leds[0].frontwall === "front" && b.leds[1].frontwall === "wall");
check("all buttons have front+wall LEDs", allHaveLeds, true);
// SVG ist Laufzeit-Sache: Die Config darf keine (alten) Icons konservieren.
check("Config-Buttons ohne Phantom-SVG", out.config.mqttbuttons.every(b => (b.svg ?? "") === ""), true);
check("display items across pages", out.config.mqttdisplays.map(d => d.displayitemid), ["0", "1"]);
check("display item pages (1-based)", out.config.mqttdisplays.map(d => d.page), [1, 2]);

console.log("\n=== deployFingerprint: nur Geräte-Layout fordert Deploy ===");
{
  const fpOf = (patch: (s: Scene[]) => void) => {
    const next = structuredClone(scenes);
    patch(next);
    return deployFingerprint(DeviceConfigBuilder.build({ baseConfig: raw, pages, scenes: next, baseTopic: "buttonplus" }));
  };
  const withButton = fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Licht", ledColor: "#00ff00" }];
  });
  check("Button-Text und LED ändern den Fingerprint nicht", fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Anders", ledColor: "#ff0000" }];
  }), withButton);
  check("Event-Gruppe ändert den Fingerprint nicht", fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Licht", ledColor: "#00ff00" }];
    s[0].groups = [{ id: "g", name: "G", commands: [] }];
  }), withButton);
  check("Display-Text ändert den Fingerprint nicht", fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Licht", ledColor: "#00ff00" }];
    s[0].display[0].label = "Neu";
    s[0].display[0].value = "x";
  }), withButton);
  check("Display-Position fordert Deploy", fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Licht", ledColor: "#00ff00" }];
    s[0].display[0].x = 40;
  }) !== withButton, true);
  check("neuer Button fordert Deploy", fpOf((s) => {
    s[0].buttons = [
      { buttonId: 2, label: "Licht", ledColor: "#00ff00" },
      { buttonId: 4, label: "Extra" },
    ];
  }) !== withButton, true);
  check("Trigger an bestehendem Button fordert kein Deploy", fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Licht", ledColor: "#00ff00" }];
    s[0].triggers = [{ id: "t", type: "button", buttonId: 2, press: "long_press", groupId: "andere", condition: "x" }];
  }), withButton);
  check("Trigger an neuem Button fordert Deploy", fpOf((s) => {
    s[0].buttons = [{ buttonId: 2, label: "Licht", ledColor: "#00ff00" }];
    s[0].triggers = [{ id: "t", type: "button", buttonId: 5, press: "click", groupId: "g" }];
  }) !== withButton, true);
}

console.log("\n=== IconResolver: mdi -> SVG Tiny 1.2, raw SVG sanitize ===");
const { resolveIcon } = await import("./src/device/IconResolver.js");
check("mdi:skip-next → SVG mit viewBox+fill", resolveIcon("mdi:skip-next")?.startsWith('<svg viewBox="0 0 24 24"><path fill="white" d="'), true);
check("bare 'arrow-left' auflösbar", typeof resolveIcon("arrow-left"), "string");
check("unbekanntes mdi → undefined (kein Müll)", resolveIcon("mdi:dieses-icon-gibt-es-nicht"), undefined);
check("leer → undefined", resolveIcon(""), undefined);
const rawSvg = resolveIcon('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path fill="red" d="M1,1"/></svg>');
check("rohes SVG: xmlns/width/height entfernt", rawSvg, '<svg viewBox="0 0 24 24"><path fill="red" d="M1,1"/></svg>');

console.log("\n=== IconCatalog: Suche & Lookup (Basis des Icon-Pickers) ===");
const { searchIcons, lookupIcons } = await import("./src/device/IconResolver.js");
const searchResult = searchIcons("skip-next", 10);
check("searchIcons findet 'skip-next'", searchResult.icons.some(i => i.name === "skip-next"), true);
check("Präfix-Treffer stehen vorn", searchResult.icons[0]?.name.startsWith("skip-next"), true);
check("Treffer haben SVG-Paths", searchResult.icons.every(i => i.path.length > 0), true);
const looked = lookupIcons(["mdi:home", "dieses-icon-gibt-es-nicht"]);
check("lookupIcons löst 'mdi:home', unbekannte fallen weg", looked.length === 1 && looked[0].name === "home" && looked[0].path.length > 0, true);
// Garantie: Jeder Katalog-Name ist über resolveIcon auflösbar (gleiche Quelle).
const sample = searchIcons("weather", 25).icons;
check("Katalog-Namen sind resolveIcon-auflösbar (Roundtrip)", sample.every(i => typeof resolveIcon(`mdi:${i.name}`) === "string"), true);

console.log("\n=== flattenJson (httpRequest-Aktion) ===");
const { flattenJson } = await import("./src/engine/flatten.js");
check("Beispiel aus Anforderung", flattenJson({ key1: "val1", key2: { key3: "val2" } }),
  { key1: "val1", "key2/key3": "val2" });
check("tiefe Schachtelung", flattenJson({ a: { b: { c: 1 } } }), { "a/b/c": 1 });
check("Arrays: Index-Keys plus length und list", flattenJson({ list: [7, 8] }),
  { "list/0": 7, "list/1": 8, "list/length": 2, "list/list": [7, 8] });
check("null → leerer String", flattenJson({ a: null }), { a: "" });
check("primitive Wurzel → 'value'", flattenJson(42), { value: 42 });
check("gemischte Typen bleiben erhalten", flattenJson({ n: 1.5, b: true, s: "x" }), { n: 1.5, b: true, s: "x" });

console.log("\n=== DeviceService: Publish-Deduplizierung ===");
{
  const m = new FakeMqtt();
  const d = new DeviceService(m as any, { baseTopic: "buttonplus", deviceId: "btn_9182a0", firmwareV2: true });

  m.reset();
  d.updateDisplay(0, { label: "A" });
  check("erster Publish sendet", m.pubs.length, 1);

  m.reset();
  d.updateDisplay(0, { label: "A" });
  check("unveränderter Wert wird übersprungen", m.pubs.length, 0);

  m.reset();
  d.updateDisplay(0, { label: "B" });
  check("geänderter Wert wird gesendet", m.pubs.length, 1);

  m.reset();
  d.resetPublishCache();
  d.updateDisplay(0, { label: "B" });
  check("nach resetPublishCache erneut gesendet", m.pubs.length, 1);

  m.reset();
  d.setPage(0);
  d.setPage(0);
  check("nicht-retained page/set wird NICHT dedupliziert", m.pubs.length, 2);
}

console.log("\n=== LED-Dimmung: Zeitfenster ===");
{
  const dim = normalizeLedDim({
    enabled: true,
    brightnessPercent: 20,
    timeZone: "UTC",
    windows: [{ start: "22:00", end: "06:00" }, { start: "12:00", end: "13:00" }],
  });
  check("Overnight 23:00 aktiv", isInLedDimWindow(23 * 60, "22:00", "06:00"), true);
  check("Overnight 05:59 aktiv", isInLedDimWindow(5 * 60 + 59, "22:00", "06:00"), true);
  check("Overnight 06:00 inaktiv", isInLedDimWindow(6 * 60, "22:00", "06:00"), false);
  check("Overnight 12:00 inaktiv", isInLedDimWindow(12 * 60, "22:00", "06:00"), false);
  check("Mittag 12:30 aktiv", isInLedDimWindow(12 * 60 + 30, "12:00", "13:00"), true);
  check("identische Zeiten inaktiv", isInLedDimWindow(12 * 60, "12:00", "12:00"), false);
  check("HH:MM:SS parsebar", isInLedDimWindow(18 * 60, "18:00:00", "22:00:00"), true);

  const noon = new Date(Date.UTC(2026, 0, 1, 12, 30, 0));
  const evening = new Date(Date.UTC(2026, 0, 1, 23, 0, 0));
  const morning = new Date(Date.UTC(2026, 0, 1, 8, 0, 0));
  check("aktiv mittags (zweites Fenster)", isLedDimActive(dim, noon), true);
  check("aktiv nachts", isLedDimActive(dim, evening), true);
  check("inaktiv vormittags", isLedDimActive(dim, morning), false);
  check("Skala nachts 0.2", ledBrightnessScale(dim, evening), 0.2);
  check("Skala tags 1", ledBrightnessScale(dim, morning), 1);

  const disabled = normalizeLedDim({ ...dim, enabled: false });
  check("deaktiviert → Skala 1", ledBrightnessScale(disabled, evening), 1);

  const until = msUntilNextLedDimChange(dim, new Date(Date.UTC(2026, 0, 1, 21, 59, 30)));
  check("nächster Wechsel in 30s", until, 30_000);

  const berlin = normalizeLedDim({
    enabled: true,
    brightnessPercent: 20,
    timeZone: "Europe/Berlin",
    windows: [{ start: "18:00", end: "22:00" }],
  });
  // Winter: UTC+1 → 17:00Z = 18:00 Berlin. Sommer: UTC+2 → 16:00Z = 18:00 Berlin.
  check("Berlin 18–22 aktiv 17:00 UTC Winter", isLedDimActive(berlin, new Date("2026-01-15T17:30:00Z")), true);
  check("Berlin 18–22 inaktiv 16:00 UTC Winter", isLedDimActive(berlin, new Date("2026-01-15T16:30:00Z")), false);
  check("Berlin 18–22 aktiv 16:30 UTC Sommer (Prod-Fall)", isLedDimActive(berlin, new Date("2026-07-15T16:30:00Z")), true);
}

console.log(`\n=== Result: ${pass} passed, ${fail} failed ===`);
process.exit(fail === 0 ? 0 : 1);
