/**
 * Device Config Builder - Erstellt Button+ Gerätekonfiguration aus dem Datenmodell.
 *
 * **Verantwortlichkeit:** NUR Struktur, KEINE Runtime-Logic!
 *
 * Der Builder:
 * - Erstellt Display-Items in der Device-Config
 * - Erstellt Button-Definitionen (falls Legacy)
 * - Erstellt Display-Mappings für die Runtime
 * - Managed Seiten und deren Reihenfolge
 *
 * Was er NICHT macht:
 * - Variablen interpolieren (→ SceneRenderer)
 * - MQTT publizieren (→ DeviceService)
 * - Events ausführen (→ Runtime)
 */

import { BPConfig, BPDisplayItem, BPButton, BPButtonLed, BPTopic } from "../buttonplus/types.js";
import { EventType, ConnectorType, hexToDecimalColor } from "../buttonplus/constants.js";
import { Page, Scene, VariableDef } from "../model.js";
import { DisplayMapping } from "./SceneRenderer.js";

export interface DeviceConfigInput {
  /** Basis-Config vom Gerät (wird geklont und modifiziert) */
  baseConfig: BPConfig;
  /** Alle Seiten */
  pages: Page[];
  /** Alle Szenen */
  scenes: Scene[];
  /** Variablen (für Compile-Zeit-Defaults, optional) */
  variables?: VariableDef[];
  /** Base-Topic (default: "buttonplus") */
  baseTopic?: string;
}

export interface DeviceConfigOutput {
  /** Modifizierte Device-Config (bereit für Push) */
  config: BPConfig;
  /** Display-Mappings für Runtime */
  displayMappings: DisplayMapping[];
  /** Anzahl verfügbarer Buttons */
  buttonCount: number;
  /** Navigations-Buttons (prev/next) */
  navButtons: { prev: number; next: number } | null;
  /** Firmware-Typ */
  firmwareV2: boolean;
  /** Device-ID */
  deviceId: string;
  /** Base-Topic */
  baseTopic: string;
}

/**
 * Device Config Builder
 */
