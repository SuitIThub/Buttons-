# Testing-Guide für Button+ Manager v2.0

> **⚠️ WICHTIG:** Für korrekte MQTT-Topic-Formate siehe **[MQTT-TOPICS-REFERENCE.md](./MQTT-TOPICS-REFERENCE.md)**  
> Dieses Dokument enthält teilweise veraltete Beispiele die vor der Prototyp-Verifikation erstellt wurden.

## 🧪 Sofort-Tests (Manuelle Verifikation)

### Test 1: MQTT-Traffic monitoren

**Ziel:** Prüfen ob Topics überhaupt publiziert werden

```bash
# Terminal 1: MQTT-Sniffer starten
mosquitto_sub -h crenserver -p 1883 -u GIS -P 'GIS2017!' -t 'buttonplus/#' -v

# Terminal 2: Backend starten
cd backend
npm run dev

# Terminal 3: Deploy auslösen
curl -X POST http://localhost:8080/api/deploy
```

**Erwartung:**

```
# Display-Items (interpoliert, var0 = 4)
buttonplus/btn_9182a0/displayitem/0/label/set Test 4 -
buttonplus/btn_9182a0/displayitem/0/value/set 4
buttonplus/btn_9182a0/displayitem/1/label/set Label
buttonplus/btn_9182a0/displayitem/1/value/set

# Nav-Buttons (Modell-ID 0/1 → Geräte-Position 1/2), Label ohne Seiten-Suffix
buttonplus/btn_9182a0/button/1/label/set ◀
buttonplus/btn_9182a0/button/1-1/led/front/rgb/set 16711680   # rot (Seite 1, kein Prev)
buttonplus/btn_9182a0/button/2/label/set ▶
buttonplus/btn_9182a0/button/2-1/led/front/rgb/set 65280      # grün (Next möglich)

# Content-Buttons (Modell-ID 2/3 → Geräte-Position 3/4)
buttonplus/btn_9182a0/button/3/label/set                       # (Button 2: leeres Label)
buttonplus/btn_9182a0/button/3-1/led/front/on/set false        # keine ledColor → aus
buttonplus/btn_9182a0/button/4/label/set -                     # (Button 3: Label "-")

buttonplus/btn_9182a0/page/set 1
```

**Was prüfen:**
- ✅ Display-Item-Topics publiziert? Werte interpoliert (`Test 4 -` statt `{var0}`)?
- ✅ Button-Labels **ohne** Seiten-Suffix (`button/3/label/set`)?
- ✅ Button-LEDs **mit** Seiten-Suffix + `front`/`wall`, RGB dezimal, `on` = `true`/`false`?
- ✅ Geräte-Position = Modell-ID + 1 (Nav 0/1 → 1/2, Content 2/3 → 3/4)?
- ✅ Wird die Seite gesetzt? (`page/set 1`)

---

### Test 2: Manuelles Publizieren

**Ziel:** Prüfen ob Gerät auf MQTT reagiert

```bash
# Label setzen
mosquitto_pub -h crenserver -p 1883 -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/displayitem/0/label/set' \
  -m 'MANUAL LABEL TEST' -r

# Value setzen
mosquitto_pub -h crenserver -p 1883 -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/displayitem/0/value/set' \
  -m 'MANUAL VALUE 123' -r

# Button-Label setzen
mosquitto_pub -h crenserver -p 1883 -u GIS -P 'GIS2017!' \
  -t 'buttonplus/btn_9182a0/button/2/label/set' \
  -m 'BUTTON TEST' -r
```

**Erwartung:**
- ✅ "MANUAL LABEL TEST" erscheint als Label auf dem Display
- ✅ "MANUAL VALUE 123" erscheint als großer Wert
- ✅ "BUTTON TEST" erscheint auf Button 2

**Wenn das NICHT funktioniert:**
- ❌ Gerät ist offline
- ❌ MQTT-Broker-Credentials falsch
- ❌ Topic-Format falsch

