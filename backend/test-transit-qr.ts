/**
 * Geräte-Test: Wie groß rendert die Firmware ein QR-SVG auf dem Hauptdisplay?
 *
 * Publiziert einen QR-Code (GVH-Beispiellink) auf `displayitem/{id}/svg/set`.
 * Die Item-ID des Elements „tr-qr“ steht nach einem Deploy einer Fahrplan-Szene
 * im Backend-Log bzw. in den Display-Mappings; ohne Deploy geht jedes Item.
 *
 * Ausführen:  npx tsx test-transit-qr.ts <displayItemId> [url|clear]
 * MQTT-Zugang und Geräte-ID kommen aus data/store.json (settings).
 */
import { readFileSync } from "node:fs";
import mqtt from "mqtt";
import { gvhTripUrl, qrSvg } from "./src/transit/qr.js";

const [, , idArg, urlArg] = process.argv;
if (!idArg || !/^\d+$/.test(idArg)) {
  console.error("Aufruf: npx tsx test-transit-qr.ts <displayItemId> [url|clear]");
  process.exit(1);
}

const { settings } = JSON.parse(readFileSync("./data/store.json", "utf-8")) as {
  settings: { mqttUrl: string; mqttUsername: string; mqttPassword: string; baseTopic: string; deviceId: string };
};

const svg =
  urlArg === "clear"
    ? ""
    : qrSvg(
        urlArg ||
          gvhTripUrl(
            { lid: "de:03241:1471", name: "Laatzen Eichstraße" },
            { lid: "de:03241:4111", name: "Flughafen" },
            new Date(),
          ),
      );
const topic = `${settings.baseTopic || "buttonplus"}/${settings.deviceId}/displayitem/${idArg}/svg/set`;

const client = mqtt.connect(settings.mqttUrl, {
  username: settings.mqttUsername || undefined,
  password: settings.mqttPassword || undefined,
});
client.on("connect", () => {
  console.log(`→ ${topic} (${svg.length} B)`);
  client.publish(topic, svg, { retain: true }, (err) => {
    if (err) console.error(err.message);
    else console.log(svg ? "QR gesendet – Größe/Lesbarkeit am Gerät prüfen und mit dem Handy scannen." : "SVG geleert.");
    client.end();
  });
});
client.on("error", (err) => {
  console.error(`MQTT: ${err.message}`);
  client.end();
  process.exit(1);
});