export class DeviceConfigBuilder {
  /**
   * Baut Device-Konfiguration aus Datenmodell.
   */
  static build(input: DeviceConfigInput): DeviceConfigOutput {
    const config: BPConfig = structuredClone(input.baseConfig);
    const baseTopic = input.baseTopic || "buttonplus";
    const deviceId = config.info?.id || "device";
    const firmwareV2 = this.isV2Firmware(config.info?.firmware);
    const connectors = config.info?.connectors ?? [];
    // Physische Button-Anzahl aus den Connectoren ableiten (2 Buttons pro Modul);
    // nur wenn keine Connectoren bekannt sind, auf die vorhandene Config zurückfallen.
    const buttonCount =
      connectors.length > 0 ? connectors.length * 2 : config.mqttbuttons?.length ?? 0;
    const brokerId = config.mqttbrokers?.[0]?.brokerid ?? "buttonplus";

    // Navigation-Buttons = die zwei Buttons des Display-Moduls.
    // IDs sind 0-basiert (Modell-Konvention). Bei Display an Connector 0 →
    // { prev: 0, next: 1 } → physische Geräte-Positionen 1 (links/PREV) und
    // 2 (rechts/NEXT). Die +1-Umrechnung passiert im DeviceService.
    const displayIndex = connectors.findIndex(
      (c) => c.type === ConnectorType.DISPLAY || c.type === ConnectorType.DISPLAY_V2,
    );
    const navButtons =
      displayIndex >= 0 ? { prev: displayIndex * 2, next: displayIndex * 2 + 1 } : null;

    // Helper für Topic-Erstellung
    const t = (topic: string, eventtype: number, payload = ""): BPTopic => ({
      brokerid: brokerId,
      topic,
      payload,
      eventtype,
    });

    // Core-Topics (Seitensteuerung)
    config.core = config.core ?? { name: deviceId, topics: [] };
    config.core.topics = [
      t(`${baseTopic}/${deviceId}/page/set`, EventType.SET_PAGE),
      t(`${baseTopic}/${deviceId}/page/status`, EventType.PAGE_STATUS),
    ];

    // Seiten sortieren
    const sortedPages = [...input.pages].sort((a, b) => a.order - b.order);
    const sceneById = new Map(input.scenes.map((s) => [s.id, s]));

    // Anzahl Geräteseiten (V2/V3: 1-basiert, 1..pageCount). Buttons sind
    // seitenspezifisch: nur definierte Positionen feuern Events / nehmen LED-
    // Kommandos an. Um die Config klein zu halten (festes /configsave-Limit im
    // Gerät), definieren wir pro Seite NUR die tatsächlich genutzten Buttons
    // plus immer die Navigations-Buttons — nicht mehr alle 8 auf jeder Seite.
    const pageCount = Math.max(1, sortedPages.length);

    const usedByPage = new Map<number, Set<number>>();
    for (const page of sortedPages) {
      const scene = page.sceneId ? sceneById.get(page.sceneId) : undefined;
      const devicePage = firmwareV2 ? page.order + 1 : page.order;
      usedByPage.set(devicePage, this.usedButtonPositions(scene, buttonCount, navButtons));
    }

    // Display-Items und Mappings erstellen
    const displayItems: BPDisplayItem[] = [];
    const displayMappings: DisplayMapping[] = [];
    let displayItemCounter = 0;

    for (const page of sortedPages) {
      const scene = page.sceneId ? sceneById.get(page.sceneId) : undefined;
      if (!scene || !scene.display || scene.display.length === 0) continue;

      const devicePage = firmwareV2 ? page.order + 1 : page.order;

      for (const element of scene.display) {
        const itemId = displayItemCounter++;

        // Display-Item in Config erstellen. Die Topics definieren, worauf das
        // Gerät lauscht; die Runtime publiziert auf die passenden /set-Varianten.
        const diBase = `${baseTopic}/${deviceId}/displayitem/${itemId}`;

        displayItems.push({
          displayitemid: String(itemId),
          x: element.x,
          y: element.y,
          fontsize: element.fontSize,
          align: element.align,
          width: element.width,
          // Farbe pro Element (statt einer globalen core.color) – sonst „blutet“
          // die Farbe eines Elements auf alle anderen Display-Items durch.
          color: hexToDecimalColor(element.color),
          boxtype: element.boxtype ?? 0,
          label: "", // Wird zur Runtime gesetzt
          unit: element.unit ?? "",
          page: devicePage,
          topics: [
            t(`${diBase}/label/set`, EventType.LABEL),
            t(`${diBase}/value/set`, EventType.VALUE),
            t(`${diBase}/unit/set`, EventType.UNIT),
          ],
        });

        // Mapping für Runtime
        displayMappings.push({
          sceneId: scene.id,
          elementId: element.id,
          displayItemId: itemId,
          pageIndex: page.order,
        });
      }
    }

    config.mqttdisplays = displayItems;

    // Accent-Farbe (erste gefundene Farbe aus allen Szenen)
    const accentColor = sortedPages
      .flatMap((p) => (p.sceneId && sceneById.has(p.sceneId) ? sceneById.get(p.sceneId)!.display : []))
      .map((el) => el.color)
      .find((c) => c && c.trim());

    if (accentColor && config.core) {
      config.core.color = hexToDecimalColor(accentColor);
    }

    // Buttons: V2/V3 heilt die bestehende Gerätekonfig (Positionen 1..N,
    // buttonid, front/wall-LEDs), Legacy erstellt eine neue Button-Config.
    config.mqttbuttons = firmwareV2
      ? this.healV2Buttons(config.mqttbuttons ?? [], buttonCount, pageCount, baseTopic, deviceId, brokerId, usedByPage)
      : this.buildLegacyButtons(baseTopic, deviceId, buttonCount, brokerId);

    // Sensoren: die direkt am Gerät eingerichtete Konfig (sensorid/type/interval)
    // bleibt erhalten; wo noch kein Publish-Topic gesetzt ist, ergänzen wir ein
    // deterministisches Topic, damit das Gerät den Wert publiziert und
    // sensorRead ihn lesen kann. Vorhandene (manuell gesetzte) Topics bleiben.
    config.mqttsensors = (config.mqttsensors ?? []).map((sensor) => {
      if (sensor.topics && sensor.topics.length > 0) return sensor;
      const topic = `${baseTopic}/${deviceId}/sensor/${sensor.sensorid}/state`;
      return { ...sensor, topics: [t(topic, EventType.SENSOR_VALUE)] };
    });

    return {
      config,
      displayMappings,
      buttonCount,
      navButtons,
      firmwareV2,
      deviceId,
      baseTopic,
    };
  }

