# Button+ nodes for Node-RED

[npm version](https://www.npmjs.com/package/@nielseulink/node-red-contrib-buttonplus)
[Node-RED](https://nodered.org/)
[Node.js](https://nodejs.org/)
[License: MIT](LICENSE)

Control [Button+](https://buttonplus.nl/) devices from Node-RED over MQTT. Custom nodes with a shared config, configurable output properties, and optional debug output.

---

## Table of contents

- [Features](#-features)
- [Installation](#-installation)
  - [Node-RED palette manager](#node-red-palette-manager)
  - [npm](#npm)
- [Initial setup](#-initial-setup)
- [Nodes overview](#-nodes-overview)
- [Output properties](#-output-properties)
- [Message precedence](#-message-precedence)
- [MQTT topics](#-mqtt-topics)
- [Example flow](#-example-flow)
- [Development](#-development)
- [Requirements](#-requirements)
- [Links](#-links)

---

## ✨ Features


| Area                  | What you get                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------ |
| **Config**            | Shared Button+ settings linked to an existing `mqtt-broker` config (prefix, device, QoS, retain) |
| **LED**               | Front/wall/both LEDs — color, brightness, steady or pulse                                        |
| **Click**             | Short and long press on separate outputs; optional LED feedback after press                      |
| **Update button**     | Top label, value label, SVG and optional LED per button                                          |
| **Update display**    | Label, value, unit and SVG per display item                                                      |
| **Update global**     | Active page and display brightness                                                               |
| **Output properties** | Home Assistant–style mapping: choose what goes on `msg` (click events, metadata, debug)          |
| **Debug output**      | Optional `buttonplus_debug` with input message and all MQTT messages sent                        |


---

## 📦 Installation

Restart Node-RED after any installation method below.

### Node-RED palette manager

1. Open **Manage palette → Install**
2. Click the **refresh** icon (↻) to reload the catalogue
3. Search for **buttonplus** or **@nielseulink/node-red-contrib-buttonplus**
4. Click **Install** and restart Node-RED

> **Note:** The [Flow Library listing](https://flows.nodered.org/node/@nielseulink/node-red-contrib-buttonplus) and the Install tab catalogue are synced separately. After a new release it can take a few hours before the package appears in **Manage palette → Install**. Use [npm](#npm) if you want to install immediately.

### npm

```bash
cd ~/.node-red
npm install @nielseulink/node-red-contrib-buttonplus
```

---

## 🔧 Initial setup

1. Add or select an existing **mqtt-broker** config node (Node-RED built-in MQTT nodes).
2. Add a **Button+ config** node and link it to that broker.
3. Set **Topic prefix** (default `buttonplus`) and **Device** (e.g. `buttonplus_1`).
4. Drag nodes from the **Button+** palette category and link each to the shared config node.
5. Deploy.

Each functional node can override page, button and other fields at runtime via `msg` properties.

---

## 📊 Nodes overview


| Node                       | Inputs | Outputs | Purpose                                                     |
| -------------------------- | ------ | ------- | ----------------------------------------------------------- |
| **Button+ config**         | —      | —       | Shared MQTT broker link, prefix, device id, QoS, retain     |
| **Button+ LED**            | 1      | 1       | Set button LED color, brightness, on/off/pulse              |
| **Button+ click**          | 1      | 2       | Listen for short press (output 1) and long press (output 2) |
| **Button+ update button**  | 1      | 1       | Update top label, value label, SVG; optional LED            |
| **Button+ update display** | 1      | 1       | Update display item label, value, unit, SVG                 |
| **Button+ update global**  | 1      | 1       | Set active page and/or display brightness                   |


### Button+ click — input properties


| Property    | Type   | Description                                         |
| ----------- | ------ | --------------------------------------------------- |
| `page`      | number | Button page (re-subscribe at runtime)               |
| `button`    | number | Button number                                       |
| `led`       | string | `none`, `front`, `wall` or `both` — LED after press |
| `led_color` | string | e.g. `#a10303`                                      |
| `led_delay` | string | number                                              |


### Button+ LED / update button — shared LED fields

Same `page`, `button`, `led`, `led_color`, `led_delay` as above. LED node also supports `led_brightness` (0–100).

### Button+ update button — label fields


| Property | Type   | Description                               |
| -------- | ------ | ----------------------------------------- |
| `label`  | string | Top label — empty string clears on device |
| `value`  | string | Main label/value — empty clears           |
| `svg`    | string | Button SVG — empty clears                 |


Empty node configuration values are **always published** (as empty strings) to clear fields on the device.

### Button+ update display — fields


| Property                        | Type   | Description                                                              |
| ------------------------------- | ------ | ------------------------------------------------------------------------ |
| `item`                          | number | Display item number                                                      |
| `label`, `value`, `unit`, `svg` | string | Published only when set in `msg` or node config; `msg.field = ""` clears |


### Button+ update global — fields


| Property     | Type   | Description              |
| ------------ | ------ | ------------------------ |
| `page`       | number | Active page → `page/set` |
| `brightness` | number | 0–100 → `brightness/set` |


Fields empty in both node config and `msg` are skipped (nothing published for that field).

---

## 🎛️ Output properties

All nodes support **Output properties**: map a destination `msg` field (left) to a source (right), similar to the [Home Assistant Node-RED nodes](https://zachowj.github.io/node-red-contrib-home-assistant-websocket/guide/output-properties.html).

### Default behaviour


| Node type              | Empty output properties                |
| ---------------------- | -------------------------------------- |
| **Click**              | Sends an empty message `{}`            |
| **LED / update nodes** | Pass-through: incoming `msg` unchanged |


### Click node — available sources


| Source             | Description                                                                      |
| ------------------ | -------------------------------------------------------------------------------- |
| `payload`          | Original MQTT payload from the device (usually `{ "event_type": "shortpress" }`) |
| `topic`            | MQTT topic the event was received on                                             |
| `device`           | Device id from config                                                            |
| `button_page`      | Page of the pressed button (not the device active page)                          |
| `button`           | Button number                                                                    |
| `event_type`       | `shortpress` or `longpress`                                                      |
| `buttonplus`       | Metadata object: `device`, `button_page`, `button`, `event_type`, `topic`        |
| `buttonplus_debug` | Debug: received MQTT in `input`, LED MQTT in `mqtt`                              |


**Tip:** map `payload` + `buttonplus` for a practical default. Use `button_page` instead of `msg.page` so click output does not override page settings on other Button+ nodes.

### Action nodes — debug source

Add a row such as `msg.buttonplus_debug` = **debug info (input + mqtt sent)** to attach:

```json
{
  "input": { /* incoming msg snapshot */ },
  "mqtt": [
    { "topic": "...", "payload": "...", "qos": 0, "retain": false }
  ]
}
```

---

## 📐 Message precedence

For all nodes:

`**msg` property → node configuration → fallback default**

Explicit falsy values in `msg` (`false`, `0`, `""`) are respected and are **not** replaced by defaults.

Device id is always taken from the linked **Button+ config** node, not from individual nodes.

---

## 📡 MQTT topics

With prefix `buttonplus` and device `buttonplus_1`:


| Action                   | Topic pattern                                                                      |
| ------------------------ | ---------------------------------------------------------------------------------- |
| Button press (subscribe) | `buttonplus/buttonplus_1/button/{button}-{page}/pushbutton`                        |
| Button top label         | `.../button/{button}-{page}/toplabel/set`                                          |
| Button value label       | `.../button/{button}-{page}/label/set`                                             |
| Button SVG               | `.../button/{button}-{page}/svg/set`                                               |
| Button LED               | `.../button/{button}-{page}/led/{front or wall}/rgb/set`, `.../brightness/set`, `.../on/set` |
| Display item             | `.../displayitem/{item}/label/set`, `.../value/set`, `.../unit/set`, `.../svg/set` |
| Global page              | `buttonplus/buttonplus_1/page/set`                                                 |
| Global brightness        | `buttonplus/buttonplus_1/brightness/set`                                           |


LED `none` on update/click nodes runs the full off sequence on **front** and **wall**.

---

## 📋 Example flow

An example is included at `[examples/basic-flow.json](examples/basic-flow.json)`.

After installation it also appears in Node-RED under:

**Menu → Import → Import example flow → @nielseulink/node-red-contrib-buttonplus → basic-flow**

The example demonstrates MQTT broker setup, shared config, LED pulse, and button click with debug nodes.

---

## 🛠️ Development

```bash
npm install
npm test
npm pack
```

Tests cover MQTT payload parsing, LED actions, topic building, resolve helpers, output properties and debug output.

Project layout:


| Path         | Purpose                                                       |
| ------------ | ------------------------------------------------------------- |
| `nodes/`     | Runtime and editor definitions                                |
| `nodes/lib/` | Shared logic (topics, LED, resolve, output properties)        |
| `resources/` | Editor JavaScript served to Node-RED (`buttonplus-editor.js`) |
| `examples/`  | Importable example flow                                       |
| `test/`      | Mocha tests                                                   |


---

## ✅ Requirements


| Requirement        | Version                                   |
| ------------------ | ----------------------------------------- |
| **Node-RED**       | 3.0+                                      |
| **Node.js**        | 18+                                       |
| **MQTT broker**    | Existing `mqtt-broker` config in Node-RED |
| **Button+ device** | MQTT-enabled, reachable from Node-RED     |


No runtime npm dependencies — the package is self-contained.

---

## 🔗 Links


| Resource        | URL                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Repository      | [github.com/nielseulink/buttonplus-nodered](https://github.com/nielseulink/buttonplus-nodered)                                             |
| npm package     | [@nielseulink/node-red-contrib-buttonplus](https://www.npmjs.com/package/@nielseulink/node-red-contrib-buttonplus)                         |
| Flow Library    | [flows.nodered.org/node/@nielseulink/node-red-contrib-buttonplus](https://flows.nodered.org/node/@nielseulink/node-red-contrib-buttonplus) |
| Button+ product | [buttonplus.nl](https://buttonplus.nl/)                                                                                                    |
| Node-RED        | [nodered.org](https://nodered.org/)                                                                                                        |
| Example flow    | `[examples/basic-flow.json](examples/basic-flow.json)`                                                                                     |


---

## License

MIT — see [LICENSE](LICENSE).