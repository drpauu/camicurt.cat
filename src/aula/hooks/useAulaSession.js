import { useEffect, useState } from "react";
import { getAulaSessionBundle } from "../lib/aulaApi.js";

export default function useAulaSession(sessionId, { pollMs = 0 } = {}) {
  const [state, setState] = useState({
    loading: true,
    bundle: null,
    error: null
  });

  useEffect(() => {
    if (!sessionId) {
      setState({ loading: false, bundle: null, error: new Error("Falta la sessio.") });
      return undefined;
    }
    let cancelled = false;
    let timer = null;

    async function load(silent = false) {
      if (!silent) setState((prev) => ({ ...prev, loading: true }));
      try {
        const bundle = await getAulaSessionBundle(sessionId);
        if (!cancelled) setState({ loading: false, bundle, error: null });
      } catch (error) {
        if (!cancelled) setState({ loading: false, bundle: null, error });
      }
    }

    load();
    if (pollMs > 0) {
      timer = setInterval(() => load(true), pollMs);
    }
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [sessionId, pollMs]);

  return state;
}
