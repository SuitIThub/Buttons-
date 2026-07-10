# Button+ Manager - Refactored Architecture v2.0

**Stand:** Juli 2026  
**Status:** ✅ Vollständig refactored mit sauberer Service-Architektur

---

## 🎯 Ziele des Refactorings

1. **Saubere Trennung:** Device-Kommunikation ↔ Business-Logic ↔ Datenmodell
2. **Universelle APIs:** Einheitliche Schnittstellen für alle Szenentypen
3. **Testbarkeit:** Jede Komponente einzeln testbar
4. **Erweiterbarkeit:** Neue Features ohne bestehenden Code zu brechen
5. **Klarheit:** Keine versteckten Abhängigkeiten oder Seiteneffekte

---

## 📐 Neue Architektur

```
┌─────────────────────────────────────────────────────────────┐
│                      REST API / WebSocket                   │
│                       (server.ts)                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                    DeviceManager                            │
│  • Orchestriert alle Services                               │
│  • Deploy-Workflow                                          │
│  • Store-Integration                                        │
└───┬──────────────┬──────────────┬──────────────┬───────────┘
    │              │              │              │
    │              │              │              │
    ▼              ▼              ▼              ▼
┌────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐
│ Device │  │  Scene   │  │Automation│  │ Config Builder │
│Service │  │ Renderer │  │ Runtime  │  │                │
└────────┘  └──────────┘  └──────────┘  └────────────────┘
    │              │              │              │
    │              │              │              │
    ▼              ▼              ▼              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MQTT Broker                            │
│                  Button+ V2 Device                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 🧩 Komponenten-Übersicht

### 1. **DeviceService** (`device/DeviceService.ts`)

**Verantwortlich für:** Alle MQTT-Publishing-Operationen

**Public API:**

```typescript
// Display-Items
updateDisplay(itemId: number, update: DisplayItemUpdate): void
clearDisplay(itemId: number): void

// Buttons (Labels/SVG, OHNE Seiten-Suffix)
updateButton(buttonId: number, update: ButtonUpdate): void
clearButton(buttonId: number): void

// LEDs (page-spezifisch, Seite "front"/"wall")
setLed(buttonId: number, pageIndex: number, side: LedSide, led: LedUpdate): void
setButtonColor(buttonId: number, pageIndex: number, color: string): void
ledOff(buttonId: number, pageIndex: number): void

// Navigation
setPage(pageIndex: number): void
setBrightness(brightness: number): void
```

**Wichtig – Nummerierungs-Konvention (Single Source of Truth: `MQTT-TOPICS-REFERENCE.md`):**
- Intern sind Buttons **0-basiert** (`buttonId` 0..N-1) und Seiten **0-basiert** (`pageIndex`).
- Das Gerät adressiert **1-basiert**: `position = buttonId + 1`, `devicePage = pageIndex + 1`.
- Diese Umrechnung passiert **ausschließlich** im DeviceService.
- **Button-Labels** sind seiten-unabhängig → `button/{pos}/label/set` (ohne Suffix).
- **Button-LEDs** sind page-spezifisch → `button/{pos}-{page}/led/{side}/…/set`,
  RGB dezimal, `on` = `"true"`/`"false"`, Brightness 0-255 (alle drei nötig).
- Topics werden **deterministisch** berechnet – keine Config-Abhängigkeit, leicht mockbar.

---

### 2. **SceneRenderer** (`device/SceneRenderer.ts`)

**Verantwortlich für:** Übersetzung Scene → Device-Kommandos

**Public API:**

```typescript
// Komplette Szene rendern
renderScene(scene: Scene, config: SceneRenderConfig): void

// Nur Display-Items rendern (für Live-Updates)
renderDisplayItems(scene: Scene, config: SceneRenderConfig): void

// Alles clearen
clearAll(config: SceneRenderConfig): void
```

**Was er macht:**
- Variablen interpolieren (`{var0}` → `"42"`)
- Ausdrücke evaluieren (`active ? '#00ff00' : '#ff0000'`)
- Display-Element → Display-Item-Mapping
- Icons auflösen via **IconResolver** (`mdi:home` / rohes SVG → SVG Tiny 1.2)
- Navigations-Buttons rendern (Label + LED-Feedback, prev/next)
- Verwendet **DeviceService** für Publishing (0-basierte IDs)

**Was er NICHT macht:**
- MQTT-Topics generieren (→ DeviceService)
- Events ausführen (→ Runtime)
- Config erstellen (→ ConfigBuilder)

---

### 3. **AutomationRuntime** (`device/AutomationRuntime.ts`)

**Verantwortlich für:** Event-Handling & Automations-Logic

**Public API:**

```typescript
// Lifecycle
activate(config: DeviceConfigOutput, scenes: Scene[], nav: NavSettings): void
deactivate(): void

