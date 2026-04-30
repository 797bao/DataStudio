import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from './firebase';

// Module-level cache, mirrors useMonthData pattern.
const dataCache = new Map();    // ym -> { date: [entry,...] }
const subscribers = new Map();
const fbUnsubs = new Map();

function ensureFirebaseListener(ym) {
  if (fbUnsubs.has(ym)) return;
  // entries/<ym> contains all days for that month already.
  const monthRef = ref(database, `entries/${ym}`);
  const unsub = onValue(monthRef, (snap) => {
    const data = snap.val() || {};
    dataCache.set(ym, data);
    const subs = subscribers.get(ym);
    if (subs) for (const cb of subs) cb(data);
  });
  fbUnsubs.set(ym, unsub);
}

/**
 * Returns { data, loaded } for the given YYYY-MM.
 * data shape: { 'YYYY-MM-DD': [{activity, start, end, description}, ...] }
 */
export function useEntriesData(ym) {
  const [data, setData] = useState(() => dataCache.get(ym) || {});
  const [loaded, setLoaded] = useState(() => dataCache.has(ym));

  useEffect(() => {
    setData(dataCache.get(ym) || {});
    setLoaded(dataCache.has(ym));

    const cb = (newData) => {
      setData(newData);
      setLoaded(true);
    };
    if (!subscribers.has(ym)) subscribers.set(ym, new Set());
    subscribers.get(ym).add(cb);

    ensureFirebaseListener(ym);

    return () => {
      subscribers.get(ym)?.delete(cb);
    };
  }, [ym]);

  return { data, loaded };
}
