# Handoff: Button+ Automations-Manager

Stand: Juli 2026

> ## ✅ Update 2026-07-05 – Problem adressiert
>
> Dieses Dokument beschreibt den **historischen, ungelösten** Zustand vor der
> Kommunikations-Korrektur. Über verifizierte Prototyp-Tests wurden die echten
> V3-Firmware-Topics/Formate ermittelt (`backend/MQTT-TOPICS-REFERENCE.md`) und
> das Backend vollständig darauf ausgerichtet:
>
> - Korrekte Display-, Button-, LED- und Event-Topics/Formate.
> - Einheitliche Nummerierung (intern 0-basiert, Gerät 1-basiert).
> - Alter Compile-Pfad (`engine/compiler.ts`, `engine/runtime.ts`, `manager.ts`,
>   `displayBindings.ts`, `naming.ts`, `buttonplus/topics.ts`) **gelöscht** –
>   aktiv ist nur noch `backend/src/device/*`.
> - Verifikation via `cd backend && npm run verify`.
>
> Die untenstehenden Datei-Referenzen auf `engine/*` und `manager.ts` sind
> historisch und existieren nicht mehr. Aktuelle Architektur: `backend/ARCHITECTURE.md`.

---

## 1. Was gebaut ist

### Produktidee

Selbst gehosteter **Button+ Manager**: Nutzer konfiguriert Seiten, Szenen, Display-Elemente, Variablen und Button-Logik in einer Web-UI. Das Backend übersetzt das Modell in Gerätekonfiguration und MQTT-Publishes — der Nutzer soll **keine Topics manuell** pflegen müssen.

### Stack

| Schicht | Technologie |
|---------|-------------|
| Frontend | React, Vite, Tailwind — Port 5173 (Dev), Proxy auf Backend |
| Backend | Node.js, TypeScript, Express — Port 8080 |
| Persistenz | `backend/data/store.json` (Schema 2) |
| Gerät | HTTP `GET /config`, `POST /configsave` |
| Live-Steuerung | MQTT (Broker + Gerät) |

### Domänenmodell (`backend/src/model.ts`)

- **Seiten** (`Page`) — Reihenfolge, Verknüpfung zu einer Szene
- **Szenen** (`Scene`) — Display-Elemente, Button-Bindings, Event-Gruppen
- **Display-Elemente** — pro Item: `label` (kleine Überschrift) + `value` (große Anzeige), Position in %, Schriftgröße, Ausrichtung, Farbe; `{variablen}`-Interpolation
- **Variablen** — typisiert (`string`, `int`, `bool`, `list`, `dict`)
- **Aktionen/Events** — Klick, long press, Gruppen, Navigation, `if`, Variablen mutieren

### Pipeline

```
UI speichern → store.json
Deploy / Runtime (aktuell, backend/src/device/*):
  DeviceConfigBuilder   Modell → BPConfig (Buttons heilen, displayitems, core, brokers)
  DeviceManager         deploy(), startRuntime(), pullConfig/pushConfig
  AutomationRuntime     Events + Variablen → SceneRenderer
  SceneRenderer         interpolate + IconResolver → DeviceService
  DeviceService         Topic-/Wert-Formate + 0↔1-Umrechnung → mqttService.publishRaw
```

### UI-Tabs

- **Seiten** — Szenen zuweisen, Reihenfolge
- **Szenen** — Display-Designer, Buttons, Event-Gruppen
- **Variablen** — Definition + Live-Werte (WebSocket)
- **Einstellungen** — Geräte-IP, MQTT, Deploy, Config pull

### Weitere Features (implementiert, teils ungetestet am Gerät)

- Event-Gruppen (`page_enter`, `page_leave`, manuell)
- Navigation über Display-Modul-Buttons (Prev/Next, LED grün/rot)
- Ausdruckssprache (`backend/src/engine/expr.ts`, jsep)
- Firmware-Dialekt V2 vs. Legacy (`backend/src/buttonplus/schema.ts`)
- Store-Sicherheit: kein blindes Überschreiben bei Start, Backup-Versuch, `.env`-Merge aus Repo-Root

---

## 2. Nutzerproblem (offen)