**Wenn das funktioniert, Manager aber nicht:**
- ✅ Gerät ist OK
- ❌ Manager publiziert falsche Topics

---

### Test 3: DeviceService direkt testen

**Ziel:** Service isoliert testen

```typescript
// backend/test-device-service.ts
import { DeviceService } from "./src/device/DeviceService.js";
import { MqttService } from "./src/buttonplus/mqttService.js";

const mqtt = new MqttService();
mqtt.connect({
  mqttUrl: "mqtt://crenserver:1883",
  mqttUsername: "GIS",
  mqttPassword: "GIS2017!",
  baseTopic: "buttonplus",
  deviceId: "btn_9182a0",
  deviceIp: "192.168.178.33",
});

const device = new DeviceService(mqtt, {
  baseTopic: "buttonplus",
  deviceId: "btn_9182a0",
  firmwareV2: true,
});

// Warte auf Verbindung
setTimeout(() => {
  console.log("Testing Display Update...");
  device.updateDisplay(0, {
    label: "DeviceService Test",
    value: "123.45",
  });

  console.log("Testing Button Update...");
  device.updateButton(2, {
    label: "Test Button",
    topLabel: "TOP",
  });

  console.log("Testing LED...");
  // LED ist page-spezifisch: (buttonId, pageIndex, farbe) → Front-LED an
  device.setButtonColor(2, 0, "#ff00ff");

  console.log("Done! Check device.");
  process.exit(0);
}, 2000);
```

```bash
cd backend
npx tsx test-device-service.ts
```

**Erwartung** (Button-ID 2 = Geräte-Position 3, pageIndex 0 = Seite 1):
- Display-Item 0: Label "DeviceService Test", Value "123.45"
- Button (Position 3): Label "Test Button", Top "TOP", Front-LED Magenta
  (`button/3-1/led/front/rgb/set 16711680`, `.../brightness/set 255`, `.../on/set true`)

> Für die verlässlichste Prüfung: `npm run verify` (automatisiert gegen die Reference).

---

### Test 4: Config-Verifikation

**Ziel:** Prüfen ob kompilierte Config == Device-Config

```bash
# Config vom Gerät holen
curl http://192.168.178.33/config > device-actual.json

# Kompilierte Config loggen (in DeviceManager.deploy() hinzufügen):
console.log('[Deploy] Compiled Config:', JSON.stringify(output.config, null, 2));

# Vergleichen
diff device-actual.json compiled-config.json
```

**Wichtige Felder:**

```json
{
  "mqttdisplays": [
    {
      "displayitemid": "0",
      "x": 12.7,
      "y": 15.2,
      "page": 1,
      "topics": [
        {
          "topic": "buttonplus/btn_9182a0/displayitem/0/label/set",
          "eventtype": 3
        },
        {
          "topic": "buttonplus/btn_9182a0/displayitem/0/value/set",
          "eventtype": ???
        }
      ]
    }
  ]
}
```

**Prüfen:**
- ✅ Sind alle Display-Items vorhanden?
- ✅ Stimmen die Topics?
- ✅ Ist `page` korrekt (1-basiert)?

---

## 🔧 Debugging

### Logging aktivieren

**In `DeviceService.ts`:**

```typescript
updateDisplay(itemId: number, update: DisplayItemUpdate, retain = true): void {
  const base = this.displayItemTopic(itemId);

  if (update.label !== undefined) {
    console.log(`[DeviceService] 📤 ${base}/label/set = "${update.label}"`);
    this.mqtt.publishRaw(`${base}/label/set`, update.label, retain);
  }
  if (update.value !== undefined) {
    console.log(`[DeviceService] 📤 ${base}/value/set = "${update.value}"`);
    this.mqtt.publishRaw(`${base}/value/set`, update.value, retain);
  }
  // ...
}
```

**In `SceneRenderer.ts`:**