// Rendering
render(): void
syncDevicePage(): void

// Event-Handling
handleMessage(topic: string, payload: string): void

// Status
getState(): RuntimeState
```

**Was er macht:**
- Button-Klicks verarbeiten
- Aktionen ausführen (`setVar`, `navigate`, `if`, ...)
- Seiten-Management
- Timer (Interval/Time-Trigger)
- Variable-Change-Tracking
- Verwendet **SceneRenderer** für Rendering

**Was er NICHT macht:**
- MQTT publizieren (→ DeviceService via SceneRenderer)
- Config erstellen (→ ConfigBuilder)
- Store verwalten (→ DeviceManager)

---

### 4. **DeviceConfigBuilder** (`device/DeviceConfigBuilder.ts`)

**Verantwortlich für:** Button+ Config-Generierung

**Public API:**

```typescript
static build(input: DeviceConfigInput): DeviceConfigOutput
```

**Input:**
- Base-Config vom Gerät
- Seiten & Szenen
- Variablen (optional)

**Output:**
- Modifizierte Device-Config (bereit für Push)
- Display-Mappings (UI-Element → Device-Item)
- Button-Count, Nav-Buttons, Firmware-Info

**Was er macht:**
- Display-Items in Config erstellen (label/value/unit-Topics)
- V2/V3-Button-Config **heilen**: Positionen 1..N, `buttonid "{pos}-1"`,
  je eine `front`- und `wall`-LED (repariert „verschmutzte" Gerätekonfig)
- Nav-Buttons ableiten (0-basiert: Display-Modul-Buttons)
- Core-Topics (Seiten-Switching)
- Display-Mappings für Runtime

**Was er NICHT macht:**
- Variablen interpolieren (→ SceneRenderer)
- MQTT publizieren (→ DeviceService)
- Runtime-Logic (→ AutomationRuntime)

---

### 5. **DeviceManager** (`device/DeviceManager.ts`)

**Verantwortlich für:** Orchestrierung aller Services

**Public API:**

```typescript
// Lifecycle
async init(): Promise<void>

// Config
async pullConfig(): Promise<BPConfig>
async pushConfig(config: BPConfig): Promise<string>
getConfig(): BPConfig | null

// Deploy
async deploy(): Promise<DeployResult>
startRuntime(): boolean
stopRuntime(): void

// Status
getRuntimeState(): RuntimeState
getMqttStatus(): MqttStatus
getCompiledOutput(): DeviceConfigOutput | null

// MQTT
reconnectMqtt(): void
```

**Deploy-Workflow:**

```
1. Compile:  Datenmodell → Device-Config
2. Push:     Config → Gerät
3. Wait:     Device stabilisieren (2s)
4. Verify:   Config vom Gerät lesen
5. Compile:  Neu kompilieren mit aktueller Config
6. Activate: Runtime mit finalem Plan starten
7. Render:   Initial-Rendering
```

---

## 🔄 Datenfluss

### Deploy-Flow

```
UI: "Save Scene + Deploy"
  ↓
DeviceManager.deploy()
  ↓
DeviceConfigBuilder.build()
  → BPConfig + DisplayMappings
  ↓
DeviceClient.pushConfig()
  → HTTP POST to Device
  ↓
[Wait 2s]
  ↓
DeviceClient.fetchConfig()
  → Verify Config
  ↓
AutomationRuntime.activate()
  ↓
SceneRenderer.renderScene()
  ↓
DeviceService.updateDisplay/Button/Led()
  ↓
MQTT Publish
  ↓
Button+ Device
```

### Runtime-Flow (Button-Klick)

```
Button+ Device: MQTT Publish
  ↓
MqttService: "message" Event
  ↓
AutomationRuntime.handleMessage()
  ↓
AutomationRuntime.handleButton()
  ↓
AutomationRuntime.runActions()
  → VariableState.set()
  ↓
VariableState: "change" Event
  ↓
AutomationRuntime.render()
  ↓
SceneRenderer.renderScene()   (rendert deklarativ die GANZE Szene)
  ↓
DeviceService.updateDisplay/Button/Led()
  ↓
[Publish-Deduplizierung: nur geänderte retained-Topics]
  ↓
