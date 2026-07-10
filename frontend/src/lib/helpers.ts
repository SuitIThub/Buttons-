import { BPConnector } from "./types";

export const ConnectorType = { BAR: 1, DISPLAY: 2, DISPLAY_V2: 3 } as const;

export function decimalToHex(dec?: number): string {
  const v = Math.max(0, Math.min(0xffffff, Math.floor(dec ?? 0)));
  return "#" + v.toString(16).padStart(6, "0");
}

export function hexToDecimal(hex: string): number {
  const clean = hex.replace("#", "");
  return clean.length === 6 ? parseInt(clean, 16) : 0;
}

export interface PhysicalButton {
  id: number;
  connectorIndex: number;
  side: "left" | "right";
  connectorType: number;
}

/**
 * Ordnet die 0..7 Button-IDs den physischen Modulen zu. Pro Connector zwei
 * Buttons (links = index*2, rechts = index*2+1), passend zum Firmware-Schema.
 */
export function mapButtons(connectors: BPConnector[] | undefined): PhysicalButton[] {
  const out: PhysicalButton[] = [];
  (connectors ?? []).forEach((c, i) => {
    out.push({ id: i * 2, connectorIndex: i, side: "left", connectorType: c.type });
    out.push({ id: i * 2 + 1, connectorIndex: i, side: "right", connectorType: c.type });
  });
  return out;
}

export function connectorLabel(type: number): string {
  if (type === ConnectorType.DISPLAY || type === ConnectorType.DISPLAY_V2) return "Display-Modul";
  if (type === ConnectorType.BAR) return "Button-Modul";
  return `Modul (Typ ${type})`;
}