```typescript
renderDisplayItems(...): void {
  console.log(`[SceneRenderer] Rendering ${mappings.length} display items for scene ${scene.id}`);

  for (const mapping of mappings) {
    const element = scene.display.find((el) => el.id === mapping.elementId);
    if (!element) {
      console.warn(`[SceneRenderer] ⚠️ Element ${mapping.elementId} not found!`);
      continue;
    }

    const normalized = normalizeDisplayElement(element as any);
    console.log(`[SceneRenderer] Item ${mapping.displayItemId}: label="${normalized.label}", value="${normalized.value}"`);

    // ...
  }
}
```

**In `AutomationRuntime.ts`:**

```typescript
render(): void {
  if (!this.active || !this.renderConfig) {
    console.log(`[Runtime] ⚠️ Render skipped (active=${this.active})`);
    return;
  }

  const scene = this.currentScene();
  if (!scene) {
    console.log(`[Runtime] ⚠️ No scene for page ${this.currentPage}`);
    return;
  }

  console.log(`[Runtime] Rendering scene "${scene.name}" on page ${this.currentPage}`);
  this.renderer.renderScene(scene, this.renderConfig);
  this.emit("state", this.getState());
}
```

---

### Typische Fehler und Lösungen

#### Problem: Display bleibt leer

**Symptom:** Display zeigt nichts an, MQTT-Traffic sieht leer aus

**Ursachen:**

1. **Topics werden nicht publiziert**
   ```bash
   # Prüfen
   mosquitto_sub -h crenserver -t 'buttonplus/#' -v | grep displayitem
   ```
   Lösung: Logging aktivieren, prüfen ob `render()` aufgerufen wird

2. **Runtime nicht aktiviert**
   ```typescript
   // Prüfen
   curl http://localhost:8080/api/status
   // { "runtime": { "active": false } } ← Problem!
   ```
   Lösung: `POST /api/deploy` aufrufen

3. **Display-Mappings fehlen**
   ```typescript
   // In DeviceManager.deploy()
   console.log('[Deploy] Display Mappings:', output.displayMappings);
   ```
   Lösung: Szene hat keine Display-Elemente, oder Seite nicht verknüpft

4. **Variablen-Interpolation scheitert**
   ```bash
   # Prüfen
   curl -X POST http://localhost:8080/api/preview \
     -H 'Content-Type: application/json' \
     -d '{"template": "Test {var0}"}'
   ```
   Lösung: Variable existiert nicht, oder Syntax-Fehler

---

#### Problem: Button-Labels funktionieren nicht

**Symptom:** Button-Labels bleiben leer oder ändern sich nicht

**Prüfen:**

```bash
# MQTT-Traffic überwachen
mosquitto_sub -h crenserver -t 'buttonplus/+/button/+/label/set' -v
```

**Ursachen:**

1. **Topic-Format falsch**
   ```
   Erwartet: buttonplus/btn_9182a0/button/2/label/set
   Aktuell:  buttonplus/btn_9182a0/button/1/2/label  ← FALSCH!
   ```
   Lösung: `DeviceService.buttonTopic()` prüfen

2. **Buttons nicht in Szene definiert**
   ```typescript
   // store.json prüfen
   {
     "scenes": [
       {
         "buttons": []  // ← Leer!
       }
     ]
   }
   ```
   Lösung: Buttons in UI hinzufügen

---

#### Problem: Variablen-Änderungen werden nicht angezeigt

**Symptom:** Button-Klick ändert Variable, aber Display aktualisiert nicht

**Prüfen:**

```bash
# Variable ändern
curl -X POST http://localhost:8080/api/variables/var0/value \
  -H 'Content-Type: application/json' \
  -d '{"value": 999}'

# Status prüfen
curl http://localhost:8080/api/status | jq '.runtime.variables'
```

**Ursachen:**

1. **Variable-Change-Event nicht gefeuert**
   ```typescript
   // In VariableState.set()
   console.log(`[VariableState] Setting ${name} = ${value}`);
   this.emit("change");  // ← Muss gefeuert werden
   ```

