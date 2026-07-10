/**
 * Erzeugt eine UUID-v4-ähnliche ID. Nutzt `crypto.randomUUID`, wenn verfügbar
 * (secure context: https oder localhost). Über `http://<ip>` ist das NICHT
 * verfügbar — dort greift der Fallback über `getRandomValues` bzw. `Math.random`.
 * So funktioniert das Anlegen von Befehlen/Szenen/… auch auf dem Server.
 */
export function uid(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();

  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Version (4) und Variant-Bits setzen.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = [...bytes].map((b) => b.toString(16).padStart(2, "0"));
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}
