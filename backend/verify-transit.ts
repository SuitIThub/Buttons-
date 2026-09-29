/**
 * Verifikation des Fahrplan-Szenentyps (Parser, Ansichten, QR) gegen
 * gespeicherte HAFAS-Antworten in test-fixtures/.
 * Ausführen: npx tsx verify-transit.ts
 */
import { readFileSync } from "node:fs";
import { parseHafasTime, parseStationBoard, parseTripSearch, type GvhClient } from "./src/transit/GvhClient.js";
import {
  buildTransitView,
  detailLines,
  hhmm,
  initialTransitState,
  lineChain,
  warningLines,
  displaySafe,
  overviewRows,
  TR_BTN,
} from "./src/transit/transitView.js";
import { gvhTripUrl, qrSvg } from "./src/transit/qr.js";
import { TransitController, mergeConnections } from "./src/device/TransitController.js";
import { TransitDirections, directionFromStops } from "./src/transit/directions.js";
import { normalizeTransitConfig, type Scene, type TransitConfig } from "./src/model.js";
import { compactForDevice, configPayloadBytes } from "./src/buttonplus/schema.js";

let pass = 0, fail = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }
}

const load = (f: string) => JSON.parse(readFileSync(`./test-fixtures/${f}`, "utf-8")).svcResL[0].res;

console.log("Zeiten");
check("HHMMSS (Sommerzeit) → 17:41:42Z", parseHafasTime("20260929", "194142")?.toISOString(), "2026-09-29T17:41:42.000Z");
check("Tages-Offset DDHHMMSS", parseHafasTime("20260929", "01002500")?.toISOString(), "2026-09-29T22:25:00.000Z");
check("Winterzeit (UTC+1)", parseHafasTime("20261215", "080000")?.toISOString(), "2026-12-15T07:00:00.000Z");
check("ungültig → null", parseHafasTime("20260929", "abc"), null);
check("hhmm in Berlin-Zeit", hhmm(new Date("2026-09-29T17:41:42Z")), "19:41");

console.log("StationBoard");
const deps = parseStationBoard(load("hafas-stationboard.json"));
check("12 Abfahrten", deps.length, 12);
check("erste Abfahrt: Linie 5 Stöcken", [deps[0].line, deps[0].direction], ["5", "Stöcken"]);
check("Verspätung +4 min (19:41 → 19:45:18)", deps[0].delay, 4);

console.log("TripSearch");
const trip = parseTripSearch(load("hafas-tripsearch.json"));
check("3 Verbindungen", trip.connections.length, 3);
check("ctxScr vorhanden", [!!trip.ctxLater, !!trip.ctxEarlier], [true, true]);
const [c0, c1] = trip.connections;
check("Kette mit Umstieg", lineChain(c0), "1 > 470");
check("Kette mit Fußweg + SEV", lineChain(c1), "Fußweg > S4 > SEV");
check("Umstiege", [c0.changes, c1.changes], [1, 1]);
check("c0 ohne Meldungen", c0.severity, "none");
check("c1: 2 HIM-Meldungen (dedupliziert)", c1.messages.length, 2);
check("c1: Sperrung → Störung", c1.severity, "disruption");
check("Halte inkl. Start/Ziel", c0.legs[0].stops.length, 27);
const dl = detailLines(c0);
check("Detail: Umstiegszeit 3 min", dl.some((l) => l.trim() === "Umstieg 3 min"), true);
check("Detail: Kopf der ersten Fahrt", dl[0].startsWith("1 -> Langenhagen"), true);
check("Detail: Fußweg-Zeile bei c1", detailLines(c1)[0].startsWith("Fußweg 9 min"), true);
check("Meldungen beginnen mit STÖRUNG", warningLines(c1)[0].startsWith("STÖRUNG: S4, S5"), true);

console.log("Ansichten");
const route = { id: "r1", name: "Flughafen", from: { lid: "de:03241:1471", name: "Laatzen (Hannover), Eichstraße" }, to: { lid: "de:03241:4111", name: "Langenhagen (Han), Flughafen" } };
const cfg: TransitConfig = normalizeTransitConfig({ station: { lid: "de:03241:11", name: "Hannover, Kröpcke" }, routes: [route] });
check("normalize: 6 Slots", cfg.routes.length, 6);

