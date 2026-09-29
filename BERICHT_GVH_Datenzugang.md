# Bericht: Zugriff auf GVH-Echtzeit-, Linien- und Haltestellendaten

*Stand: 29.09.2026 · alle Angaben live gegen das Produktivsystem geprüft*

---

## 1. Zusammenfassung

Die GVH-Daten lassen sich ohne Zugang zu GVH Connect abrufen. Genutzt wird dasselbe
**HAFAS-Backend** („mgate“ bzw. „HCI“-Schnittstelle der Firma HaCon), mit dem die öffentliche
GVH-Fahrplanauskunft `https://gvh.hafas.de` arbeitet. Die Schnittstelle nimmt JSON per
HTTP-POST entgegen und liefert:

| Datenart | verfügbar | Echtzeit |
|---|---|---|
| Haltestellen (Suche nach Name, Umkreissuche, Koordinaten, DHID) | ja | – |
| Abfahrten und Ankünfte einer Haltestelle | ja | **ja** (Ist-Zeit, Ausfall) |
| Fahrtverlauf einer Fahrt, alle Halte | ja | **ja** (je Halt) |
| Linien (Nummer, Verkehrsmittel, Betreiber, Richtungen) | ja | – |
| Fahrzeugpositionen in einem Kartenausschnitt | ja | berechnet (kein GPS) |
| Hinweise an einzelnen Fahrten | ja | ja |
| Allgemeine Störungsmeldungen (`HimSearch`) | **nein** (Serverfehler) | – |
| Streckenverläufe als Polylinie | **nein** (bleiben leer) | – |

---

## 2. Wie der Zugang gefunden wurde

1. `https://www.gvh.de/abfahrtsmonitor` leitet auf `uestra.de/abfahrtsmonitor` weiter. Dort steht
   nur noch eine **404-Fehlerseite**; der alte Abfahrtsmonitor ist nicht mehr erreichbar.
2. Die Fahrplanauskunft unter `uestra.de/fahrplan/fahrplanauskunft/` bindet diese Seite per iframe ein:
   `https://gvh.hafas.de/?L=vs_gvhng&language=de_DE` (HAFAS-Webapp „Lyra“).
3. Die Webapp lädt beim Start die öffentlich abrufbare Datei
   **`https://gvh.hafas.de/config/webapp.config.json`**:
   ```json
   {
     "urlMgate": "https://gvh.hafas.de/hamm",
     "hciAuth": { "aid": "IKSEvZ1SsVdfIRSK" }
   }
   ```
4. Anfragen, die nur aus dem JSON-Body bestehen, beantwortet das Gateway mit **HTTP 500**
   (`"path":"/hamm/socket"`).
5. Ein Mitschnitt der Webapp im Headless-Browser (Edge + puppeteer-core) zeigte, dass die
   Anfrage-Metadaten **zusätzlich als URL-Query-Parameter** erwartet werden. Mit diesen
   Parametern funktionieren die Anfragen.

---

## 3. Das Protokoll

### 3.1 Endpunkt und Anfrageaufbau

```
POST https://gvh.hafas.de/hamm?hciMethod=<METHODE>&hciVersion=1.62&hciClientType=WEB
                              &hciClientVersion=10109&aid=<AID>&rnd=<Unix-ms>
Content-Type: application/json
```

| Query-Parameter | Wert | Pflicht |
|---|---|---|
| `hciMethod` | Name der Methode, z. B. `StationBoard` (muss zum Body passen) | ja |
| `hciVersion` | `1.62` | ja |
| `hciClientType` | `WEB` | ja |
| `hciClientVersion` | `10109` | ja |
| `aid` | Wert aus `webapp.config.json` | ja |
| `rnd` | aktueller Zeitstempel in ms, verhindert Caching | empfohlen |

**Body:**

```json
{
  "ver": "1.62",
  "lang": "deu",
  "auth":   { "type": "AID", "aid": "IKSEvZ1SsVdfIRSK" },
  "client": { "id": "HAFAS", "type": "WEB", "name": "webapp", "l": "vs_webapp", "v": 10109 },
  "formatted": false,
  "svcReqL": [ { "meth": "StationBoard", "req": { ... }, "id": "1|1|" } ]
}
```

> **AID nicht fest einbauen:** Die Kennung sollte bei jedem Start aus `webapp.config.json`
> gelesen werden. Wechselt sie, passt sich der Client dann von selbst an. Der Prototyp macht das so
> und nutzt den bekannten Wert nur als Rückfall.

