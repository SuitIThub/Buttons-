import { useEffect, useRef, useState } from "react";
import { WsEvent } from "./types";

/**
 * Hält eine WebSocket-Verbindung zum Backend und liefert eingehende Events.
 * Reconnectet automatisch bei Verbindungsabbruch.
 */
export function useWs(onEvent: (ev: WsEvent) => void) {
  const [connected, setConnected] = useState(false);
  const cbRef = useRef(onEvent);
  cbRef.current = onEvent;

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        if (!closed) retry = setTimeout(connect, 3000);
      };
      ws.onerror = () => ws?.close();
      ws.onmessage = (e) => {
        try {
          cbRef.current(JSON.parse(e.data) as WsEvent);
        } catch {
          /* ignore */
        }
      };
    };

    // Kleine Verzögerung, damit React-StrictMode (Doppel-Mount im Dev) die
    // Verbindung wieder abräumt, bevor der Socket überhaupt aufgeht. Das
    // vermeidet die harmlosen "ws proxy" ECONNABORTED-Meldungen von Vite.
    const start = setTimeout(connect, 120);

    return () => {
      closed = true;
      clearTimeout(start);
      clearTimeout(retry);
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  return { connected };
}
