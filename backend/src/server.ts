import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { createServer, Server } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { DeviceManager } from "./device/index.js";
import { searchIcons, lookupIcons } from "./device/IconResolver.js";
import { gvh } from "./transit/GvhClient.js";
import { AppSettings } from "./buttonplus/types.js";
import { evaluate, interpolate } from "./engine/expr.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.resolve(__dirname, "public");

function asyncHandler(fn: (req: Request, res: Response) => Promise<unknown>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function maskSettings(s: AppSettings) {
  return { ...s, mqttPassword: "", hasMqttPassword: Boolean(s.mqttPassword) };
}

export async function buildServer(manager: DeviceManager): Promise<Server> {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "4mb" }));

  const api = express.Router();

  // ---- Status & Einstellungen ----------------------------------------------
  api.get(
    "/status",
    asyncHandler(async (_req, res) => {
      const cfg = manager.getConfig();
      res.json({
        mqtt: manager.getMqttStatus(),
        settings: maskSettings(manager.store.getSettings()),
        nav: manager.store.getNav(),
        ledDim: manager.store.getLedDim(),
        device: {
          id: cfg?.info?.id ?? null,
          firmware: cfg?.info?.firmware ?? null,
          hasConfig: Boolean(cfg),
          connectors: cfg?.info?.connectors ?? [],
        },
        runtime: manager.getRuntimeState(),
        undeployed: manager.hasUndeployedChanges(),
      });
    }),
  );

  api.get("/settings", asyncHandler(async (_req, res) => res.json(maskSettings(manager.store.getSettings()))));

  api.put(
    "/settings",
    asyncHandler(async (req, res) => {
      const patch = req.body as Partial<AppSettings> & { mqttPassword?: string };
      if (patch.mqttPassword === "" || patch.mqttPassword === undefined) delete patch.mqttPassword;
      await manager.store.updateSettings(patch);
      manager.reconnectMqtt();
      manager.refreshUndeployed();
      res.json(maskSettings(manager.store.getSettings()));
    }),
  );

  api.get("/nav", asyncHandler(async (_req, res) => res.json(manager.store.getNav())));
  api.put(
    "/nav",
    asyncHandler(async (req, res) => {
      const nav = await manager.store.updateNav(req.body);
      manager.startRuntime();
      res.json(nav);
    }),
  );

  api.get("/led-dim", asyncHandler(async (_req, res) => res.json(manager.store.getLedDim())));
  api.put(
    "/led-dim",
    asyncHandler(async (req, res) => {
      const ledDim = await manager.store.updateLedDim(req.body);
      manager.applyLedDim();
      res.json(ledDim);
    }),
  );

  // ---- Gerätekonfiguration (roh) -------------------------------------------
  api.get(
    "/config",
    asyncHandler(async (_req, res) =>
      res.json({ config: manager.getConfig(), compiled: manager.getCompiledOutput() }),
    ),
  );

  api.post(
    "/config/pull",
    asyncHandler(async (_req, res) => {
      const cfg = await manager.pullConfig();
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json({ config: cfg });
    }),
  );

  // Integrierte Sensoren (für die sensorRead-Auswahl in der UI).
  api.get("/sensors", asyncHandler(async (_req, res) => res.json(manager.getSensors())));

  // ---- Export / Import der gesamten Konfiguration --------------------------
  api.get(
    "/export",
    asyncHandler(async (_req, res) => {
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      res.setHeader("Content-Disposition", `attachment; filename="buttonsplus-config-${stamp}.json"`);
      res.json(manager.store.exportData());
    }),
  );

  api.post(
    "/import",
    asyncHandler(async (req, res) => {
      await manager.store.importData(req.body);
      manager.reconnectMqtt();
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json({ ok: true });
    }),
  );

  // ---- Deploy: Modell -> Gerät ---------------------------------------------
  api.post(
    "/deploy",
    asyncHandler(async (_req, res) => {
      const result = await manager.deploy();
      res.json({ ok: true, ...result });
    }),
  );

  // ---- Seiten ---------------------------------------------------------------
  api.get("/pages", asyncHandler(async (_req, res) => res.json(manager.store.getPages())));

  api.post(
    "/pages",
    asyncHandler(async (req, res) => {
      const page = await manager.store.savePage(req.body);
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json(page);
    }),
  );

  api.put(
    "/pages/:id",
    asyncHandler(async (req, res) => {
      const page = await manager.store.savePage({ ...req.body, id: req.params.id });
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json(page);
    }),
  );

  api.delete(
    "/pages/:id",
    asyncHandler(async (req, res) => {
      await manager.store.deletePage(req.params.id);
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json({ ok: true });
    }),
  );

  api.post(
    "/pages/reorder",
    asyncHandler(async (req, res) => {
      const pages = await manager.store.reorderPages(req.body.orderedIds ?? []);
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json(pages);
    }),
  );

  // ---- Szenen ---------------------------------------------------------------
  api.get("/scenes", asyncHandler(async (_req, res) => res.json(manager.store.getScenes())));

  api.get(
    "/scenes/:id",
    asyncHandler(async (req, res) => {
      const scene = manager.store.getScene(req.params.id);
      if (!scene) return res.status(404).json({ error: "Szene nicht gefunden" });
      res.json(scene);
    }),
  );

  // Speichern deployt nicht aufs Gerät – Modell sichern + Runtime aktualisieren.
  // Deploy-Flag nur, wenn sich die Gerätekonfiguration wirklich ändert
  // (Layout, Seiten, welche Buttons existieren). Event-Gruppen und Texte nicht.
  api.post(
    "/scenes",
    asyncHandler(async (req, res) => {
      const scene = await manager.store.saveScene(req.body);
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json(scene);
    }),
  );

  api.put(
    "/scenes/:id",
    asyncHandler(async (req, res) => {
      const scene = await manager.store.saveScene({ ...req.body, id: req.params.id });
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json(scene);
    }),
  );

  api.delete(
    "/scenes/:id",
    asyncHandler(async (req, res) => {
      await manager.store.deleteScene(req.params.id);
      manager.startRuntime();
      manager.refreshUndeployed();
      res.json({ ok: true });
    }),
  );

  // Event-Gruppe einer Szene manuell ausführen (z. B. zum Testen).
  api.post(
    "/scenes/:id/groups/:groupId/run",
    asyncHandler(async (req, res) => {
      const ok = manager.runGroup(req.params.id, req.params.groupId);
      res.status(ok ? 200 : 404).json({ ok });
    }),
  );

  // ---- Variablen ------------------------------------------------------------
  api.get("/variables", asyncHandler(async (_req, res) => res.json(manager.store.getVariables())));

  api.put(
    "/variables",
    asyncHandler(async (req, res) => {
      const vars = await manager.store.setVariables(req.body.variables ?? req.body ?? []);
      manager.startRuntime();
      res.json(vars);
    }),
  );

  // Laufzeitwert einer Variable setzen (ohne Neuinitialisierung), z. B. zum Testen.
  api.post(
    "/variables/:name/value",
    asyncHandler(async (req, res) => {
      const ok = manager.vars.set(req.params.name, req.body.value);
      res.json({ ok });
    }),
  );

  // Variable umbenennen (zieht Referenzen in Szenen mit).
  api.post(
    "/variables/:name/rename",
    asyncHandler(async (req, res) => {
      const newName = String(req.body.newName ?? "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
        return res.status(400).json({ error: "Ungültiger Variablenname." });
      }
      await manager.renameVariable(req.params.name, newName);
      res.json({ ok: true, variables: manager.store.getVariables() });
    }),
  );

  // ---- Icon-Katalog (@mdi/js) ------------------------------------------------
  // Suche: /api/icons?q=light&limit=100 — Batch-Auflösung: /api/icons?names=home,menu
  api.get(
    "/icons",
    asyncHandler(async (req, res) => {
      const namesParam = typeof req.query.names === "string" ? req.query.names.trim() : "";
      if (namesParam) {
        const icons = lookupIcons(namesParam.split(","));
        return res.json({ icons, total: icons.length });
      }

      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.trunc(limitRaw))) : 100;
      res.json(searchIcons(String(req.query.q ?? ""), limit));
    }),
  );

  // ---- Fahrplan (GVH/HAFAS) --------------------------------------------------
  // Haltestellensuche für den Fahrplan-Szenentyp: /api/transit/stops?q=Kröpcke
  api.get(
    "/transit/stops",
    asyncHandler(async (req, res) => {
      const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
      if (q.length < 2) return res.status(400).json({ error: "Suchbegriff (q) mit mind. 2 Zeichen nötig" });
      try {
        res.json(await gvh.searchStops(q, 10));
      } catch (err) {
        res.status(502).json({ error: (err as Error).message });
      }
    }),
  );

  // ---- Runtime --------------------------------------------------------------
  api.get("/runtime/state", asyncHandler(async (_req, res) => res.json(manager.getRuntimeState())));

  api.post(
    "/runtime/restart",
    asyncHandler(async (_req, res) => res.json({ ok: manager.startRuntime() })),
  );

  // Ausdruck/Interpolation gegen den aktuellen Variablen-Scope testen.
  api.post(
    "/preview",
    asyncHandler(async (req, res) => {
      const scope = manager.vars.scope();
      try {
        if (typeof req.body.template === "string") {
          res.json({ ok: true, result: interpolate(req.body.template, scope) });
        } else {
          res.json({ ok: true, result: evaluate(String(req.body.expression ?? ""), scope) });
        }
      } catch (e) {
        res.json({ ok: false, error: (e as Error).message });
      }
    }),
  );

  app.use("/api", api);

  app.use("/api", (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message ?? "Interner Fehler" });
  });

  // ---- Statisches Frontend (Produktion) ------------------------------------
  const hasStatic = await fs
    .stat(path.join(STATIC_DIR, "index.html"))
    .then(() => true)
    .catch(() => false);
  if (hasStatic) {
    app.use(express.static(STATIC_DIR));
    app.get("*", (_req, res) => res.sendFile(path.join(STATIC_DIR, "index.html")));
  }

  const httpServer = createServer(app);

  // ---- WebSocket: Live-Updates ---------------------------------------------
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });
  const broadcast = (data: unknown) => {
    const msg = JSON.stringify(data);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    }
  };
  manager.mqtt.on("status", (status) => broadcast({ type: "status", status }));
  manager.mqtt.on("message", (message) => broadcast({ type: "message", message }));

  // Runtime-State live an alle WS-Clients spiegeln.
  manager.onRuntimeState((state) => broadcast({ type: "runtime", state }));

  wss.on("connection", (ws) => {
    ws.send(JSON.stringify({ type: "status", status: manager.getMqttStatus() }));
    ws.send(JSON.stringify({ type: "runtime", state: manager.getRuntimeState() }));
  });

  return httpServer;
}