### 3.2 Antwortaufbau

```json
{
  "svcResL": [ {
    "meth": "StationBoard",
    "err": "OK",
    "res": {
      "common": { "locL": [], "prodL": [], "opL": [], "icoL": [], "remL": [], "himL": [], "dirL": [], "polyL": [] },
      "jnyL": [ ... ]
    }
  } ]
}
```

HAFAS **normalisiert** die Daten. Mehrfach vorkommende Objekte wie Haltestellen, Produkte/Linien,
Betreiber und Hinweise stehen nur einmal in den Listen unter `common`. Die eigentlichen Datensätze
verweisen per Index darauf:

| Index-Feld | zeigt auf | Inhalt |
|---|---|---|
| `locX` | `common.locL[i]` | Haltestelle/Steig: `name`, `lid`, `extId`, `crd` |
| `prodX` / `dProdX` | `common.prodL[i]` | Linie: `nameS`, `number`, `cls`, `prodCtx`, `icoX`, `oprX` |
| `oprX` | `common.opL[i]` | Betreiber, z. B. „ÜSTRA AG“, „Transdev Hannover GmbH“ |
| `icoX` | `common.icoL[i]` | Farben `bg`/`fg` als `{r,g,b}` |
| `remX` / `himX` (in `msgL`) | `common.remL` / `common.himL` | Hinweistexte |
| `dirX` / `dirRefL` | `common.dirL[i]` | Richtungstexte |

### 3.3 Fehlerbehandlung

| Symptom | Bedeutung |
|---|---|
| HTTP 500, `"path":"/hamm/socket"` | Query-Parameter fehlen, **oder** der Request enthält ein Feld, das die Methode nicht kennt |
| `svcResL[0].err` ≠ `"OK"` | fachlicher Fehler, Text steht in `errTxt` (z. B. `FAIL` / `Internal Error`) |

Unbekannte Felder werden also nicht einfach ignoriert, sondern führen zum Abbruch. Ein Beispiel ist
`maxNum` bei `LineMatch`.

### 3.4 Datenformate

- **Zeiten:** `HHMMSS` als String, zusammen mit dem Datum der Fahrt (`date`, `YYYYMMDD`).
  Nach HAFAS-Konvention steht bei Fahrten über Mitternacht ein Tages-Offset davor (`DDHHMMSS`,
  z. B. `01002500`); der Client berücksichtigt das.
  - Suffix `S` = Soll, also Fahrplan (`dTimeS`, `aTimeS`)
  - Suffix `R` = Echtzeitprognose (`dTimeR`, `aTimeR`); fehlt das Feld, gibt es keine Echtzeit
  - Präfix `d` = Abfahrt (departure), `a` = Ankunft (arrival)
  - Verspätung = `TimeR − TimeS`
- **Ausfall:** `dCncl` / `aCncl` = `true`
- **Koordinaten:** `crd: {x, y}` als Ganzzahl mal 10⁶, `x` = Länge, `y` = Breite.
  Beispiel: `{"x": 9738582, "y": 52374477}` ergibt 52.374477 N, 9.738582 E.
- **Haltestellen-IDs:** `lid`/`extId` im DHID-Format (bundesweite Haltestellen-ID nach IFOPT), z. B.
  `de:03241:11` für Kröpcke. Steige haben längere IDs wie `de:03241:11:1:12`.
- **Fahrt-ID (`jid`)** aus `StationBoard`: Base64-kodiertes JSON, z. B.
  `{"date":"20260929","time":"1747","line":"gvh:02007: :R:j26","tripCode":"1384","stopID":"de:03241:11:1:12"}`
- **Linien-ID (`lineId`):** Base64-kodiertes JSON, z. B.
  `{"lineGroupIds":["gvh:02007: :H:j26","gvh:02007: :R:j26"]}`. `H`/`R` stehen für Hin- und
  Rückrichtung, das Präfix `gvh:` für eine GVH-Linie. Auch andere Verbünde tauchen auf, z. B.
  `bod:` für den Bodensee.
- **Produktklasse `cls`** (Bitmaske laut Webapp-Konfiguration): 1 ICE, 6 IC/EC, 8 RE/RB,
  16 S-Bahn, 32 Bus, 256 Stadtbahn, 512 sprinti/Ruftaxi. **Achtung:** S-Bahnen wurden
  mit `cls` = 8 geliefert. Zuverlässiger ist `prodCtx.catOutL` („Stadtbahn“, „Bus“, „DB“ …).

