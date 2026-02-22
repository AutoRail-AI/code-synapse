import { useState, useEffect, useRef, useCallback } from 'react';
import type { LedgerEntry } from '../api/client';

const MAX_ENTRIES = 100;
const MAX_RECONNECT_DELAY = 30000;

export function useLedgerStream() {
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const reconnectDelay = useRef(1000);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource('/api/ledger/stream');
    esRef.current = es;

    es.onopen = () => {
      setConnected(true);
      setError(null);
      reconnectDelay.current = 1000;
    };

    es.onmessage = (event) => {
      try {
        const entry = JSON.parse(event.data) as LedgerEntry;
        setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES));
      } catch {
        // ignore malformed messages
      }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;

      // Reconnect with exponential backoff
      const delay = reconnectDelay.current;
      reconnectDelay.current = Math.min(delay * 2, MAX_RECONNECT_DELAY);
      setError(`Disconnected. Reconnecting in ${Math.round(delay / 1000)}s...`);

      reconnectTimer.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, [connect]);

  return { entries, connected, error };
}
