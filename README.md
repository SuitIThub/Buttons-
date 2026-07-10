# Button+ Automations-Manager

Ein selbst gehostetes Management-Programm für **Button+ V2** Geräte (Display-Modul + Button-Module).
Aus dem reinen Live-Steuertool ist eine kleine **Automations-Plattform** geworden: Du definierst
**Seiten**, **Szenen**, **Variablen** und **Logik/Events** – der Manager übersetzt das automatisch in
die Gerätekonfiguration und **alle MQTT-Topics**. Du musst dich **nie** mit MQTT befassen.

Gedacht für den Betrieb auf einem **Ubuntu-Heimserver** (Docker), bedienbar im Browser aus dem Heimnetz.

---

## Was das Programm kann

- **Seiten** anlegen, umsortieren und jeder Seite eine **Szene** zuweisen (Kategorie „Custom“).
- **Feste Navigation**: Die zwei Buttons des Display-Moduls blättern automatisch vor/zurück. Ihre
  Front-LED ist **grün**, wenn es in die Richtung eine Seite gibt, sonst **rot** (Wrap-Around optional).
- **Drag-and-Drop Display-Designer**: Text-/Wert-Elemente auf einer %-Canvas platzieren, mit
  Schriftgröße, Ausrichtung, Farbe und `{ausdruck}`-Interpolation. Optionale Live-Vorschau.
- **Globale Variablen** (`string`, `int`, `bool`, `list`, `dict`) mit typisiertem Anfangswert.
- **Events & Aktionen** pro Button: Bei Klick/langem Druck Variablen setzen/erhöhen/umschalten,
  Listen/Dicts verändern, navigieren oder `Wenn/Sonst`-Zweige ausführen – alles mit Ausdrücken.
- **Ausdruckssprache** für Bedingungen, Interpolation und LED-Farben (siehe unten).
- **Deploy per Klick**: Modell → Gerätekonfiguration → aufs Gerät geschrieben, Runtime aktiviert.
- **Live-Zustand**: aktuelle Seite und Variablenwerte kommen per WebSocket in die Oberfläche zurück.

---

## Ausdruckssprache (kurz)

Überall wo `{…}` oder ein „Ausdruck“ steht, gilt:

- Variablen direkt per Name: `count`, `name`, `licht.wohnzimmer`
- System-Variablen (nur lesen): `$page`, `$pageIndex`, `$pageCount`, `$pageName`
- Operatoren: `+ - * / %`, Vergleiche, `&& || !`, Ternär `a ? b : c`
- Funktionen: `len, round, floor, ceil, abs, min, max, upper, lower, str, int, num, bool, not,
  contains, get, join, keys`

Beispiele:

- Display-Inhalt: `Temp: {round(temp, 1)}°C` oder `Aktiv: {count} / {$pageCount}`
- Button-Label: `{on ? 'AN' : 'AUS'}`
- LED-Farbe: `on ? '#00ff00' : '#ff0000'` (oder einfach `#00aaff`)
- Event-Bedingung: `count < 10`

---

## Wichtig: Was mit den Displays geht (und was nicht)

Mit der **Original-Firmware (1.12+)**:

- ✅ Frei platzierbare **Text-/Wert-Anzeigen** (Position in %, Schriftgröße, Ausrichtung, Farbe).
- ✅ Werte kommen **live über MQTT** – der Manager füttert sie automatisch aus der Interpolation.
- ✅ **Button-Mini-Displays**: Label + Top-Label + LED-Farbe.
- ❌ **Eigene Bilder/Icons/Grafiken** sind mit der Original-Firmware **nicht** möglich.