---

## 4. Die Methoden im Einzelnen

### 4.1 `LocMatch` – Haltestellensuche nach Name

```json
{ "meth": "LocMatch",
  "req": { "input": { "field": "S", "loc": { "type": "S", "name": "Kröpcke?" }, "maxLoc": 10 } } }
```
Das `?` am Ende schaltet die unscharfe Suche ein. Ergebnis: `res.match.locL[]` mit `name`, `lid`,
`extId`, `crd`, `type` (`S` = Haltestelle).

### 4.2 `LocGeoPos` – Haltestellen im Umkreis

```json
{ "meth": "LocGeoPos",
  "req": { "ring": { "cCrd": { "x": 9738600, "y": 52374500 }, "maxDist": 500 },
           "getStops": true, "getPOIs": false, "maxLoc": 20 } }
```
Ergebnis: `res.locL[]`, zusätzlich mit `dist` (Entfernung in Metern).

### 4.3 `StationBoard` – Abfahrten und Ankünfte (Echtzeit)

```json
{ "meth": "StationBoard",
  "req": { "type": "DEP", "stbLoc": { "lid": "de:03241:11" }, "maxJny": 20,
           "date": "20260929", "time": "190000" } }
```
- `type`: `DEP` = Abfahrten, `ARR` = Ankünfte
- `date`/`time` sind optional; ohne Angabe gilt „jetzt“
- `dur` (Minuten) ist optional und begrenzt das Zeitfenster

Wichtige Felder in `res.jnyL[]`:

| Feld | Bedeutung |
|---|---|
| `jid` | Fahrt-ID, Eingabe für `JourneyDetails` |
| `date` | Betriebstag |
| `dirTxt` | Richtung/Ziel |
| `prodX` | Linie, siehe `common.prodL` |
| `stbStop.dTimeS` / `dTimeR` | Soll- und Ist-Abfahrt |
| `stbStop.dCncl` | Ausfall |
| `stbStop.locX` | konkreter Steig, siehe `common.locL` |
| `msgL` | Hinweise |

Beispiel aus dem Test: Linie 7 Richtung Misburg, Soll 17:47, Ist 19:21, also **+95 min**.

### 4.4 `JourneyDetails` – Fahrtverlauf

```json
{ "meth": "JourneyDetails", "req": { "jid": "<jid aus StationBoard>", "getPolyline": false } }
```
Ergebnis: `res.journey.stopL[]`, je Halt `locX`, `aTimeS/aTimeR`, `dTimeS/dTimeR`, `aCncl/dCncl`.
Im Test: Linie 7 mit 33 Halten, Echtzeit an jedem Halt.

> Die IDs aus `JourneyGeoPos` (Format `gvh:03100:_:H:j26:482`) nimmt `JourneyDetails` **nicht** an;
> es kommt `FAIL / Internal Error`. Nur `jid`s aus `StationBoard` funktionieren.

### 4.5 `LineMatch` – Liniensuche

```json
{ "meth": "LineMatch", "req": { "input": "10" } }
```
Ergebnis: `res.lineL[]` mit `lineId`, `prodX`, `dirRefL` (Richtungen, siehe `common.dirL`).
Die Suche ist bundesweit; auf GVH-Linien filtert man über das `gvh:`-Präfix in der dekodierten
`lineId`. Beispiel: „10“ liefert GVH-Linie 10 (Ahlem ⇄ Hauptbahnhof/ZOB), RE10 und Treffer vom Bodensee.
Zusätzliche Felder wie `maxNum` oder `getPolyline` führen zu HTTP 500.

### 4.6 `JourneyGeoPos` – Fahrzeuge im Kartenausschnitt

```json
{ "meth": "JourneyGeoPos",
  "req": { "rect": { "llCrd": { "x": 9700000, "y": 52350000 }, "urCrd": { "x": 9780000, "y": 52400000 } },
           "maxJny": 300, "onlyRT": false, "perSize": 30000, "perStep": 5000, "trainPosMode": "CALC" } }
```
Ergebnis: `res.jnyL[]` mit `jid`, `pos` (aktuelle Position), `dirTxt`, `prodX` und `ani`
(Stützpunkte für eine flüssige Animation über `perSize` ms). Im Test waren es rund 220–240 Fahrzeuge
im Raum Hannover.
**Wichtig:** `onlyRT` und die verschiedenen `trainPosMode`-Werte liefern identische Ergebnisse.
Die Positionen sind **berechnet** (Fahrplan + Prognose), es sind keine GPS-Meldungen.