  /**
   * Heilt die V2/V3-Button-Konfiguration.
   *
   * Buttons sind auf dem Gerät SEITENSPEZIFISCH: Ein Button existiert nur auf
   * Seiten, für die er definiert ist. Ohne Definition feuert das Gerät auf
   * dieser Seite keine pushbutton-Events (Navigation/Szenen hängen fest) und
   * LED-Kommandos (`button/{pos}-{page}/led/...`) laufen ins Leere.
   *
   * Frühere fehlerhafte Deploys können die Gerätekonfig zudem „verschmutzt”
   * haben (z.B. Position 0, fehlende Position 8, fehlende LED-Definitionen).
   * Diese Methode stellt deterministisch sicher:
   * - Genau die Positionen 1..buttonCount existieren auf JEDER Seite 1..pageCount.
   * - Jeder Button hat `buttonid = “{position}-{page}”` und `position`/`page`.
   * - Jeder Button hat exakt eine `front`- und eine `wall`-LED.
   * - Topics werden IMMER neu generiert (1-basiert, mit /set-Suffix), damit
   *   die Geräte-Subscriptions exakt zu DeviceService passen.
   * Vorhandene Felder (longdelay, LEDs, ...) bleiben pro Position erhalten
   * und werden auf alle Seiten übernommen.
   */
  /**
   * Genutzte Button-Positionen (1-basiert) einer Szene für eine Seite.
   * Immer enthalten: die Navigations-Buttons (Blättern muss überall gehen).
   * Custom: gebundene Buttons + Button-Trigger. CookBook: alle Positionen
   * (Nav + Pagination 3-4 + Item-Buttons 5-8).
   */
  private static usedButtonPositions(
    scene: Scene | undefined,
    buttonCount: number,
    nav: { prev: number; next: number } | null,
  ): Set<number> {
    const used = new Set<number>();
    if (nav) {
      used.add(nav.prev + 1);
      used.add(nav.next + 1);
    }
    if (!scene) return used;
    if (scene.category === "cookbook") {
      for (let p = 1; p <= buttonCount; p++) used.add(p);
      return used;
    }
    for (const b of scene.buttons ?? []) {
      if (typeof b.buttonId === "number") used.add(b.buttonId + 1);
    }
    for (const tr of scene.triggers ?? []) {
      if (tr.type === "button" && typeof tr.buttonId === "number") used.add(tr.buttonId + 1);
    }
    return used;
  }

  private static healV2Buttons(
    existing: BPButton[],
    buttonCount: number,
    pageCount: number,
    baseTopic: string,
    deviceId: string,
    brokerId: string,
    usedByPage: Map<number, Set<number>>,
  ): BPButton[] {
    // Bestehende Buttons nach Position indizieren (verschmutzte/ungültige
    // ignorieren). Der erste Treffer pro Position (typisch Seite 1) dient als
    // Vorlage für alle Seiten.
    const byPosition = new Map<number, BPButton>();
    for (const btn of existing) {
      const pos = this.buttonPosition(btn);
      if (pos !== undefined && pos >= 1 && pos <= buttonCount && !byPosition.has(pos)) {
        byPosition.set(pos, btn);
      }
    }

    // Fallback (sollte nicht vorkommen): keine Info → alle Positionen definieren.
    const allPositions = new Set<number>();
    for (let p = 1; p <= buttonCount; p++) allPositions.add(p);

    const healed: BPButton[] = [];
    for (let page = 1; page <= pageCount; page++) {
      const used = usedByPage.get(page) ?? allPositions;
      for (let position = 1; position <= buttonCount; position++) {
        if (!used.has(position)) continue; // ungenutzte Buttons weglassen (Größe!)
        const src = byPosition.get(position);

        healed.push({
          ...src,
          buttonid: `${position}-${page}`,
          position,
          page,
          label: src?.label ?? "",
          toplabel: src?.toplabel ?? "",
          // SVG wird ausschließlich zur Laufzeit publiziert. NIE aus der alten
          // Gerätekonfig übernehmen — sonst zeigt der Button nach einem Reboot
          // ein Phantom-Icon, obwohl in der Szene keins (mehr) gesetzt ist.
          svg: "",
          longdelay: src?.longdelay ?? 40,
          longrepeat: src?.longrepeat ?? 15,
          // Label-Topics auf JEDER Seite — das Gerät bindet Subscriptions an
          // die jeweilige Button-Definition, d.h. ohne Topic auf Seite 2 zeigt
          // der Button dort keinen Label-Inhalt.
          topics: this.buttonLabelTopics(baseTopic, deviceId, position, brokerId),
          leds: this.healLeds(src?.leds),
        });
      }
    }

    return healed;
  }

