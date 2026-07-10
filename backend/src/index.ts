import { PORT } from "./config.js";
import { DeviceManager } from "./device/index.js";
import { buildServer } from "./server.js";

// Sicherheitsnetz: Der Server spricht mit flaky Hardware (Gerät rebootet nach
// Config-Push, kappt Verbindungen → ECONNRESET). Eine unbehandelte Rejection
// darf den langlaufenden Prozess nicht killen – loggen statt crashen.
process.on("unhandledRejection", (reason) => {
  console.error("[UnhandledRejection]", reason);
});

async function main(): Promise<void> {
  console.log("[Startup] Initializing Button+ Manager v2.0 (Refactored)...");

  const manager = new DeviceManager();
  await manager.init();

  const server = await buildServer(manager);
  server.listen(PORT, () => {
    console.log(`✓ Button+ Manager läuft auf http://0.0.0.0:${PORT}`);
    console.log(`  MQTT: ${manager.getMqttStatus().connected ? "✓ Connected" : "✗ Disconnected"}`);
    console.log(`  Runtime: ${manager.getRuntimeState().active ? "✓ Active" : "✗ Inactive"}`);
  });
}

main().catch((err) => {
  console.error("Startfehler:", err);
  process.exit(1);
});
