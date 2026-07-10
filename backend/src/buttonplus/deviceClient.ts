/**
 * Client für die lokale HTTP-API des Button+ Geräts.
 *   GET  http://<ip>/config      -> aktuelle Konfiguration als JSON (roh)
 *   POST http://<ip>/configsave  -> neue Konfiguration übernehmen
 *
 * Der Client liefert/erwartet die ROHE Gerätekonfiguration; die Übersetzung in
 * die interne Form (und den passenden Firmware-Dialekt) übernimmt der Manager
 * über buttonplus/schema.ts.
 */
export class DeviceClient {
  constructor(private ip: string) {}

  private base(): string {
    return `http://${this.ip}`;
  }

  async fetchConfig(timeoutMs = 8000): Promise<Record<string, unknown>> {
    if (!this.ip) throw new Error("Keine Geräte-IP konfiguriert.");
    const res = await withTimeout(fetch(`${this.base()}/config`), timeoutMs);
    if (!res.ok) throw new Error(`Gerät antwortete mit HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error("Antwort des Geräts war kein gültiges JSON.");
    }
  }

  async pushConfig(config: unknown, timeoutMs = 10000): Promise<string> {
    if (!this.ip) throw new Error("Keine Geräte-IP konfiguriert.");
    const res = await withTimeout(
      fetch(`${this.base()}/configsave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }),
      timeoutMs,
    );
    if (!res.ok) throw new Error(`Speichern fehlgeschlagen: HTTP ${res.status}`);
    return await res.text();
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  // Falls der Timeout das Race gewinnt, bleibt `promise` in flight und kann
  // später rejecten (z. B. ECONNRESET, wenn das Gerät die Verbindung kappt).
  // Diese späte Ablehnung MUSS abgefangen werden, sonst crasht sie den Prozess
  // als unhandled rejection.
  promise.catch(() => {});

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Zeitüberschreitung nach ${ms} ms`)), ms);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
