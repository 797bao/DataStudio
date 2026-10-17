import { useState, useEffect, useMemo } from 'react';
import { ref, onValue } from 'firebase/database';
import { database } from './firebase';

// /bodyStats holds every DEXA scan (BodySpec), keyed by 'YYYY-MM-DD':
//   profile: { sex, dob, heightIn, provider }
//   scans/<date>: { summary, regions, limbs, rmr, androidPct, gynoidPct,
//                   agRatio, vatLbs, vatIn3, bone, source, note? }
// Tiny (~20 KB) and changes only when a new scan is added, so one
// session-long listener with a module cache, same as useAllDailyTotals.
let cache = null;
const subscribers = new Set();
let unsub = null;

function ensureListener() {
  if (unsub) return;
  unsub = onValue(ref(database, 'bodyStats'), (snap) => {
    cache = snap.val() || { profile: null, scans: {} };
    for (const cb of subscribers) cb(cache);
  });
}

/** Returns { profile, scans: [{ date, ...scan }] oldest first, loaded }. */
export function useBodyStats() {
  const [data, setData] = useState(() => cache);

  useEffect(() => {
    setData(cache);
    subscribers.add(setData);
    ensureListener();
    return () => { subscribers.delete(setData); };
  }, []);

  const scans = useMemo(
    () => (data?.scans
      ? Object.keys(data.scans).sort().map((date) => ({ date, ...data.scans[date] }))
      : []),
    [data]
  );
  return { profile: data?.profile || null, scans, loaded: data !== null };
}
