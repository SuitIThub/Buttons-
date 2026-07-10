# Changelog - Button Navigation Fix

**Datum:** 2026-01-05  
**Version:** Backend v2.0.1  
**Typ:** Critical Bugfix

> **Historischer Eintrag.** Am 2026-07-05 folgte eine vollständige
> Kommunikations-Korrektur (siehe `MQTT-TOPICS-REFERENCE.md` → „Backend-Umsetzung").
> Dabei wurde u. a. der alte Compile-Pfad (`engine/compiler.ts` etc.) **gelöscht**
> und die interne Nummerierung auf 0-basiert vereinheitlicht (Umrechnung im
> `DeviceService`). Datei-/Zeilen-Verweise unten sind daher teils veraltet.

---

## 🐛 Problem

Button-Navigation funktionierte nicht korrekt:
- Display-Buttons reagierten nicht
- Navigation zwischen Seiten funktionierte nicht
- Falsches MQTT-Topic-Format wurde verwendet

**Root Cause:** Falsche Annahme über Navigation-Button-IDs

---

## ✅ Lösung

### 1. Minimal-Prototyp zum Testen

**Erstellt:** `test-button-prototype.js`

**Zweck:**
- Direkter MQTT-Test ohne Backend-Komplexität
- Verifizierung der korrekten Topic-Formate
- Identifizierung der tatsächlichen Button-Positionen

**Ergebnis:**
- ✅ Navigation funktioniert
- ✅ Display-Updates funktionieren
- ✅ LED-Updates funktionieren
- ✅ JSON Payload wird korrekt geparst

---

### 2. Code-Fixes

#### Fix 1: Navigation Button IDs

**Datei:** `src/device/DeviceConfigBuilder.ts`
*(Hinweis 2026-07-05: `src/engine/compiler.ts` existiert nicht mehr.)*

**Begründung:**
- Display-Modul hat **feste** Button-Positionen am Gerät
- Position 1 = Links (PREV), Position 2 = Rechts (NEXT)

*(Aktuelle Umsetzung: intern 0-basierte navButtons `{prev:0,next:1}`, die im
`DeviceService` per `+1` auf die Geräte-Positionen 1/2 abgebildet werden.)*

---

#### Fix 2: JSON Payload Parsing

**Datei:** `src/device/AutomationRuntime.ts:199`

**Problem:** Payload wurde als String behandelt

**Lösung:**
```typescript
// Parse JSON payload
const data = JSON.parse(payload);
if (data.event_type === "shortpress") {
  trigger = "click";
} else if (data.event_type === "longpress") {
  trigger = "long_press";
} else if (data.event_type === "click" || data.event_type === "release") {
  // Ignore intermediate events
  return;
}
```

**Begründung:**
- V3 Firmware sendet JSON: `{"event_type": "shortpress"}`
- Nicht String: `"press"`
- Nur `shortpress` und `longpress` sind Action-Events

---

#### Fix 3: MQTT Topic Cleanup

**Erstellt:** `cleanup-mqtt.js`

**Zweck:**
- Löscht alle retained MQTT messages
- Sauberer Zustand für Tests
- Vermeidet Konflikte mit alten Werten

**Ausgeführt:** 175 retained topics gelöscht

---

### 3. Dokumentation

#### Neue Dateien:

1. **[MQTT-TOPICS-REFERENCE.md](./MQTT-TOPICS-REFERENCE.md)**
   - Vollständige MQTT-Topic-Referenz
   - Verifiziert durch Prototyp
   - Häufige Fehler dokumentiert
   - Test-Commands enthalten

2. **[CHANGELOG-2026-01-05.md](./CHANGELOG-2026-01-05.md)** (diese Datei)
   - Zusammenfassung der Änderungen
   - Migration-Guide

#### Aktualisierte Dateien:

1. **[TESTING.md](./TESTING.md)**
   - Hinweis auf neue Referenz-Doku
   - Warnung vor veralteten Beispielen

---

## 📊 Verifizierte Fakten

### Button Events

| Aspekt | Wert |
|--------|------|
| **Topic-Format** | `button/{position}-{page}/pushbutton` |
| **Payload** | JSON: `{"event_type": "shortpress"}` |
| **Action Events** | `shortpress`, `longpress` |
| **Ignore Events** | `click`, `release` |

### Display Items

| Aspekt | Wert |
|--------|------|
| **Label Topic** | `displayitem/{id}/label/set` |
| **Value Topic** | `displayitem/{id}/value/set` |
| **Unit Topic** | `displayitem/{id}/unit/set` |
| **State Feedback** | `displayitem/{id}/*/state` |

### Button Labels & LEDs

| Aspekt | Wert |
|--------|------|
| **Label Topic** | `button/{position}/label/set` — Page Suffix? ❌ NEIN |
| **Top-Label Topic** | `button/{position}/toplabel/set` — Page Suffix? ❌ NEIN |
| **LED RGB Topic** | `button/{position}-{page}/led/{front\|wall}/rgb/set` — Page Suffix? ✅ JA |
| **LED On/Off Topic** | `button/{position}-{page}/led/{front\|wall}/on/set` — `"true"`/`"false"` |
| **LED Brightness** | `button/{position}-{page}/led/{front\|wall}/brightness/set` — 0-255 |

### Navigation Buttons

| Aspekt | Wert |
|--------|------|
| **PREV Button** | Position 1 (links) |
| **NEXT Button** | Position 2 (rechts) |
| **Berechnung** | FEST, nicht `displayIndex * 2`! |

---

## 🧪 Tests

### Minimal-Prototyp Test

```bash
cd h:\Dateien\Dokumente\Repos\Buttons+
node test-button-prototype.js
```

**Ergebnis:**
- ✅ Button 1 (links) navigiert zu vorheriger Seite
- ✅ Button 2 (rechts) navigiert zu nächster Seite
- ✅ Display zeigt "Seite X"
- ✅ LEDs zeigen grün (verfügbar) / rot (nicht verfügbar)

---

### Backend Test

```bash
# MQTT cleanen
node cleanup-mqtt.js

# Backend starten
cd backend
npm run build
npm start

# In anderem Terminal: Buttons drücken und MQTT monitoren
mosquitto_sub -h crenserver -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/+/pushbutton' -v
```

---

## 🚀 Migration

### Für Entwickler

1. **Pull neueste Changes:**
   ```bash
   git pull
   ```

2. **Backend neu kompilieren:**
   ```bash
   cd backend
   npm run build
   ```

3. **MQTT cleanen (empfohlen):**
   ```bash
   node cleanup-mqtt.js
   ```

4. **Backend neu starten:**
   ```bash
   npm start
   ```

5. **Deploy ausführen:**
   ```bash
   curl -X POST http://localhost:8080/api/deploy
   ```

6. **Testen:**
   - Drücke Display-Buttons
   - Prüfe ob Navigation funktioniert
   - Prüfe ob Display-Werte aktualisieren

---

### Für neue Entwickler

**WICHTIG:** Lies zuerst:
1. [MQTT-TOPICS-REFERENCE.md](./MQTT-TOPICS-REFERENCE.md)
2. [ARCHITECTURE.md](./ARCHITECTURE.md)
3. [TESTING.md](./TESTING.md)

**Niemals:**
- MQTT-Topic-Formate aus dem Gedächtnis schreiben
- Annahmen über Button-IDs treffen
- Code aus diesem Repo als "Wahrheit" nehmen ohne Online-Verifikation

**Immer:**
- Referenz-Dokumentation checken
- Prototyp-Tests bei Unsicherheit
- MQTT-Traffic monitoren bei Debugging

---

## 📝 Lessons Learned

### Was ging schief?

1. **Falsche Annahme über Button-IDs**
   - Angenommen: `prev = displayIndex * 2`
   - Tatsächlich: `prev = 1` (fest)

2. **Code als "Wahrheit" betrachtet**
   - Alter Code hatte den Bug
   - Wurde beim Refactoring übernommen
   - Keine Online-Verifikation

3. **Payload-Format nicht verifiziert**
   - Angenommen: String `"press"`
   - Tatsächlich: JSON `{"event_type": "shortpress"}`

### Was haben wir gelernt?

1. **Prototyp-Tests sind essentiell**
   - Minimal isoliert
   - Direktes MQTT-Testing
   - Keine Backend-Komplexität

2. **Dokumentation ist kritisch**
   - Verifizierte Fakten festhalten
   - Häufige Fehler dokumentieren
   - Falsche Annahmen explizit markieren

3. **Nie Code als Wahrheit annehmen**
   - Immer gegen Device/Firmware testen
   - Online-Dokumentation checken
   - Bei Unsicherheit: Prototyp bauen

---

## 🔗 Referenzen

- **MQTT-Topics:** [MQTT-TOPICS-REFERENCE.md](./MQTT-TOPICS-REFERENCE.md)
- **Architektur:** [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Testing:** [TESTING.md](./TESTING.md)
- **Prototyp:** `test-button-prototype.js`
- **Cleanup:** `cleanup-mqtt.js`

---

**Status:** ✅ Gefixt und verifiziert  
**Nächste Schritte:** Frontend-Integration testen