MQTT Publish (nur Deltas)
  ↓
Button+ Device
```

### Publish-Deduplizierung (Performance)

Der `SceneRenderer` rendert bei jeder Interaktion bewusst die **komplette** Szene
(einfach, robust, keine verstreute Diff-Logik). Damit das Gerät nicht bei jedem
Klick ~40–50 identische retained-Nachrichten (Labels, SVGs, LEDs) verarbeiten
muss, dedupliziert der `DeviceService` auf **Publish-Ebene**: ein retained-Topic
wird nur gesendet, wenn sich sein Wert geändert hat.

- Ein typischer Zähler-Klick überträgt so **1 statt ~46** Nachrichten.
- **Abgrenzung zum früheren „Dirty-Tracking-Cache":** Das ist *kein* Szenen-Zustand,
  der Bugs verstecken kann – es ist eine transparente, rein am MQTT-Ausgang
  wirkende Deduplizierung (Topic → zuletzt gesendeter Wert).
- **Invalidierung:** `DeviceService.resetPublishCache()` wird bei Runtime-`activate()`
  (Deploy) und bei MQTT-Reconnect (mögliches Geräte-Reboot) aufgerufen, damit der
  volle Zustand neu geschrieben wird. Nicht-retained Befehle (`page/set`,
  `brightness/set`) werden nie dedupliziert.

---

## 🆚 Alt vs. Neu

### Alt (compiler.ts + runtime.ts)

```typescript
// ❌ Kompliziert: Topics in Compiler generiert, in Runtime verwendet
const topics = compiler.compile() // → elements[] mit labelTopic, valueTopic
runtime.render() // → if (binding.labelTopic) publish(...)

// ❌ Vermischt: Compile-Zeit und Runtime-Logic gemischt
compiler.ts: 500 Zeilen (Display-Items + Topics + Bindings)
runtime.ts:  600 Zeilen (Rendering + Events + Bindings)

// ❌ Unflexibel: Neue Features = ändern von Compiler UND Runtime
// ❌ Versteckte Bugs: displayBindings.ts, Dirty Tracking, Delays
```

### Neu (device/*)

```typescript
// ✅ Einfach: Topics deterministisch berechnet
deviceService.updateDisplay(itemId, { label, value })
// Topic = `buttonplus/${deviceId}/displayitem/${itemId}/label/set`

// ✅ Getrennt: Jede Komponente hat eine klare Verantwortung
DeviceConfigBuilder: 200 Zeilen (nur Struktur)
SceneRenderer:       150 Zeilen (nur Rendering)
AutomationRuntime:   400 Zeilen (nur Events)
DeviceService:       200 Zeilen (nur MQTT)

// ✅ Flexibel: Neue Features = neue Service oder erweitern
// ✅ Testbar: Jeder Service mockbar und unabhängig testbar
```

---

## 🧪 Testing-Strategie

### Vorhandene Verifikation: `npm run verify`

Zwei Skripte prüfen die Kern-Verträge gegen die **Single Source of Truth**
(`MQTT-TOPICS-REFERENCE.md`) mit gemocktem MQTT und dem echten Geräte-Config
(`data/_cfg.json`):

- **`verify-fixes.ts`** – DeviceService-Topics/Payloads (LED page-suffix/decimal/
  `"true"`, Labels ohne Suffix, Page-Umrechnung), ConfigBuilder-Heilung
  (Positionen 1..8, front/wall-LEDs, 0-basierte navButtons) und IconResolver.
- **`verify-runtime.ts`** – Event-Fluss: `pushbutton`-Parsing, `event_type`-Filter
  (nur short-/longpress), Position→ID-Mapping, Navigation.

### Unit-Tests (Muster für ein künftiges Test-Framework)

```typescript
// DeviceService mocken
const mockMqtt = new MockMqttService();
const device = new DeviceService(mockMqtt, config);

device.updateDisplay(0, { label: "Test", value: "42" });

expect(mockMqtt.published).toEqual([
  { topic: "buttonplus/device/displayitem/0/label/set", payload: "Test" },
  { topic: "buttonplus/device/displayitem/0/value/set", payload: "42" },
]);
```

### Integration-Tests

```typescript
// DeviceManager mit echtem Store, Mock-MQTT
const manager = new DeviceManager();
await manager.init();

// Deploy simulieren
await manager.deploy();

