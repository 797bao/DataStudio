import { useState, useEffect } from 'react';
import { ref, query, orderByKey, startAt, endAt, onValue } from 'firebase/database';
import { database } from './firebase';

// Module-level state — survives component remounts and month navigation.
const dataCache = new Map();    // ym -> dailyTotals object
const subscribers = new Map();  // ym -> Set<setData callback>
const fbUnsubs = new Map();     // ym -> firebase unsubscribe fn

function ensureFirebaseListener(ym) {
  if (fbUnsubs.has(ym)) return;
  const q = query(
    ref(database, 'dailyTotals'),
    orderByKey(),
    startAt(`${ym}-01`),
    endAt(`${ym}-31`)
  );
  const unsub = onValue(q, (snap) => {
    const data = snap.val() || {};
    dataCache.set(ym, data);
    const subs = subscribers.get(ym);
    if (subs) for (const cb of subs) cb(data);
  });
  fbUnsubs.set(ym, unsub);
}

/**
 * Hook: subscribes to dailyTotals for a given YYYY-MM key.
 * - Listeners persist for the life of the page once attached, so revisiting
 *   a previously-loaded month is instant.
 * - Live updates from Firebase still propagate to all subscribed components,
 *   even for months they're not currently viewing.
 */
export function useMonthData(ym) {
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
      // Intentionally NOT detaching the Firebase listener — keep cache hot
      // for revisits and continue receiving live updates in the background.
    };
  }, [ym]);

  return { data, loaded };
}
