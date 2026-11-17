import { useCallback, useState } from 'react';

/** Tracks loading / error / data for one async action. */
export function useAsync(fn) {
  const [state, setState] = useState({ loading: false, error: null, data: null });
  const run = useCallback(async (...args) => {
    setState({ loading: true, error: null, data: null });
    try {
      const data = await fn(...args);
      setState({ loading: false, error: null, data });
      return data;
    } catch (error) {
      setState({ loading: false, error, data: null });
      return undefined;
    }
  }, [fn]);
  const reset = useCallback(() => setState({ loading: false, error: null, data: null }), []);
  return { ...state, run, reset };
}