### 4.7 Nicht nutzbar

| Methode/Option | Ergebnis |
|---|---|
| `HimSearch` (Störungsmeldungen) | `FAIL / Internal Error`, getestet mit mehreren Parametervarianten |
| Polylinien (`getPolyline`, `polyEnc`) | HTTP 500 oder leere `crdEncYX` |

---

## 5. Minimalbeispiele

### 5.1 curl

```bash
AID=IKSEvZ1SsVdfIRSK
curl -s -X POST "https://gvh.hafas.de/hamm?hciMethod=StationBoard&hciVersion=1.62&hciClientType=WEB&hciClientVersion=10109&aid=$AID&rnd=$(date +%s)000" \
  -H "Content-Type: application/json" \
  -d '{"ver":"1.62","lang":"deu","auth":{"type":"AID","aid":"'$AID'"},
       "client":{"id":"HAFAS","type":"WEB","name":"webapp","l":"vs_webapp","v":10109},
       "formatted":false,
       "svcReqL":[{"meth":"StationBoard","req":{"type":"DEP","stbLoc":{"lid":"de:03241:11"},"maxJny":5},"id":"1|1|"}]}'
```

### 5.2 Python ohne Bibliothek

```python
import json, time, urllib.parse, urllib.request

AID = json.load(urllib.request.urlopen("https://gvh.hafas.de/config/webapp.config.json"))["hciAuth"]["aid"]

def hafas(meth, req):
    body = {"ver": "1.62", "lang": "deu", "auth": {"type": "AID", "aid": AID},
            "client": {"id": "HAFAS", "type": "WEB", "name": "webapp", "l": "vs_webapp", "v": 10109},
            "formatted": False, "svcReqL": [{"meth": meth, "req": req, "id": "1|1|"}]}
    q = urllib.parse.urlencode({"hciMethod": meth, "hciVersion": "1.62", "hciClientType": "WEB",
                                "hciClientVersion": 10109, "aid": AID, "rnd": int(time.time() * 1000)})
    r = urllib.request.Request("https://gvh.hafas.de/hamm?" + q, json.dumps(body).encode(),
                               {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))["svcResL"][0]["res"]

res = hafas("StationBoard", {"type": "DEP", "stbLoc": {"lid": "de:03241:11"}, "maxJny": 5})
for j in res["jnyL"]:
    line = res["common"]["prodL"][j["prodX"]]["nameS"]
    s = j["stbStop"]
    print(line, j["dirTxt"], s["dTimeS"], s.get("dTimeR", "keine Echtzeit"))
```

---

## 6. Nutzung des Prototyps

Der Prototyp nimmt die Rohdaten aus Abschnitt 3 und 4 auseinander und liefert **flache,
fertig aufbereitete JSON-Objekte**: Zeiten im ISO-Format, Verspätung in Minuten, Farben als Hex-Wert,
Koordinaten in Grad. Er braucht nur Python ≥ 3.10 und keine weiteren Pakete.

### 6.1 Python-Bibliothek `gvh/hafas.py`

```python
from gvh.hafas import Gvh
g = Gvh()                                        # liest die AID automatisch

stops = g.search_stops("Kröpcke")                # [{id, lid, name, type, coord{lat,lon}, distance}]
near  = g.nearby_stops(52.3745, 9.7386, 500)     # dito, mit distance in Metern
deps  = g.departures("de:03241:11", limit=20)    # Echtzeit-Abfahrten
arrs  = g.departures("de:03241:11", arrivals=True)
trip  = g.journey(deps[0]["journeyId"])          # Fahrtverlauf
lines = g.lines("10")                            # nur GVH-Linien (only_gvh=False für alle)
cars  = g.vehicles(52.35, 9.70, 52.40, 9.78)     # Süd, West, Nord, Ost
```

Ein Abfahrtsobjekt sieht so aus (Beispiel aus dem Test):