const st = initialTransitState();
st.departures = deps;
st.routeStatus[0] = "disruption";
let v = buildTransitView(cfg, st);
check("Übersicht: Titel = Haltestelle ohne Stadt", v.title, "Kröpcke");
check("Übersicht: B2 = Routenname, rot", [v.buttons[2].label, v.buttons[2].led], ["Flughafen", "#ff0000"]);
st.routeStatus[0] = "delay";
check("Verspätung = orange (nicht gelb wie Hinweise)", buildTransitView(cfg, st).buttons[2].led, "#ff6000");
st.routeStatus[0] = "disruption";
check("Übersicht: leerer Slot B3 aus", v.buttons[3], { label: "", icon: "", led: null });
check("Übersicht: 8 Zeilen (über der Gerätezeile)", v.body.split("\n").length, 8);
check("Übersicht: Zeitspalte links", v.body.split("\n")[0], "19:41 +4");
check("Übersicht: Linie + Ziel rechts, gleich viele Zeilen", [v.col2!.split("\n").length, v.col2!.split("\n")[0].startsWith("5 ")], [8, true]);

st.view = "list";
st.connections = trip.connections;
st.ctxLater = trip.ctxLater;
v = buildTransitView(cfg, st);
check("Liste: 3 Verbindungen à 2 Zeilen + Leerzeilen", v.body.split("\n").length, 8);
check("Liste: Cursor auf erster", v.body.startsWith(">"), true);
check("Liste: B2 (hoch) am Anfang aus", v.buttons[TR_BTN.up].led, null);
check("Liste: B3 (runter) aktiv", v.buttons[TR_BTN.down].icon, "mdi:chevron-down");
check("Liste: B6 bei c0 aus", v.buttons[TR_BTN.warn].icon, "");
st.cursor = 1;
v = buildTransitView(cfg, st);
check("Liste: B6 bei c1 = Störung", [v.buttons[TR_BTN.warn].icon, v.buttons[TR_BTN.warn].led], ["mdi:alert-octagon", "#ff0000"]);
check("Liste: B7 = Übersicht", v.buttons[TR_BTN.home].label, "Übersicht");

st.view = "detail";
st.selectedKey = c1.key;
v = buildTransitView(cfg, st);
check("Detail: max. 8 Zeilen", v.body.split("\n").length <= 8, true);
check("Detail: B4 = Zurück", v.buttons[TR_BTN.select].label, "Zurück");

console.log("Richtungen (stadteinwärts/-auswärts)");
{
  const stop = (lid: string, lat: number, lon: number) => ({ lid, name: lid, coord: { lat, lon } });
  // Bothmerstraße (Süden) → Richtung Kröpcke (Norden) = einwärts.
  const route = [stop("de:03241:1401:1:1", 52.33, 9.77), stop("de:03241:1391:6:1392", 52.3332, 9.7730), stop("de:03241:1381:1:1", 52.337, 9.768)];
  check("nächster Halt näher am Zentrum → einwärts", directionFromStops(route, "de:03241:1391:6:1392"), "in");
  check("umgekehrte Fahrt → auswärts", directionFromStops([...route].reverse(), "de:03241:1391:1:1393"), "out");
  check("Endhalt → unbestimmt", directionFromStops(route.slice(0, 2), "de:03241:1391:6:1392"), null);
  check("Kröpcke gilt als Zentrum", TransitDirections.isCentral({ lat: 52.3745, lon: 9.7386 }), true);
  check("Bothmerstraße nicht Zentrum", TransitDirections.isCentral({ lat: 52.3332, lon: 9.773 }), false);
  const dirDeps = deps.map((d, i) => ({ ...d, cityDir: (i % 3 === 0 ? "out" : "in") as "in" | "out" }));
  const rows = overviewRows(dirDeps);
  check("Blöcke: 2 Überschriften + 2×3 Abfahrten", [rows.length, rows[0].heading, rows[4].heading], [8, "Stadteinwärts", "Stadtauswärts"]);
  check("Blöcke sortenrein", rows.filter((r) => r.dep).map((r) => r.dep!.cityDir).join(""), "inininoutoutout");
  const onlyIn = overviewRows(dirDeps.filter((d) => d.cityDir === "in"));
  check("leerer Block zeigt Hinweis", onlyIn[onlyIn.length - 1].heading, "  keine Abfahrten");
  check("ohne Richtungen gemischte Liste", overviewRows(deps).every((r) => r.dep), true);
}

