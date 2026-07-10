# Button+ V3 MQTT Topics - Verified Reference

**Firmware Version:** 3.1.6-V2  
**Device:** btn_9182a0  
**Last Updated:** 2026-07-05  
**Verified via:** Minimal Prototype Testing (test-led-prototype.js, test-button-prototype.js)

---

## 🎯 Critical Findings

### Navigation Button IDs

**Verifizierter Geräte-Fakt:** Die Display-Modul-Buttons haben FESTE physische
**Positionen 1 (Prev) und 2 (Next)** – sie werden nicht pro Modul berechnet.

**Physische Anordnung:**
- Position 1 = Linker Display-Button = PREV (◀)
- Position 2 = Rechter Display-Button = NEXT (▶)

**Im Backend** werden diese Positionen 0-basiert repräsentiert (IDs `0`/`1`) und
erst im `DeviceService` per `+1` auf die Geräte-Positionen 1/2 abgebildet
(siehe „Backend-Umsetzung" unten). Am Draht bleibt es immer 1/2.

---

### Button Positionen

**❌ FALSCH (häufiger Fehler):**
```javascript
// Positionen 0-7 (Position 0 existiert nicht, Position 8 fehlt!)
for (let pos = 0; pos < 8; pos++) {
  // Button 0 gibt es nicht auf dem Gerät
  // Button 8 fehlt in der Config
}
```

**✅ KORREKT (verifiziert 2026-07-05):**
```javascript
// Positionen 1-8
for (let pos = 1; pos <= 8; pos++) {
  // Alle 8 physischen Buttons korrekt adressiert
}
```

**Device Config:**
- Buttons müssen `position: 1` bis `position: 8` haben
- `buttonid` Format: `"1-1"`, `"2-1"`, ..., `"8-1"` für Page 1
- Position 0 darf **NICHT** in der Config sein
- Position 8 **MUSS** in der Config sein

**Beispiel korrekte Config:**
```json
{
  "buttonid": "8-1",
  "position": 8,
  "page": 1,
  "label": "",
  "toplabel": "",
  "leds": [
    {"frontwall": "front", "onrgb": 0, "topics": []},
    {"frontwall": "wall", "onrgb": 0, "topics": []}
  ]
}
```

---

## 📨 MQTT Topic Formate

### 1. Button Events (Device → Backend)

**Format:**
```
buttonplus/{deviceId}/button/{position}-{page}/pushbutton
```

**Payload (JSON):**
```json
{"event_type": "click"}       // Taste gedrückt (intermediate)
{"event_type": "release"}     // Taste losgelassen (intermediate)
{"event_type": "shortpress"}  // Kurzer Druck (ACTION)
{"event_type": "longpress"}   // Langer Druck (ACTION)
```

**Beispiele:**
```
buttonplus/btn_9182a0/button/1-1/pushbutton {"event_type": "shortpress"}
buttonplus/btn_9182a0/button/2-1/pushbutton {"event_type": "shortpress"}
buttonplus/btn_9182a0/button/3-1/pushbutton {"event_type": "longpress"}
```

**Wichtig:**
- `{position}` = Physische Button-Position (1-8, NICHT 0-7!)
- `{page}` = Seiten-Nummer (1-based)
- Nur `shortpress` und `longpress` triggern Actions
- `click` und `release` sind intermediate Events → ignorieren

**Legacy Topics (deprecated, aber noch gesendet):**
```
buttonplus/{deviceId}/button/{position}/click press
buttonplus/{deviceId}/button/{position}/long_press press
```

---

### 2. Display Items (Backend → Device)

**Label:**
```
buttonplus/{deviceId}/displayitem/{itemId}/label/set
```

**Value:**
```
buttonplus/{deviceId}/displayitem/{itemId}/value/set
```

**Unit:**
```
buttonplus/{deviceId}/displayitem/{itemId}/unit/set
```

**SVG Icon:**
```
buttonplus/{deviceId}/displayitem/{itemId}/svg/set
```

**Beispiele:**
```
buttonplus/btn_9182a0/displayitem/0/label/set "Temperature"
buttonplus/btn_9182a0/displayitem/0/value/set "23.5"
buttonplus/btn_9182a0/displayitem/0/unit/set "°C"
buttonplus/btn_9182a0/displayitem/2/label/set "Seite 1"
```

**State Topics (Device → Backend, Bestätigung):**
```
buttonplus/{deviceId}/displayitem/{itemId}/label/state
buttonplus/{deviceId}/displayitem/{itemId}/value/state
```

---

### 3. Button Labels (Backend → Device)

**Hauptlabel:**
```
buttonplus/{deviceId}/button/{position}/label/set
```

**Top-Label:**
```
buttonplus/{deviceId}/button/{position}/toplabel/set
```

**SVG Icon (⚠️ MIT Page-Suffix, anders als die Labels!):**
```
buttonplus/{deviceId}/button/{position}-{page}/svg/set
```
Das seitenspezifische Format entspricht §6 und dem offiziellen Node-RED-Package
(`backend/package/nodes/lib/topics.js` → `buttonBaseTopic` mit `{button}-{page}`).
Eine frühere Version dieses Dokuments listete hier fälschlich das Topic ohne
Page-Suffix.

**WICHTIG:** Button Labels haben **KEIN** `-page` Suffix!

**Beispiele:**
```
buttonplus/btn_9182a0/button/1/label/set "◀"
buttonplus/btn_9182a0/button/2/label/set "▶"
buttonplus/btn_9182a0/button/3/label/set "Light"
buttonplus/btn_9182a0/button/3/toplabel/set "Living Room"
```

**❌ FALSCH:**
```
buttonplus/btn_9182a0/button/1-1/label/set    ← NEIN!
buttonplus/btn_9182a0/button/1/2/label        ← NEIN!
```

---

### 4. LED Control (Backend → Device)

**⚠️ KRITISCH: LEDs sind PAGE-SPEZIFISCH wie Buttons!**

**Format:**
```
buttonplus/{deviceId}/button/{position}-{page}/led/{side}/{parameter}/set
```

**Seiten (sides):**
- `front` = Front-LED (zur Wand gerichtet)
- `wall` = Wall-LED (rückwärtige LED) **NICHT "back"!**

**Parameter (ALLE DREI erforderlich!):**

1. **RGB Farbe (DEZIMAL, nicht Hex!):**
   ```
   buttonplus/{deviceId}/button/{position}-{page}/led/{side}/rgb/set
   ```
   - Wert: Dezimalzahl (z.B. `16711680` für Rot)
   - ❌ NICHT: Hex-String (`"#FF0000"`)
   - Konvertierung: `parseInt(hex.replace('#', ''), 16)`

2. **On/Off (String "true"/"false"):**
   ```
   buttonplus/{deviceId}/button/{position}-{page}/led/{side}/on/set
   ```
   - Wert: `"true"` oder `"false"` (als String!)
   - ❌ NICHT: `"1"`, `"0"`, `1`, `0`, boolean

3. **Helligkeit (0-255):**
   ```
   buttonplus/{deviceId}/button/{position}-{page}/led/{side}/brightness/set
   ```
   - Wert: `0` - `255` (als String!)
   - Empfohlen: `255` für volle Helligkeit

**Beispiele (KORREKT - verifiziert 2026-07-05):**
```bash
# Button 3, Page 1, Front LED = ROT
buttonplus/btn_9182a0/button/3-1/led/front/rgb/set "16711680"
buttonplus/btn_9182a0/button/3-1/led/front/brightness/set "255"
buttonplus/btn_9182a0/button/3-1/led/front/on/set "true"

# Button 5, Page 1, Wall LED = GRÜN
buttonplus/btn_9182a0/button/5-1/led/wall/rgb/set "65280"
buttonplus/btn_9182a0/button/5-1/led/wall/brightness/set "255"
buttonplus/btn_9182a0/button/5-1/led/wall/on/set "true"

# LED ausschalten
buttonplus/btn_9182a0/button/3-1/led/front/on/set "false"
```

**Häufige Fehler:**

| ❌ FALSCH | ✅ KORREKT | Problem |
|-----------|------------|---------|
| `button/3/led/front/...` | `button/3-1/led/front/...` | Page-Suffix fehlt! |
| `led/back/rgb/set` | `led/wall/rgb/set` | Seite heißt "wall" nicht "back"! |
| `rgb/set "#FF0000"` | `rgb/set "16711680"` | Nur Dezimal, kein Hex! |
| `on/set "1"` | `on/set "true"` | Muss String "true"/"false" sein! |
| Nur RGB + On | RGB + Brightness + On | Alle 3 Parameter nötig! |

**Button Positionen:**
- ⚠️ **Positionen 1-8**, NICHT 0-7!
- Position 0 existiert nicht auf dem Gerät
- Position 8 muss in der Config vorhanden sein

**Buttons sind SEITENSPEZIFISCH:**
- Ein Button existiert nur auf Seiten, für die er in der Config definiert ist
  (`buttonid = "{position}-{page}"`, `page`-Feld).
- Ohne Definition auf einer Seite feuert das Gerät dort KEINE
  `pushbutton`-Events und ignoriert LED-Kommandos (`button/{pos}-{page}/led/...`).
- Der DeviceConfigBuilder erzeugt deshalb jede Position auf JEDER Seite
  (buttonCount × pageCount Einträge).

---

### 5. Page Control (Backend → Device)

**Seite setzen:**
```
buttonplus/{deviceId}/page/set {pageNumber}
```

**Page Status (Device → Backend):**
```
buttonplus/{deviceId}/page/status
buttonplus/{deviceId}/page/state
```

---

### 6. SVG Icons (Backend → Device)

**⚠️ WICHTIG: SVG Tiny 1.2 Format!**

**Button SVG:**
```
buttonplus/{deviceId}/button/{position}-{page}/svg/set
```

**Display Item SVG:**
```
buttonplus/{deviceId}/displayitem/{id}/svg/set
```

**Format-Anforderungen (KRITISCH!):**

1. **Nur `viewBox` im root tag:**
   ```xml
   <svg viewBox="0 0 24 24">...</svg>
   ```
   - ❌ NICHT: `xmlns`, `width`, `height`, `title`, `id`, etc.

2. **Filled shapes mit `fill` Attribut:**
   ```xml
   <path fill="white" d="..."/>
   <path fill="red" d="..."/>
   ```
   - ❌ NICHT: stroke-based paths ohne fill

3. **SVG Tiny 1.2 format:**
   - Nur basic shapes: `<path>`, `<circle>`, `<rect>`, `<polygon>`
   - Keine gradients, filters, animations
   - Größe: idealerweise unter 2 kB

4. **Empfohlene viewBox:** `0 0 24 24`

**Beispiele (KORREKT - verifiziert 2026-07-05):**

```xml
<!-- Pfeil Links -->
<svg viewBox="0 0 24 24">
  <path fill="white" d="M15.41,16.58L10.83,12L15.41,7.41L14,6L8,12L14,18L15.41,16.58Z"/>
</svg>

<!-- Plus -->
<svg viewBox="0 0 24 24">
  <path fill="white" d="M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z"/>
</svg>

<!-- Glühbirne -->
<svg viewBox="0 0 24 24">
  <path fill="yellow" d="M12,2A7,7 0 0,0 5,9C5,11.38 6.19,13.47 8,14.74V17A1,1 0 0,0 9,18H15A1,1 0 0,0 16,17V14.74C17.81,13.47 19,11.38 19,9A7,7 0 0,0 12,2M9,21A1,1 0 0,0 10,22H14A1,1 0 0,0 15,21V20H9V21Z"/>
</svg>

<!-- Thermometer -->
<svg viewBox="0 0 24 24">
  <path fill="red" d="M15,13V5A3,3 0 0,0 9,5V13A5,5 0 1,0 15,13M12,4A1,1 0 0,1 13,5V8H11V5A1,1 0 0,1 12,4Z"/>
</svg>
```

**MQTT Publish:**
```bash
# Button 3, Page 1 = Home Icon
mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/3-1/svg/set' \
  -m '<svg viewBox="0 0 24 24"><path fill="white" d="M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z"/></svg>' \
  -r

# Display Item 0 = Temperatur Icon
mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/displayitem/0/svg/set' \
  -m '<svg viewBox="0 0 24 24"><path fill="red" d="M15,13V5A3,3 0 0,0 9,5V13A5,5 0 1,0 15,13M12,4A1,1 0 0,1 13,5V8H11V5A1,1 0 0,1 12,4Z"/></svg>' \
  -r
```

**Häufige Fehler:**

| ❌ FALSCH | ✅ KORREKT | Problem |
|-----------|------------|---------|
| `<svg xmlns="..." viewBox="0 0 24 24">` | `<svg viewBox="0 0 24 24">` | xmlns muss weg! |
| `<path d="..."/>` (kein fill) | `<path fill="white" d="..."/>` | fill fehlt! |
| Stroke-based paths | Filled shapes | Strokes werden nicht supported! |
| SVG > 2 kB | SVG < 2 kB | Zu groß für Device RAM! |

**Design-Tipps:**
- Dicke Striche verwenden (dünne Linien verschwinden)
- Kleine Details vermeiden
- Gegen schwarzen Hintergrund testen
- Filled shapes bevorzugen

**SVG Optimizer Tools:**
- [SVGOMG](https://svgomg.net/)
- [TinySVG](https://tinysvg.t8l.dev/)
- [Vecta.io Nano](https://vecta.io/nano)

**Test-Prototyp:**
```bash
node test-svg-icons.js
```

---

## 🔍 Prototyp Test-Ergebnisse

### Test-Setup
- **File:** `test-button-prototype.js`
- **Datum:** 2026-01-05
- **Device:** btn_9182a0 (Firmware 3.1.7-V2)

### Verifizierte Fakten

1. **Button Events kommen als JSON:**
   - ✅ Topic: `button/1-1/pushbutton`
   - ✅ Payload: `{"event_type": "shortpress"}`
   - ✅ Pro Button-Klick: 3 Events (click, release, shortpress)

2. **Display-Buttons haben feste Positionen:**
   - ✅ Position 1 = Links = PREV
   - ✅ Position 2 = Rechts = NEXT
   - ❌ NICHT `displayIndex * 2` wie angenommen!

3. **Navigation funktioniert:**
   - ✅ Button 1 drücken → Page wechselt
   - ✅ Display aktualisiert sich
   - ✅ LEDs aktualisieren sich

4. **Display Values funktionieren:**
   - ✅ `displayitem/{id}/label/set` wird angezeigt
   - ✅ `displayitem/{id}/value/set` wird angezeigt
   - ✅ Device bestätigt mit `/state` Topics

5. **Button Labels OHNE page-suffix:**
   - ✅ `button/1/label/set` funktioniert
   - ❌ `button/1-1/label/set` funktioniert NICHT

---

## 🛠️ Backend-Umsetzung (Stand 2026-07-05)

> **Nummerierungs-Konvention:** Das Backend arbeitet intern **0-basiert**
> (`buttonId` 0..N-1, `pageIndex` 0..M-1), das Gerät **1-basiert** (Positionen
> 1..8, Seiten 1..M). Die Umrechnung `position = buttonId + 1` bzw.
> `devicePage = pageIndex + 1` passiert **ausschließlich** im `DeviceService`.
> Die untenstehenden Geräte-Fakten (Positionen 1/2, `wall`, Dezimal-RGB …)
> bleiben davon unberührt – sie beschreiben, was am Draht liegt.

### Navigation-Buttons (`device/DeviceConfigBuilder.ts`)

Die zwei Display-Modul-Buttons sind für Prev/Next reserviert. Intern 0-basiert
abgeleitet, am Gerät sind das die **festen Positionen 1 (Prev) und 2 (Next)**:

```typescript
// 0-basierte Modell-IDs; Display an Connector 0 → {prev:0,next:1} → Positionen 1/2
const navButtons = displayIndex >= 0
  ? { prev: displayIndex * 2, next: displayIndex * 2 + 1 }
  : null;
```

### Event-Parsing (`device/AutomationRuntime.ts`)

Events werden **generisch** aus dem Topic geparst (kein Config-Lookup):

```typescript
const m = /\/button\/(\d+)-(\d+)\/pushbutton$/.exec(topic);
const buttonId = Number(m[1]) - 1;           // Position (1-basiert) → 0-basierte ID
const data = JSON.parse(payload);
if (data.event_type === "shortpress") trigger = "click";
else if (data.event_type === "longpress") trigger = "long_press";
else return;                                 // click/release/unbekannt ignorieren
```

### Topic-Erzeugung (`device/DeviceService.ts`)

Alle Topics werden zentral gebaut, inkl. 0→1-Umrechnung:

```typescript
// Labels: OHNE Seiten-Suffix
`.../button/${buttonId + 1}/label/set`
// LEDs: MIT Seiten-Suffix, side = "front"|"wall"
`.../button/${buttonId + 1}-${pageIndex + 1}/led/${side}/rgb|brightness|on/set`
```

### Icon-Auflösung (`device/IconResolver.ts`)

`mdi:<name>` und rohes SVG werden vor dem Publish in **SVG Tiny 1.2** übersetzt
(nur `viewBox`, `fill`-Attribut) – siehe §6.

---

## 📋 Checkliste für neue Features

Wenn du MQTT-Topics verwendest, stelle sicher:

- [ ] Button Events: `button/{position}-{page}/pushbutton` mit JSON payload
- [ ] Display Items: `displayitem/{id}/label/set` (OHNE button prefix!)
- [ ] Button Labels: `button/{position}/label/set` (OHNE -page suffix!)
- [ ] LED Control: `button/{position}-{page}/led/{side}/rgb/set` (MIT -page suffix! side="front" oder "wall")
- [ ] LED Parameter: ALLE 3 setzen (rgb + brightness + on), RGB als Dezimal, on als "true"/"false"
- [ ] SVG Icons: Nur `viewBox` im root tag, `fill` Attribut erforderlich, keine strokes, SVG Tiny 1.2
- [ ] SVG Topics: Button `button/{position}-{page}/svg/set`, Display `displayitem/{id}/svg/set`
- [ ] Button Positionen am Gerät: 1-8 (NICHT 0-7!) — intern 0-basiert, +1 im DeviceService
- [ ] Navigation: feste Geräte-Positionen 1 (Prev) / 2 (Next) — intern IDs 0/1
- [ ] JSON Parsing: `event_type` statt String-Payload
- [ ] Event Filtering: Nur `shortpress` und `longpress` verarbeiten

---

## 🚫 Häufige Fehler

### ❌ Falsche Topic-Formate

```
buttonplus/btn_9182a0/button/1-1/label/set       ← FALSCH (page-suffix bei labels)
buttonplus/btn_9182a0/button/1/2/label           ← FALSCH (falsches Format)
buttonplus/btn_9182a0/display/0/value            ← FALSCH (heißt displayitem, nicht display)
```

### ❌ Falsche Navigation-Button-Berechnung

```typescript
const prev = displayIndex * 2;      // ← FALSCH!
const next = displayIndex * 2 + 1;  // ← FALSCH!
```

### ❌ String statt JSON Payload

```typescript
if (payload === "press") {  // ← FALSCH!
  // Payload ist JSON: {"event_type": "shortpress"}
}
```

### ❌ Alle Events verarbeiten

```typescript
// FALSCH - verarbeitet auch click/release:
if (topic.includes("/pushbutton")) {
  handleButton(...);
}

// RICHTIG - nur shortpress/longpress:
const data = JSON.parse(payload);
if (data.event_type === "shortpress" || data.event_type === "longpress") {
  handleButton(...);
}
```

### ❌ Falsche LED-Steuerung

```bash
# FALSCH - Page-Suffix fehlt:
buttonplus/btn_9182a0/button/3/led/front/rgb/set "16711680"

# FALSCH - "back" statt "wall":
buttonplus/btn_9182a0/button/3-1/led/back/rgb/set "16711680"

# FALSCH - Hex statt Dezimal:
buttonplus/btn_9182a0/button/3-1/led/front/rgb/set "#FF0000"

# FALSCH - "1" statt "true":
buttonplus/btn_9182a0/button/3-1/led/front/on/set "1"

# FALSCH - Nur RGB, Brightness/On fehlen:
buttonplus/btn_9182a0/button/3-1/led/front/rgb/set "16711680"
# LED leuchtet nicht ohne brightness + on!

# RICHTIG - Alle 3 Parameter mit korrektem Format:
buttonplus/btn_9182a0/button/3-1/led/front/rgb/set "16711680"
buttonplus/btn_9182a0/button/3-1/led/front/brightness/set "255"
buttonplus/btn_9182a0/button/3-1/led/front/on/set "true"
```

### ❌ Falsche Button-Positionen

```javascript
// FALSCH - Positionen 0-7:
for (let pos = 0; pos < 8; pos++) {
  // Position 0 existiert nicht auf dem Gerät!
  // Position 8 fehlt!
}

// RICHTIG - Positionen 1-8:
for (let pos = 1; pos <= 8; pos++) {
  // Alle 8 physischen Buttons abgedeckt
}
```

---

## 🧪 Test-Commands

### MQTT Subscribe (alle Button Events):
```bash
mosquitto_sub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/+/pushbutton' -v
```

### MQTT Publish (Display Label):
```bash
mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/displayitem/2/label/set' \
  -m 'Test Label' -r
```

### MQTT Publish (Button Label):
```bash
mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/1/label/set' \
  -m '◀' -r
```

### MQTT Publish (LED Control):
```bash
# Button 3, Page 1, Front LED = ROT (alle 3 Parameter!)
mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/3-1/led/front/rgb/set' \
  -m '16711680' -r

mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/3-1/led/front/brightness/set' \
  -m '255' -r

mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/3-1/led/front/on/set' \
  -m 'true' -r

# LED ausschalten
mosquitto_pub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/3-1/led/front/on/set' \
  -m 'false' -r
```

### LED Test Prototyp:
```bash
# Alle 8 Buttons mit verschiedenen Farben
node test-led-prototype.js
```

### Cleanup (alle retained messages löschen):
```bash
node cleanup-mqtt.js
```

---

## 📚 Weiterführende Dokumentation

- **Device Config Struktur:** Siehe `src/buttonplus/types.ts`
- **Topic Builder:** Siehe `src/device/DeviceService.ts`
- **Event Handling:** Siehe `src/device/AutomationRuntime.ts`
- **Rendering:** Siehe `src/device/SceneRenderer.ts`

---

**Letzte Aktualisierung:** 2026-01-05  
**Verifiziert mit:** Firmware 3.1.7-V2, Device btn_9182a0  
**Test-Script:** `test-button-prototype.js`
