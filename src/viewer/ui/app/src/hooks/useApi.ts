import { useState, useEffect, useCallback } from 'react';

interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * Generic hook for fetching data from the API
 */
export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = []
): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [fetcher]);

  useEffect(() => {
    fetch();
  }, [...deps, fetch]);

  return { data, loading, error, refetch: fetch };
}

/**
 * Hook for lazy data fetching (manual trigger)
 */
export function useLazyApi<T, Args extends unknown[]>(
  fetcher: (...args: Args) => Promise<T>
): [
  (...args: Args) => Promise<T>,
  { data: T | null; loading: boolean; error: string | null }
] {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(
    async (...args: Args): Promise<T> => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetcher(...args);
        setData(result);
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'An error occurred';
        setError(errorMessage);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [fetcher]
  );

  return [execute, { data, loading, error }];
}