Der Nutzer betreibt ein **Button+ V2** mit Firmware **3.1.2-V2** im Heimnetz.

**Erwartung:** In der UI konfigurierte Display-Elemente zeigen auf dem großen Display:

- ein **Label** (z. B. `Test {var0} -`) mit eingesetzten Variablenwerten
- einen **Wert** (z. B. `{var0} 1`) als große Anzeige, ebenfalls interpoliert

**Ist-Zustand (Nutzer-Feedback, mehrfach bestätigt):**

- Der **Wert bleibt leer** (keine große Anzeige sichtbar).
- **Variablenwerte erscheinen nicht** — weder im Label noch im Wert.
- Auf dem Display steht typischerweise nur statischer Text wie **`Test  -`** (Platzhalter `{var0}` fehlt).
- Zusätzlich (früher im Verlauf): **Konfigurationen gingen verloren** (leere `store.json`, Szenen/MQTT mussten neu eingegeben werden) — dafür wurden Store-Fixes gebaut; ob das dauerhaft stabil ist, ist nicht abschließend verifiziert.

**Referenz-Szene im Store** (`backend/data/store.json`):

| Feld | Inhalt |
|------|--------|
| Gerät | `192.168.178.33`, ID `btn_9182a0` |
| MQTT | `mqtt://crenserver:1883` |
| Seite | „Szene 1“ → eine Szene |
| Display 1 | Label `Test {var0} -`, Wert `{var0} 1` |
| Display 2 | Label `Label`, Wert `{VariableName}` |
| Variable | `var0` initial `"42"`, `VariableName` initial `""` |

Die **Interpolation im Backend** (Preview/API) wurde als funktionsfähig angenommen; am **Gerät** ändert sich für den Nutzer nichts Sichtbares.

---

## 3. Was als Lösung versucht wurde (knapp)

Ohne Bewertung, ob die Ansätze korrekt oder ausreichend waren:

1. **Display-Datenmodell** von `type/content` auf getrennte Felder `label` + `value` umgestellt (Migration in `normalizeDisplayElement`).
2. **Compiler/Runtime-Anpassungen** für V2-Topics (`displayitem/N/label/set`, `value/set`), 0-basierte IDs, Seed-Payloads, statisches Label ohne `{…}` in der Gerätekonfiguration.
3. **MQTT-Broker** in Gerätekonfiguration ergänzen (`ensureBrokers`), Republish nach Deploy mit Verzögerung (500 ms / 2,5 s / 8 s).
4. **Store-Robustheit** — kein Persist bei jedem Start, Backup, Env-Merge, leere UI-Felder überschreiben keine Werte, Auto-Seite/Auto-Variable bei fehlenden Einträgen.
5. **V2-Split-Modell** — ein UI-Element → zwei Device-Display-Items (Label-Item + Wert-Item), Topic-Binding aus `displayitems[].topics[]` (`displayBindings.ts`).
6. **Runtime** — Label und Wert unabhängig publizieren; Seiten-Sync (`syncDevicePage`) nach Activate/Deploy.
7. **Auto-Deploy** beim Speichern von Szenen mit Display/Button-Änderungen (`deployOrRuntime` in `server.ts`).
8. Manueller **`configsave`** am Gerät (außerhalb des Managers) — kurzfristig ohne nachhaltige Wirkung für den Nutzer.

**Ergebnis:** Nutzer meldet, das Verhalten am Gerät sei **identisch zu vorher**.

---

## 4. Umgebung & Artefakte

### Starten (Entwicklung)

```bash
cd backend && npm install && npm run dev    # :8080
cd frontend && npm install && npm run dev   # :5173
```

Build: `npm run build` in `backend/` und `frontend/`.

Konfiguration: Repo-Root `.env` (siehe `.env.example`) — `BUTTONPLUS_DEVICE_IP`, `MQTT_URL`, `DATA_DIR=./data`.

### Nützliche API-Endpunkte

| Endpoint | Zweck |
|----------|--------|
| `GET /api/status` | MQTT verbunden?, Runtime, Gerät, Variablen-Snapshot |
| `GET /api/config` | Aktuelle Gerätekonfiguration im Manager-Cache |
| `POST /api/config/pull` | Config vom Gerät neu laden |
| `POST /api/deploy` | Modell → Gerät schreiben + Runtime |
| `POST /api/runtime/restart` | Runtime neu starten ohne Deploy |
| `POST /api/preview` | Interpolation testen (`{ "template": "Test {var0}" }`) |

