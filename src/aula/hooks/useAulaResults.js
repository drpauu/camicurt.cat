import useAulaSession from "./useAulaSession.js";

export default function useAulaResults(sessionId, options = {}) {
  const state = useAulaSession(sessionId, options);
  return {
    ...state,
    results: state.bundle?.results || [],
    participants: state.bundle?.participants || []
  };
}
