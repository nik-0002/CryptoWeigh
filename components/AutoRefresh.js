'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

// Re-loads the table data every few seconds while the tab is visible.
export default function AutoRefresh({ seconds = 10 }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) router.refresh();
    }, seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
