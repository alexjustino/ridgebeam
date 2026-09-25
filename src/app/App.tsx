import { useCallback, useEffect, useState } from 'react';

import { applyAccent, applyTheme, storeTheme } from '@/app/theme';
import type { Settings } from '@/data/commands';
import { errorKind } from '@/data/errors';
import { useAccentRamp, useCloseWork, useWork } from '@/data/queries';
import { AboutPage } from '@/features/about/AboutPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DiagnosticsPage } from '@/features/diagnostics/DiagnosticsPage';
import { PlanPage } from '@/features/plan/PlanPage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { DESTINATION_LABELS, NEEDS_WORK, type Destination } from '@/features/shell/destinations';
import { Sidebar } from '@/features/shell/Sidebar';
import { TitleBar } from '@/features/shell/TitleBar';
import { StartPage } from '@/features/start/StartPage';
import { useI18n } from '@/i18n/useI18n';
import { Button } from '@/ui/Button';
import { InfoBar } from '@/ui/InfoBar';

/**
 * The window shell: title bar, navigation rail, content layer.
 *
 * The outer element is transparent so the Mica material Windows paints behind the window shows
 * through the chrome; the content region is the "layer" that floats on it.
 *
 * The shell holds one fact the screens do not: whether a work is open. With none, the two
 * destinations that show a work have nothing to show, so the rail marks them unavailable and the
 * content region is the Start screen — create a work, open one, or pick a recent one. Opening or
 * creating a work lands on the dashboard; closing it lands back on Start.
 */
export function App({ settings }: { settings: Settings }) {
  const { t, describeError } = useI18n();
  const work = useWork();
  const close = useCloseWork();
  const accent = useAccentRamp();
  const [destination, setDestination] = useState<Destination>('dashboard');
  // Whether the plan's calendar card is open survives a trip to the dashboard and back: somebody
  // who opened it to enter holidays and went to look at the finish date comes back to it open.
  const [calendarOpen, setCalendarOpen] = useState(false);

  // The theme comes from the settings table and is applied here rather than in each screen, so
  // every screen changes at once. The browser store keeps a copy — the guess the next window
  // paints with before the table has answered, and nothing else.
  // The accent ramp is re-applied with it, because the shade that reads on white does not read on
  // near-black. A ramp that could not be read leaves the token layer's own accent in place, and
  // Diagnostics says which one is showing.
  useEffect(() => {
    applyTheme(settings.theme);
    storeTheme(settings.theme);
    if (accent.data !== undefined) applyAccent(accent.data);
  }, [settings.theme, accent.data]);

  // A work that can no longer be read is not a work on screen: the last snapshot the cache kept
  // is not shown as if it were current. The shell says what happened and offers the way out.
  const snapshot = work.isError ? null : (work.data ?? null);
  const hasWork = snapshot !== null;
  const showsStart = NEEDS_WORK.has(destination) && !hasWork;

  // A work that has just been created or opened lands on the dashboard, whichever door it came
  // through — decided here, where the fact changes, rather than in a dialog that may already be
  // gone by the time the host has answered.
  const [hadWork, setHadWork] = useState(hasWork);
  if (hadWork !== hasWork) {
    setHadWork(hasWork);
    if (hasWork) setDestination('dashboard');
  }
  const onStart = useCallback(() => setDestination('dashboard'), []);
  const closeWork = useCallback(() => {
    close.mutate(undefined, { onSuccess: () => setDestination('dashboard') });
  }, [close]);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg">
      <TitleBar workName={snapshot?.work.name ?? null} lens />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          active={showsStart ? null : destination}
          hasWork={hasWork}
          onNavigate={setDestination}
        />
        <main
          tabIndex={0}
          aria-label={showsStart ? t('start.title') : t(DESTINATION_LABELS[destination])}
          className="min-w-0 flex-1 overflow-y-auto bg-layer focus-visible:-outline-offset-2"
        >
          {/* A work that was open and can no longer be read — its folder moved, its database
              refused — is said, with the way out beside it, never shown as an empty plan. */}
          {work.isError && (
            <div className="mx-auto w-full max-w-3xl px-6 pt-6">
              <InfoBar
                severity={errorKind(work.error) === 'work_moved' ? 'caution' : 'danger'}
                title={t('shell.workUnread')}
              >
                <p>{describeError(work.error)}</p>
                <div className="mt-2">
                  <Button onClick={closeWork} disabled={close.isPending}>
                    {t('shell.workClose')}
                  </Button>
                </div>
              </InfoBar>
            </div>
          )}

          {work.isPending ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-6">
              <div className="h-9 w-48 rounded-md bg-card-hover" />
              <div className="h-40 rounded-xl bg-card-hover" />
            </div>
          ) : (
            <>
              {showsStart && <StartPage onOpened={onStart} />}
              {!showsStart && destination === 'dashboard' && snapshot !== null && (
                <DashboardPage
                  snapshot={snapshot}
                  onClose={closeWork}
                  closing={close.isPending}
                  closeError={close.isError ? describeError(close.error) : null}
                />
              )}
              {!showsStart && destination === 'plan' && snapshot !== null && (
                <PlanPage
                  snapshot={snapshot}
                  calendarOpen={calendarOpen}
                  onCalendarOpen={setCalendarOpen}
                />
              )}
              {!showsStart && destination === 'schedule' && snapshot !== null && (
                <SchedulePage snapshot={snapshot} />
              )}
              {destination === 'settings' && <SettingsPage settings={settings} />}
              {destination === 'diagnostics' && <DiagnosticsPage />}
              {destination === 'about' && <AboutPage />}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