Echte Grafik-Programmierung geht nur mit der alternativen **ESPHome-Firmware**
([dixi83/ESPhome_ButtonPlus](https://github.com/dixi83/ESPhome_ButtonPlus)) – dafür müsstest du das
Gerät flashen und verlörst die Original-Oberfläche. Dieser Manager setzt bewusst auf die
Original-Firmware.

---

## Wie es funktioniert (Architektur)

```
Browser (React UI)
   │  REST + WebSocket
   ▼
Backend (Node/TypeScript)
   ├─ Store         store.json: pages, scenes, variables, nav, settings
   ├─ Compiler      Modell → BPConfig (Buttons, Display-Items, Core-Topics)
   ├─ Runtime       Klicks → Events → Variablen → Bindings → Publizieren
   │
   ├──HTTP──►  Button+ Gerät  (GET /config, POST /configsave)
   └──MQTT──►  dein MQTT-Broker  ◄──MQTT──  Button+ Gerät
```

**Kernidee:** Der Nutzer sieht nie ein Topic. `Deploy` übersetzt das Modell in eine `BPConfig` mit
deterministischen Topicnamen und pusht sie aufs Gerät. Die **Runtime** abonniert Klicks, führt Events
aus, mutiert Variablen, wertet Interpolation/Bindings aus und publiziert Display-Werte, Button-Labels
und LED-Farben. Struktur-Änderungen (Seiten, Display-Elemente) brauchen ein Deploy; Werte/Labels/LEDs
und Logik aktualisieren sich nach dem Speichern live.

---

## Einrichtung & Deployment auf dem Ubuntu-Server

Voraussetzung: Docker + Docker Compose Plugin.

```bash
git clone <dieses-repo> buttonplus-manager
cd buttonplus-manager
cp .env.example .env
nano .env          # Geräte-IP, MQTT-URL usw. (optional – geht auch im UI)
docker compose up -d --build
```

Danach im Browser: `http://<server-ip>:8080`

Die Daten liegen im Volume `./data` (`store.json`) und überleben Updates/Neustarts.

### Erststart-Ablauf im UI

1. **Einstellungen** → Geräte-IP und MQTT-Broker eintragen → *Speichern & Verbinden*.
2. *Konfig vom Gerät laden* – die Geräte-ID/Module werden automatisch übernommen.
3. Bei **Variablen** die benötigten Variablen anlegen.
4. Bei **Seiten** Seiten anlegen und je eine **Szene** zuweisen → *Konfigurieren* öffnet den
   Szenen-Editor (Display-Designer + Buttons/Logik).
5. Oben rechts **Deploy** klicken – fertig. Das Gerät läuft jetzt mit deiner Konfiguration.

---

## Entwicklung (lokal, ohne Docker)

```bash
# Terminal 1 – Backend (Port 8080)
cd backend && npm install && npm run dev

# Terminal 2 – Frontend (Port 5173, proxyt auf 8080)
cd frontend && npm install && npm run dev
```

UI: `http://localhost:5173` · Skripte: `npm run typecheck`, `npm run build` (beide Projekte).

---

## Projektstruktur

```
backend/src/
  model.ts            Domänenmodell (Page, Scene, DisplayElement, Action, VariableDef, …)
  store.ts            JSON-Persistenz + CRUD (pages, scenes, variables, nav, settings)
  device/             Aktive Geräte-Schicht (Clean Architecture)
    DeviceManager.ts       Orchestrierung, deploy(), pull/push, startRuntime()
    DeviceConfigBuilder.ts Modell → BPConfig (+ V2-Button-Heilung)
    AutomationRuntime.ts   Klicks/Events/Variablen/Navigation/Timer
    SceneRenderer.ts       Interpolation + Icon-Auflösung → Device
    DeviceService.ts       Topic-/Wert-Formate, 0↔1-Umrechnung, MQTT-Publish
    IconResolver.ts        mdi:* / rohes SVG → SVG Tiny 1.2 (@mdi/js)
  engine/
    expr.ts           Ausdrucks-Parser (jsep) + sicherer Evaluator + Interpolation
    variables.ts      typisierter Variablen-State + Mutations-Aktionen
  buttonplus/         Geräte-HTTP-Client, MQTT-Service, Schema-Dialekt, Konstanten, Typen
  server.ts           REST-Endpunkte + WebSocket
frontend/src/
  App.tsx             Tabs (Seiten, Variablen, Einstellungen) + Header/Deploy
  components/
    PagesView         Seitenliste, Reihenfolge, Szenen-Zuweisung
    SceneConfigurator Display-Designer + Buttons/Logik pro Szene
    DisplayDesigner   %-Canvas mit Drag-and-Drop
    ButtonsConfig     Button-Bindings + Events
    ActionEditor      rekursiver Aktions-Builder (inkl. Wenn/Sonst)
    VariablesEditor   typisierte Variablen
    SettingsPanel     Verbindung + Navigation + Deploy
```

---

## Migrationshinweis

Das Datenmodell wurde grundlegend erneuert (Schema 2). Beim ersten Start mit dieser Version werden
**alte Prototyp-Szenen automatisch verworfen**; die Verbindungseinstellungen bleiben erhalten. Lege
Seiten, Variablen und Szenen im neuen UI an und klicke anschließend **Deploy**.

## Bekannte Grenzen / Hinweise

- Button-Labels sind auf dem Gerät seiten-unabhängig, Button-LEDs dagegen seiten-spezifisch;
  beim Seitenwechsel republiziert die Runtime die Bindings der aktiven Seite.
- Die Display-Vorschau ist approximativ (Schriftgrößen) – das Gerät bleibt Referenz.
- Icons: `mdi:<name>` (z. B. `mdi:home`) oder rohes SVG werden automatisch in das vom Gerät
  benötigte SVG Tiny 1.2 übersetzt (`IconResolver`, `@mdi/js`).
