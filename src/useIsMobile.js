import { useEffect, useState } from 'react';

// Single source of truth for the "mobile portrait" breakpoint.
// Components that branch on viewport size (chart label format, gesture
// handling, etc.) all import from here so the breakpoint stays in sync.
const QUERY = '(max-width: 768px)';

export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(QUERY).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const handler = (e) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return isMobile;
}