console.log("Blättern");
const merged = mergeConnections(trip.connections.slice(0, 2), trip.connections.slice(1));
check("merge dedupliziert per key", merged.length, 3);

console.log("QR");
const url = gvhTripUrl(route.from, route.to, c0.depPlanned);
check("URL enthält SID/ZID/Zeit", /SID=de:03241:1471&ZID=de:03241:4111&date=29.09.2026&time=20:11/.test(url), true);
const svg = qrSvg(url);
check("SVG-Root nur mit viewBox", /^<svg viewBox="0 0 \d+ \d+">/.test(svg), true);
check("nur gefüllte Shapes", !/stroke|xmlns|width="\d+" height="\d+"><\/svg/.test(svg.replace(/<rect[^>]*>/, "")), true);
console.log(`  ℹ️  URL ${url.length} Zeichen, SVG ${svg.length} B`);

console.log("Zustandsmaschine (TransitController)");
{
  // Fixture-Zeiten so verschieben, dass die erste Verbindung in 10 min fährt.
  const shiftDates = <T>(obj: T, ms: number): T =>
    JSON.parse(JSON.stringify(obj), (_k, v) =>
      typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(new Date(v).getTime() + ms) : v,
    );
  const delta = Date.now() + 10 * 60_000 - trip.connections[0].depPlanned.getTime();
  const base = shiftDates(trip.connections, delta);
  // Zweite „Seite“ (ctxScr): dieselben Verbindungen 1 h später, neue Keys.
  const later = shiftDates(trip.connections, delta + 3600_000).map((c) => ({ ...c, key: `${c.key}-later` }));
  let tripCalls = 0;
  const fake = {
    async trips(_f: string, _t: string, o: { ctxScr?: unknown } = {}) {
      tripCalls++;
      return o.ctxScr === "later"
        ? { connections: later, ctxLater: null, ctxEarlier: null }
        : { connections: base, ctxLater: "later", ctxEarlier: null };
    },
    async journeyStops() {
      return [];
    },
    async departures() {
      return shiftDates(deps, Date.now() + 60_000 - deps[0].planned.getTime());
    },
  };
  let renders = 0;
  const ctl = new TransitController(fake as unknown as GvhClient, () => renders++);
  const scene = { id: "s1", name: "Fahrplan", category: "transit", display: [], buttons: [], groups: [], triggers: [], transit: cfg, createdAt: 0, updatedAt: 0 } as Scene;
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const press = async (id: number) => { ctl.handleButton(scene, id, "click"); await tick(); };

  ctl.enter(scene);
  await tick();
  check("enter → Übersicht mit Abfahrten", ctl.view(scene).body.split("\n").length > 3, true);
  check("Routen-LED gesetzt (Störung in c1 zählt nicht, c0 frei)", ctl.view(scene).buttons[2].led !== null, true);
  await press(3);
  check("leerer Slot B3 → bleibt Übersicht", ctl.view(scene).buttons[TR_BTN.home].label, "");
  await press(2);
  let v = ctl.view(scene);
  check("B2 → Liste der Route", v.title.startsWith("Laatzen"), true);
  check("Liste: B3 aktiv (ctxLater)", v.buttons[TR_BTN.down].icon, "mdi:chevron-down");
  await press(TR_BTN.down);
  await press(TR_BTN.down);
  check("B3 zweimal → Cursor unten", ctl.view(scene).body.split("\n")[6].startsWith(">"), true);
  await press(TR_BTN.down);
  v = ctl.view(scene);
  check("B3 am Ende → nächste 3 per ctxScr", [v.footer.startsWith("Verbindung 4-6"), v.body.startsWith(">")], [true, true]);
  await press(TR_BTN.up);
  check("B2 am Seitenanfang → vorherige 3, Cursor unten", ctl.view(scene).footer.startsWith("Verbindung 1-3"), true);
  await press(TR_BTN.up);
  v = ctl.view(scene);
  check("Cursor auf c1 → B6 Störung", v.buttons[TR_BTN.warn].icon, "mdi:alert-octagon");
  await press(TR_BTN.warn);
  check("B6 → Meldungen", ctl.view(scene).title, "Meldungen (2)");
  await press(TR_BTN.select);
  check("B4 in Meldungen → zurück zur Liste", ctl.view(scene).buttons[TR_BTN.select].label, "Öffnen");
  await press(TR_BTN.select);
  v = ctl.view(scene);
  check("B4 → Detail", v.buttons[TR_BTN.select].label, "Zurück");
  await press(TR_BTN.down);
  check("B3 im Detail scrollt (bis zum Ende begrenzt)", /Zeile 6-13 von 13/.test(ctl.view(scene).footer), true);
  await press(TR_BTN.warn);
  await press(TR_BTN.select);
  check("Meldungen aus Detail → zurück ins Detail", ctl.view(scene).footer.includes("Zeile"), true);
  await press(TR_BTN.select);
  await press(TR_BTN.qr);
  v = ctl.view(scene);
  check("B5 → QR-Ansicht, zu großes SVG wird nicht gesendet", [v.qr, v.body.startsWith("QR-Code ist zu groß")], ["", true]);
  await press(TR_BTN.qr);
  check("B5 im QR → zurück, QR leer", ctl.view(scene).qr, "");
  await press(TR_BTN.home);
  v = ctl.view(scene);
  check("B7 → Übersicht", [v.title, v.buttons[2].label], ["Kröpcke", "Flughafen"]);
  check("Renders ausgelöst", renders > 5, true);
  check("TripSearch-Aufrufe begrenzt", tripCalls <= 4, true);
  ctl.stop();
}

