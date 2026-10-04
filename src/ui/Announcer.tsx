import { useEffect, useState } from 'react';

import { ANNOUNCE_EVENT, type Announcement } from './announce';

/**
 * The live regions. Visually hidden, present from the first render — a live
 * region that appears together with its first message is not announced.
 *
 * They are `aria-live` regions without a `status` or `alert` role on purpose: those roles belong
 * to the messages a screen shows in place — an `InfoBar` beside the thing it is about — and a
 * reader (or a test) looking for "the status on this screen" must find that one, never this
 * empty, invisible pair.
 *
 * The text is cleared and set on a tick so the same sentence twice in a row is
 * still read twice: "Stage added" after "Stage added" is two stages. A message is
 * removed again after a few seconds: a live region is for what just happened, and
 * stale text there would be read out of context by anyone arriving later.
 */

const LINGER_MS = 4_000;
export function Announcer() {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const { text, politeness } = (event as CustomEvent<Announcement>).detail;
      const set = politeness === 'assertive' ? setAssertive : setPolite;
      set('');
      setTimeout(() => set(text), 30);
      setTimeout(() => set((current) => (current === text ? '' : current)), LINGER_MS);
    };
    document.addEventListener(ANNOUNCE_EVENT, onAnnounce);
    return () => document.removeEventListener(ANNOUNCE_EVENT, onAnnounce);
  }, []);

  return (
    <>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {polite}
      </div>
      <div aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertive}
      </div>
    </>
  );
}