  /**
   * Ermittelt die physische Position (1-basiert) eines Buttons aus `position`
   * oder aus `buttonid` ("{position}-{page}").
   */
  private static buttonPosition(btn: BPButton): number | undefined {
    if (typeof btn.position === "number") return btn.position;
    if (typeof btn.buttonid === "string") {
      const n = parseInt(btn.buttonid.split("-")[0], 10);
      if (!Number.isNaN(n)) return n;
    }
    return undefined;
  }

  /** Stellt sicher, dass genau eine front- und eine wall-LED existieren. */
  private static healLeds(leds: BPButtonLed[] | undefined): BPButtonLed[] {
    const find = (side: "front" | "wall") => leds?.find((l) => l.frontwall === side);
    return [
      { frontwall: "front", onrgb: find("front")?.onrgb ?? 0, topics: find("front")?.topics ?? [] },
      { frontwall: "wall", onrgb: find("wall")?.onrgb ?? 0, topics: find("wall")?.topics ?? [] },
    ];
  }

  /**
   * Erzeugt Button-Subscription-Topics gemäß MQTT-TOPICS-REFERENCE.md.
   *
   * Nur Label/TopLabel — die einzigen Topics, die das Gerät zum Empfangen
   * von Inhalten über MQTT braucht. Click/LongPress werden für V2/V3 über
   * den eingebauten `pushbutton`-Mechanismus gesendet und brauchen keine
   * Config-Topics. LEDs/SVG verwenden ebenfalls eingebaute Topics.
   *
   * Positionen sind **1-basiert** (1..8), Topics haben den `/set`-Suffix.
   */
  private static buttonLabelTopics(
    baseTopic: string,
    deviceId: string,
    position: number, // 1-basiert!
    brokerId: string,
  ): BPTopic[] {
    const b = `${baseTopic}/${deviceId}/button/${position}`;
    return [
      { brokerid: brokerId, topic: `${b}/label/set`, payload: "", eventtype: EventType.LABEL },
      { brokerid: brokerId, topic: `${b}/toplabel/set`, payload: "", eventtype: EventType.TOPLABEL },
    ];
  }

  /**
   * Erstellt Button-Config für Legacy-Firmware
   */
  private static buildLegacyButtons(
    baseTopic: string,
    deviceId: string,
    count: number,
    brokerId: string,
  ): BPButton[] {
    const buttons: BPButton[] = [];
    const t = (topic: string, eventtype: number, payload = ""): BPTopic => ({
      brokerid: brokerId,
      topic,
      payload,
      eventtype,
    });

    for (let id = 0; id < count; id++) {
      const position = id + 1; // 1-basiert (MQTT-TOPICS-REFERENCE.md)
      buttons.push({
        id,
        label: "",
        toplabel: "",
        ledcolorfront: 0,
        ledcolorwall: 0,
        longdelay: 40,
        longrepeat: 15,
        topics: [
          t(`${baseTopic}/${deviceId}/button/${position}/label/set`, EventType.LABEL),
          t(`${baseTopic}/${deviceId}/button/${position}/toplabel/set`, EventType.TOPLABEL),
        ],
      });
    }

    return buttons;
  }

  /**
   * Prüft ob V2-Firmware
   */
  private static isV2Firmware(firmware: string | undefined): boolean {
    if (!firmware) return true; // Default zu V2
    return firmware.includes("-V2") || /^[23]\./.test(firmware);
  }
}