```json
{
  "journeyId": "eyJkYXRlIjoiMjAyNjA5MjkiLCJ0aW1lIjoiMTc0Ny...",
  "line": { "name": "7", "category": "Stadtbahn", "class": "Stadtbahn",
            "operator": "ÜSTRA AG", "color": "#3765ae", "textColor": "#ffffff", "lineId": "..." },
  "direction": "Hannover/Misburg",
  "plannedTime": "2026-09-29T17:47:00",
  "realtimeTime": "2026-09-29T19:21:54",
  "delayMinutes": 95,
  "hasRealtime": true,
  "cancelled": false,
  "platform": null,
  "stop": "Hannover/Kröpcke",
  "messages": []
}
```

Fehler lösen eine `HafasError` aus, mit Methodenname und HTTP-Status oder HAFAS-Fehlertext.

### 6.2 JSON-API (`python server.py [port]`, Standard: 8080)

| Endpoint | Parameter | Cache |
|---|---|---|
| `GET /api/stops` | `q`, `limit` | 5 min |
| `GET /api/stops/nearby` | `lat`, `lon`, `radius`, `limit` | 5 min |
| `GET /api/departures` | `stop`, `limit`, `when` (ISO), `arrivals=1` | 20 s |
| `GET /api/journey` | `id` | 20 s |
| `GET /api/lines` | `q`, `all=1` | 5 min |
| `GET /api/vehicles` | `south`, `west`, `north`, `east`, `limit` | 10 s |

Statuscodes: `400` = fehlender oder falscher Parameter, `502` = Fehler vom HAFAS-Backend.
Unter `/` liefert der Server zusätzlich die Weboberfläche aus: Abfahrtstafel, Fahrtverlauf auf der Karte,
Liniensuche und Live-Fahrzeugkarte.

### 6.3 Kommandozeile

```
python cli.py stops Kröpcke
python cli.py deps Kröpcke -n 10          # oder deps de:03241:11, --arrivals
python cli.py journey <journeyId>
python cli.py lines 10 [--all]
python cli.py nearby 52.3745 9.7386 -r 300
python cli.py vehicles 52.35 9.70 52.40 9.78
python cli.py --json deps Kröpcke         # Rohdaten als JSON
```

---

## 7. Einsatzmöglichkeiten

- **Abfahrtsmonitor** für einen Standort (Info-Bildschirm, Büro, Haltestelle): `/api/departures`
  regelmäßig abfragen, alle 20–30 s reicht.
- **Verspätungsanalyse:** Abfahrten zyklisch abrufen und `delayMinutes` je Linie oder Tageszeit
  speichern. Mit `journey()` lassen sich Verspätungen entlang einer Strecke verfolgen.
- **Netz- und Stammdaten:** Haltestellen mit DHID und Koordinaten über `nearby_stops`
  rastermäßig einsammeln, Linien über `lines()` mit Betreiber und Richtungen.
- **Live-Karte / Flottenübersicht:** `vehicles()` für einen Kartenausschnitt, nach Linie filtern.
- **Integration:** Die JSON-API lässt sich direkt aus Dashboards (Grafana, Home Assistant, eigenes Frontend)
  oder anderen Diensten ansprechen.

---

## 8. Grenzen und Hinweise

1. **Inoffizielle Schnittstelle.** Das Backend gehört zur öffentlichen Webauskunft, ist aber keine
   dokumentierte API. Methoden, Parameter oder die AID können sich ohne Ankündigung ändern.
2. **Nutzungsbedingungen.** Für einen Produktiv- oder kommerziellen Einsatz sollte die Nutzung mit
   GVH/ÜSTRA abgestimmt werden. Offizielle Alternativen wären GVH Connect oder die offenen Soll- und
   Echtzeitdaten in den Formaten GTFS/GTFS-RT bzw. NeTEx/SIRI der niedersächsischen Landesplattform.
3. **Last begrenzen.** Nicht öfter als nötig abfragen; der Prototyp speichert Antworten deshalb
   kurz zwischen. Große Rasterabfragen sollten gedrosselt werden.
4. **Fahrzeugpositionen** sind berechnet und nicht per GPS gemessen.
5. **Keine Störungsmeldungen** über `HimSearch`, **keine Polylinien.** Die Karte verbindet deshalb
   die Haltestellenkoordinaten.
6. **`platform`** war bei den Testabfragen meist leer. Den Steig erkennt man stattdessen am
   Haltestellennamen bzw. an der Steig-ID über `locX`.
7. **`class`** ist bei S-Bahnen ungenau; besser `category` verwenden.
