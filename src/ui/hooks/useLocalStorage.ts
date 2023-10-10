import React, { useEffect, useRef, useState } from 'react';

export function useLocalStorage<T>(key: string, defaultState: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  // To sync up with SSR/SSG, we need to make subsequent load on the client side.
  const [firstLoadDone, setFirstLoadDone] = useState(false);

  const [value, setValue] = useState<T>(defaultState);

  useEffect(() => {
    if (firstLoadDone) {
      return;
    }

    try {
      const value = localStorage.getItem(key);
      if (value) {
        setValue(JSON.parse(value) as T);
      }
    } catch (error) {
      if (typeof window !== 'undefined') {
        console.error(error);
      }
    } finally {
      setFirstLoadDone(true);
    }
  }, [key, defaultState]);

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(key);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (error) {
      if (typeof window !== 'undefined') {
        console.error(error);
      }
    }
  }, [value, firstLoadDone]);

  return [value, setValue];
}
