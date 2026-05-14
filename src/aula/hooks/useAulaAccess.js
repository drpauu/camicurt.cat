import { useEffect, useState } from "react";
import { getAulaAccess } from "../lib/aulaApi.js";

export default function useAulaAccess() {
  const [state, setState] = useState({
    loading: true,
    access: null,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true }));
    getAulaAccess()
      .then((access) => {
        if (!cancelled) setState({ loading: false, access, error: null });
      })
      .catch((error) => {
        if (!cancelled) setState({ loading: false, access: null, error });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