### Referenz-Dateien im Repo (Geräte-Snapshots)

- `device-now.json` — zuletzt gespeicherter Config-Stand vom Gerät (Analyse-Zwecke)
- `device-live.json` — älterer Config-Stand zum Vergleich

Diese Dateien können veraltet sein; vor weiterer Arbeit **`POST /api/config/pull`** oder direkt `GET http://<device-ip>/config` ausführen.

### Wichtige Quellcode-Dateien für das Display-Problem

```
backend/src/device/DeviceConfigBuilder.ts  Display-Items + Button-Heilung erzeugen
backend/src/device/SceneRenderer.ts         Interpolation + Icon-Auflösung → Publish
backend/src/device/DeviceService.ts         Topic-/Wert-Formate, 0↔1-Umrechnung
backend/src/device/AutomationRuntime.ts     Events (pushbutton), Aktionen, Timer
backend/src/device/IconResolver.ts          mdi:* / rohes SVG → SVG Tiny 1.2
backend/src/device/DeviceManager.ts         deploy(), pullConfig/pushConfig, startRuntime()
backend/src/engine/expr.ts                  interpolate(), formatDisplayValue()
backend/src/buttonplus/mqttService.ts       publishRaw()
backend/src/buttonplus/brokers.ts           ensureBrokers()
backend/src/buttonplus/schema.ts            V2-Dialekt displayitems ↔ mqttdisplays
backend/src/store.ts                        Persistenz
frontend/src/components/DisplayDesigner.tsx
```

---

## 5. Was die nächste Person tun sollte

1. **Vom Nutzer ausgehen, nicht vom Code:** Am Gerät beobachten, was wirklich angezeigt wird; parallel MQTT am Broker mitsniffen (`buttonplus/btn_9182a0/#`) und prüfen, ob der Manager überhaupt publiziert und ob Payloads ankommen.
2. **Gerätekonfiguration nach Deploy lesen** und mit dem vergleichen, was `compiler.ts` erzeugt — unabhängig von bisherigen Annahmen.
3. **Interpolation isoliert testen:** `POST /api/preview`, Runtime-Variablen in `/api/status`, dann Publish manuell auf vermutete Topics (mosquitto_pub) — um Backend vs. Gerät vs. Broker zu trennen.
4. **Offizielle Button+ V2-Doku / Node-RED-Paket** (`backend/package/nodes/buttonplus-update-display.js`) als Referenz für das erwartete Display-Item-Modell heranziehen — der Manager soll dasselbe Verhalten abbilden.
5. **Store-Datenverlust** im Auge behalten: `backend/data/store.json.bak` prüfen, bevor am Store weiter experimentiert wird.

---

## 6. Bekannte offene Punkte (ohne Root-Cause-Behauptung)

- Display-Wert und Variablen-Interpolation am Gerät **ungelöst**.
- Ob Deploy tatsächlich ausgeführt wird / ob das Gerät die gepushte Config übernimmt — **vom Nutzer nicht bestätigt**.
- Ob Frontend-Build im laufenden Dev-Setup die neuesten Backend-Änderungen nutzt — prüfen (Backend-Neustart nach `npm run build`).
- README verspricht `{ausdruck}`-Interpolation auf Display Label **und** Wert — das entspricht nicht dem Nutzer-Erlebnis.
- Button-MQTT-Pfade (Legacy `button/0/label` vs. V2 `/set`-Pfade) wurden weniger intensiv geprüft als Display.

---

## 7. Gesprächsverlauf

Ausführlicher Chat-Verlauf (inkl. früherer Fix-Versuche):  
Agent-Transcript `5c3bbbda-4f12-461c-937b-edc44b7de385` im Cursor-Projektordner `agent-transcripts/`.

---

*Dieses Dokument beschreibt den Projektstand und das offene Nutzerproblem. Es enthält bewusst keine detaillierte Fehleranalyse — die bisherigen Diagnosen haben das Problem am Gerät nicht behoben.*
