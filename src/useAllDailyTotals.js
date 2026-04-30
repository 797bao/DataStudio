import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from './firebase';

// Module-level cache for the entire dailyTotals tree.
// Volume estimate: ~3000 days × ~100 bytes = ~300 KB. Safe to subscribe in full.
let allCache = null;
const allSubscribers = new Set();
let allUnsub = null;

function ensureAllListener() {
  if (allUnsub) return;
  const allRef = ref(database, 'dailyTotals');
  allUnsub = onValue(allRef, (snap) => {
    allCache = snap.val() || {};
    for (const cb of allSubscribers) cb(allCache);
  });
}

/**
 * Returns { data, loaded } for the *entire* dailyTotals tree.
 * Listener persists for the session, so revisits are instant and live
 * updates always propagate.
 */
export function useAllDailyTotals() {
  const [data, setData] = useState(() => allCache || {});
  const [loaded, setLoaded] = useState(() => allCache !== null);

  useEffect(() => {
    setData(allCache || {});
    setLoaded(allCache !== null);

    const cb = (newData) => {
      setData(newData);
      setLoaded(true);
    };
    allSubscribers.add(cb);
    ensureAllListener();
    return () => { allSubscribers.delete(cb); };
  }, []);

  return { data, loaded };
}