2. **Runtime rendert nicht**
   ```typescript
   // In AutomationRuntime.ts
   this.vars.on("change", () => {
     console.log(`[Runtime] Variable changed, re-rendering`);
     this.checkVariableChanges();
     this.render();  // ← Muss aufgerufen werden
   });
   ```

---

## 📊 Performance-Monitoring

### MQTT Publish-Rate messen

```typescript
// In MqttService.publishRaw()
private publishCount = 0;
private publishTimer = Date.now();

publishRaw(topic: string, payload: string, retain: boolean): boolean {
  this.publishCount++;

  if (Date.now() - this.publishTimer > 10000) {
    const rate = this.publishCount / 10;
    console.log(`[MQTT] Publish-Rate: ${rate.toFixed(1)} msg/s`);
    this.publishCount = 0;
    this.publishTimer = Date.now();
  }

  // ...
}
```

**Erwartung:**
- Bei Deploy: ~10-20 messages (einmalig)
- Bei Variable-Change: 2-4 messages (Display-Updates)
- Idle: 0 messages

**Wenn Rate > 10 msg/s kontinuierlich:**
- ❌ Infinite Loop in Variable-Change-Handling
- ❌ Render-Loop (render() triggert change, change triggert render)

---

## ✅ Checkliste für Produktion

- [ ] MQTT-Broker erreichbar
- [ ] Device erreichbar (`curl http://192.168.178.33/config`)
- [ ] Alle Variablen definiert
- [ ] Mindestens eine Seite + Szene
- [ ] Deploy erfolgreich (`POST /api/deploy` → 200 OK)
- [ ] Runtime aktiv (`GET /api/status` → `runtime.active: true`)
- [ ] Display-Werte sichtbar auf Gerät
- [ ] Button-Labels sichtbar
- [ ] Button-Klick ändert Variablen
- [ ] Seiten-Navigation funktioniert

---

## 🐛 Bug-Report-Template

```markdown
### Bug: Display-Werte erscheinen nicht

**Environment:**
- Manager Version: v2.0.0-refactored
- Device: Button+ V2, Firmware 3.1.2-V2
- MQTT Broker: Mosquitto 2.x

**Schritte:**
1. Deploy durchgeführt
2. MQTT-Traffic überwacht
3. Display bleibt leer

**Erwartung:**
Display zeigt "Test {var0} -" und "4"

**Ist-Zustand:**
Display ist komplett leer

**Logs:**
```
[Deploy] Compiling...
[Deploy] Pushing config to device...
[Deploy] Verifying config on device...
[Deploy] Activating runtime...
[Runtime] Rendering scene "Szene 1" on page 0
[SceneRenderer] Rendering 2 display items for scene b1eb2892...
[DeviceService] 📤 buttonplus/btn_9182a0/displayitem/0/label/set = "Test 4 -"
[DeviceService] 📤 buttonplus/btn_9182a0/displayitem/0/value/set = "4"
```

**MQTT-Traffic:**
```
buttonplus/btn_9182a0/displayitem/0/label/set Test 4 -
buttonplus/btn_9182a0/displayitem/0/value/set 4
```

**Device-Config (displayitems[0]):**
```json
{
  "displayitemid": "0",
  "x": 12.7,
  "y": 15.2,
  "page": 1,
  "topics": [...]
}
```

**Manueller Test:**
```bash
mosquitto_pub ... -t '...label/set' -m 'MANUAL TEST'
# ✅ FUNKTIONIERT - Display zeigt "MANUAL TEST"
```

**Diagnose:**
Manager publiziert korrekte Topics mit korrekten Werten.
Manuelles Publizieren funktioniert.
→ Topics sind korrekt, Device empfängt, aber Manager-Payloads kommen nicht an?
→ Timing-Problem? Retain-Flag?
```

---

**Viel Erfolg beim Testen! 🚀**