console.log("Display-Zeichensatz");
check("typografische Zeichen → ASCII", displaySafe("A – B „x“ … » é·"), 'A - B "x" ... " e|');
check("Umlaute/ß bleiben", displaySafe("Fußweg Öffnen"), "Fußweg Öffnen");
check("unbekannte Zeichen fallen weg", displaySafe("Bus \u{1F68C}!"), "Bus !");

console.log("Config-Verkleinerung");
{
  const raw = {
    buttons: [{ buttonid: "3-1", label: "", toplabel: "", svg: "", longdelay: 40, topics: [{ brokerid: "b", topic: "t", payload: "", eventtype: 11 }] }],
    displayitems: [{ displayitemid: "0", label: "", unit: "", topics: [{ brokerid: "b", topic: "u", payload: "x", eventtype: 17 }] }],
  };
  const compact = compactForDevice(raw) as typeof raw;
  check("leere Felder entfernt, toplabel bleibt ohne Toplabel-Topic", Object.keys(compact.buttons[0]), ["buttonid", "toplabel", "longdelay", "topics"]);
  const withTl = compactForDevice({ buttons: [{ toplabel: "", topics: [{ topic: "x/button/8/toplabel/set" }] }] }) as { buttons: Record<string, unknown>[] };
  check("toplabel:'' entfällt mit Toplabel-Topic", "toplabel" in withTl.buttons[0], false);
  check("payload:'' entfernt", "payload" in compact.buttons[0].topics[0], false);
  check("nicht-leere payload bleibt", compact.displayitems[0].topics[0].payload, "x");
  check("Eingabe unverändert", raw.buttons[0].label, "");
  check("Bytes zählen UTF-8", configPayloadBytes({ a: "ü" }), 10);
}

console.log(`\n${pass} ✅  ${fail} ❌`);
if (fail > 0) process.exit(1);
