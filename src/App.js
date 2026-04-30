import React, { useState, useEffect } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { ref, onValue, set as fbSet } from 'firebase/database';
import { auth, googleProvider, database } from './firebase';
import { OWNER_UID } from './activities';
import Sidebar from './Sidebar';
import MonthView from './MonthView';
import TotalsView from './TotalsView';
import HoursPerDayView from './HoursPerDayView';
import AllTotalsView from './AllTotalsView';
import AllHoursPerDayView from './AllHoursPerDayView';
import './App.css';

const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 220;

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  // Active view: { kind: 'month'|'totals'|'hoursPerDay', year, month? }
  const now = new Date();
  const [view, setView] = useState({
    kind: 'month',
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  // Sidebar width — persisted to Firebase under meta/uiPrefs/sidebarWidth.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
  const [widthLoaded, setWidthLoaded] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return unsub;
  }, []);

  // Load saved sidebar width once authenticated as owner
  const isOwner = !!user && user.uid === OWNER_UID;
  useEffect(() => {
    if (!isOwner) return;
    const widthRef = ref(database, 'meta/uiPrefs/sidebarWidth');
    onValue(
      widthRef,
      (snap) => {
        const v = snap.val();
        if (typeof v === 'number' && v >= SIDEBAR_MIN && v <= SIDEBAR_MAX) {
          setSidebarWidth(v);
        }
        setWidthLoaded(true);
      },
      { onlyOnce: true }
    );
  }, [isOwner]);

  // Debounced persist after width changes
  useEffect(() => {
    if (!isOwner || !widthLoaded) return;
    const t = setTimeout(() => {
      fbSet(ref(database, 'meta/uiPrefs/sidebarWidth'), sidebarWidth).catch(console.error);
    }, 400);
    return () => clearTimeout(t);
  }, [sidebarWidth, isOwner, widthLoaded]);

  const handleSignIn = () => signInWithPopup(auth, googleProvider).catch(console.error);
  const handleSignOut = () => signOut(auth).catch(console.error);

  if (!authReady) {
    return <div className="auth-screen">Loading…</div>;
  }

  if (!isOwner) {
    return (
      <div className="auth-screen">
        <div className="auth-card">
          <h1>Life Log</h1>
          <p>Private — sign in with the owner Google account to view.</p>
          {user ? (
            <>
              <p className="auth-note">
                Signed in as <strong>{user.email}</strong> — but this isn't the owner account.
              </p>
              <button className="auth-btn" onClick={handleSignOut}>Sign out</button>
            </>
          ) : (
            <button className="auth-btn" onClick={handleSignIn}>Sign in with Google</button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        view={view}
        onSelect={setView}
        user={user}
        onSignOut={handleSignOut}
        width={sidebarWidth}
        onWidthChange={(w) => setSidebarWidth(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, w)))}
      />
      <main className="content">
        {view.kind === 'month' && (
          <MonthView year={view.year} month={view.month} onChangeView={setView} />
        )}
        {view.kind === 'totals' && <TotalsView year={view.year} />}
        {view.kind === 'hoursPerDay' && <HoursPerDayView year={view.year} />}
        {view.kind === 'allTotals' && <AllTotalsView />}
        {view.kind === 'allHoursPerDay' && <AllHoursPerDayView />}
      </main>
    </div>
  );
}

export default App;
