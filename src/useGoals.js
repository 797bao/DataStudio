import { useState, useEffect } from 'react';
import { ref, onValue, set as fbSet, remove as fbRemove } from 'firebase/database';
import { database } from './firebase';

// Module-level cache + listeners, mirrors the other Firebase hooks.
const cache = new Map();      // ym -> { activityId: hours }
const subscribers = new Map();
const fbUnsubs = new Map();

function ensureListener(ym) {
  if (fbUnsubs.has(ym)) return;
  const r = ref(database, `goals/${ym}`);
  const unsub = onValue(r, (snap) => {
    const data = snap.val() || {};
    cache.set(ym, data);
    const subs = subscribers.get(ym);
    if (subs) for (const cb of subs) cb(data);
  });
  fbUnsubs.set(ym, unsub);
}

/**
 * Subscribes to goals/{ym}. Returns { goals, setGoal, removeGoal }.
 * Goal shape: { activityId: hoursTarget, ... }
 */
export function useGoals(ym) {
  const [goals, setGoals] = useState(() => cache.get(ym) || {});

  useEffect(() => {
    setGoals(cache.get(ym) || {});

    const cb = (data) => setGoals(data);
    if (!subscribers.has(ym)) subscribers.set(ym, new Set());
    subscribers.get(ym).add(cb);
    ensureListener(ym);

    return () => { subscribers.get(ym)?.delete(cb); };
  }, [ym]);

  const setGoal = (activityId, hours) => {
    return fbSet(ref(database, `goals/${ym}/${activityId}`), hours);
  };
  const removeGoal = (activityId) => {
    return fbRemove(ref(database, `goals/${ym}/${activityId}`));
  };

  return { goals, setGoal, removeGoal };
}