// Prüfen ob Topics publiziert wurden
expect(mockMqtt.topics).toContain("buttonplus/device/displayitem/0/value/set");
```

---

## 🚀 Nächste Schritte

### Sofort (P1)

- [x] Runtime State-Broadcasting über WebSocket implementiert (`DeviceManager.onRuntimeState`)
- [x] `runGroupById` in neue Runtime portiert (`DeviceManager.runGroup` + API-Endpoint)
- [ ] Logging-Level konfigurierbar machen
- [ ] Deploy-Verification robuster machen

### Kurzfristig (P2)

- [ ] Unit-Tests für DeviceService
- [ ] Unit-Tests für SceneRenderer
- [ ] Integration-Tests für Deploy-Flow
- [ ] Performance-Monitoring (MQTT Publish-Rate)

### Mittelfristig (P3)

- [ ] Weitere Szenentypen (Clock, Weather, Calendar, ...)
- [ ] Plugin-System für Custom-Services
- [ ] Device-Simulator für Offline-Testing
- [ ] Config-Diff-Tool für Debugging

---

## 📝 Migration-Guide

### Für Developer

**Alte Runtime/Compiler-Referenzen ersetzen:**

```typescript
// ALT
import { compile } from "./engine/compiler.js";
import { ButtonRuntime } from "./engine/runtime.js";

const plan = compile(...);
const runtime = new ButtonRuntime(mqtt, vars);
runtime.activate(plan, scenes, nav);

// NEU
import { DeviceManager } from "./device/index.js";

const manager = new DeviceManager();
await manager.init();
await manager.deploy();
```

**Display-Updates:**

```typescript
// ALT (kompliziert)
const topics = findDisplayTopics(element);
if (topics.labelTopic) mqtt.publish(topics.labelTopic, interpolate(label));
if (topics.valueTopic) mqtt.publish(topics.valueTopic, interpolate(value));

// NEU (einfach)
deviceService.updateDisplay(itemId, {
  label: interpolate(label),
  value: interpolate(value),
});
```

---

## 🔗 Datei-Referenzen

### Neue Dateien (alle in `backend/src/device/`)

| Datei | Verantwortung |
|-------|---------------|
| `DeviceService.ts` | MQTT-Publishing-API (0↔1-Umrechnung, Topic-/Wert-Formate) |
| `SceneRenderer.ts` | Scene → Device Mapping |
| `IconResolver.ts` | `mdi:*` / rohes SVG → SVG Tiny 1.2 (via `@mdi/js`) |
| `AutomationRuntime.ts` | Event-Handling & Logic |
| `DeviceConfigBuilder.ts` | Config-Generierung + V2-Button-Heilung |
| `DeviceManager.ts` | Service-Orchestrierung |
| `index.ts` | Exports |

### Entfernte Dateien (alter Compile-Pfad – **gelöscht**)

Der komplette Duplikat-Compile-Pfad wurde entfernt; aktiv ist ausschließlich `device/*`.

| Datei | Status |
|-------|--------|
| `manager.ts` | ❌ GELÖSCHT → `device/DeviceManager.ts` |
| `engine/compiler.ts` | ❌ GELÖSCHT → `device/DeviceConfigBuilder.ts` |
| `engine/runtime.ts` | ❌ GELÖSCHT → `device/AutomationRuntime.ts` |
| `engine/displayBindings.ts` | ❌ GELÖSCHT (unnötig) |
| `engine/naming.ts` | ❌ GELÖSCHT (Topics jetzt im DeviceService) |
| `buttonplus/topics.ts` | ❌ GELÖSCHT (ControlMap-Pfad entfernt) |

**Verbliebene `engine/`-Dateien:** nur noch `expr.ts` (Ausdrucks-Engine) und `variables.ts` (Variablen-Zustand).

---

## ✅ Erfolgs-Kriterien

- [x] Saubere Service-Trennung
- [x] Typisierte APIs
- [x] Topics deterministisch berechnet
- [x] Keine displayBindings.ts mehr
- [x] Keine setTimeout-Delays im kritischen Pfad
- [x] Kein Dirty-Tracking-Cache
- [x] DeviceService universell nutzbar für neue Szenentypen
- [x] Topic-/Wert-Formate gegen `MQTT-TOPICS-REFERENCE.md` verifiziert (`npm run verify`)
- [x] Button↔Position-Mapping, Navigation und Event-Filterung end-to-end getestet
- [ ] Unit-Test-Framework mit Coverage-Reporting

---

**Autor:** Claude Sonnet 4.5  
**Datum:** 2026-07-04  
**Version:** 2.0.0-refactored
