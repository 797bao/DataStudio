import { useState, useEffect } from 'react';
import { ref, query, orderByKey, startAt, endAt, onValue } from 'firebase/database';
import { database } from './firebase';

// Module-level cache keyed by year. Mirrors useMonthData pattern.
const dataCache = new Map();    // year -> dailyTotals object {YYYY-MM-DD: {...}}
const subscribers = new Map();  // year -> Set<setData callback>
const fbUnsubs = new Map();     // year -> firebase unsubscribe fn

function ensureFirebaseListener(year) {
  if (fbUnsubs.has(year)) return;
  const q = query(
    ref(database, 'dailyTotals'),
    orderByKey(),
    startAt(`${year}-01-01`),
    endAt(`${year}-12-31`)
  );
  const unsub = onValue(q, (snap) => {
    const data = snap.val() || {};
    dataCache.set(year, data);
    const subs = subscribers.get(year);
    if (subs) for (const cb of subs) cb(data);
  });
  fbUnsubs.set(year, unsub);
}

/**
 * Fetches all dailyTotals for a year. Listener persists for the session,
 * so revisits are instant and live updates always propagate.
 */
export function useYearTotals(year) {
  const [data, setData] = useState(() => dataCache.get(year) || {});
  const [loaded, setLoaded] = useState(() => dataCache.has(year));

  useEffect(() => {
    setData(dataCache.get(year) || {});
    setLoaded(dataCache.has(year));

    const cb = (newData) => {
      setData(newData);
      setLoaded(true);
    };
    if (!subscribers.has(year)) subscribers.set(year, new Set());
    subscribers.get(year).add(cb);

    ensureFirebaseListener(year);

    return () => {
      subscribers.get(year)?.delete(cb);
    };
  }, [year]);

  return { data, loaded };
}
