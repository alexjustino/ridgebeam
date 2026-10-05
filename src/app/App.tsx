import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { NavigationContext, type Navigation } from '@/app/navigation';
import { applyAccent, applyTheme, storeTheme } from '@/app/theme';
import { targetKey } from '@/domain/documents';
import type { Settings } from '@/data/commands';
import { errorKind } from '@/data/errors';
import { useAccentRamp, useCloseWork, useWork } from '@/data/queries';
import { AboutPage } from '@/features/about/AboutPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { DiagnosticsPage } from '@/features/diagnostics/DiagnosticsPage';
import { DecisionsPage } from '@/features/decisions/DecisionsPage';
import { DiaryPage } from '@/features/diary/DiaryPage';
import { MeetingPage } from '@/features/meeting/MeetingPage';
import { MoneyPage } from '@/features/money/MoneyPage';
import { DocumentsPage } from '@/features/documents/DocumentsPage';
import { PlanPage, type PlanAnchor, type PlanTab } from '@/features/plan/PlanPage';
import { ReportsPage, type ReportsFocus } from '@/features/reports/ReportsPage';
import { SchedulePage } from '@/features/schedule/SchedulePage';
import { SettingsPage, type SettingsFocus } from '@/features/settings/SettingsPage';
import { DESTINATION_LABELS, NEEDS_WORK, type Destination } from '@/features/shell/destinations';
import { DropNotice, DropZone } from '@/features/shell/DropZone';
import { Sidebar } from '@/features/shell/Sidebar';
import { TitleBar } from '@/features/shell/TitleBar';
import { StartPage } from '@/features/start/StartPage';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { ConfirmDialog } from '@/ui/ConfirmDialog';
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
  const term = useTerms();
  const work = useWork();
  const close = useCloseWork();
  const accent = useAccentRamp();
  const [destination, setDestination] = useState<Destination>('dashboard');
  // Whether the plan's calendar card is open survives a trip to the dashboard and back: somebody
  // who opened it to enter holidays and went to look at the finish date comes back to it open.
  const [calendarOpen, setCalendarOpen] = useState(false);
  // A row another page asked the breakdown to open on ("Edit in the breakdown" on Decisions):
  // held until the plan has taken it, then let go, so the next visit opens as usual.
  const [planFocus, setPlanFocus] = useState<string | null>(null);
  const releasePlanFocus = useCallback(() => setPlanFocus(null), []);
  // The tab another page asked the plan to open on (E1: the dashboard's Changes card): held until
  // the plan has taken it, then let go, as the row above is.
  const [planTab, setPlanTab] = useState<PlanTab | null>(null);
  const releasePlanTab = useCallback(() => setPlanTab(null), []);
  // The place on that tab it asked for (G4: the dashboard's After the handover card opens the
  // Handover tab on its calendar), let go once the plan has taken it.
  const [planAnchor, setPlanAnchor] = useState<PlanAnchor | null>(null);
  const releasePlanAnchor = useCallback(() => setPlanAnchor(null), []);
  // The row a count asked the Documents page to open filtered on (F7): one editing place, and a
  // count elsewhere that links to it already filtered.
  const [documentsFilter, setDocumentsFilter] = useState<string | null>(null);
  // The entry the dashboard asked the diary to open at (F10): held until the diary has put the focus
  // on it, then let go, so the next visit opens at the top as usual.
  const [diaryFocus, setDiaryFocus] = useState<number | null>(null);
  const releaseDiaryFocus = useCallback(() => setDiaryFocus(null), []);
  // The commitment whose payment plan the Next question asked Money to open on (D2): held until
  // Money has put the focus on it, then let go, so the next visit opens as usual.
  const [moneyFocus, setMoneyFocus] = useState<string | null>(null);
  const releaseMoneyFocus = useCallback(() => setMoneyFocus(null), []);
  // The card the dashboard asked Reports to open on (D4: the owner's snapshot): held until Reports
  // has put the focus on its path field, then let go, so the next visit opens at the top as usual.
  const [reportsFocus, setReportsFocus] = useState<ReportsFocus | null>(null);
  const releaseReportsFocus = useCallback(() => setReportsFocus(null), []);
  // The card the dashboard's backup reminder asked Settings to open on (U1): held until Settings has
  // put the focus on the backup's path field, then let go, as for Reports above.
  const [settingsFocus, setSettingsFocus] = useState<SettingsFocus | null>(null);
  const releaseSettingsFocus = useCallback(() => setSettingsFocus(null), []);
  // This week's meeting (G1): a full page over the dashboard, reached from its card. Its draft lives
  // in the page; whether it holds anything is reported here, so leaving — by the rail or the page's
  // own button — asks before dropping it, and the one dialog that asks is the shell's.
  const [meeting, setMeeting] = useState(false);
  const meetingDirty = useRef(false);
  const [leaving, setLeaving] = useState<Destination | null>(null);
  const onMeetingDirty = useCallback((dirty: boolean) => {
    meetingDirty.current = dirty;
  }, []);
  const navigation: Navigation = useMemo(
    () => ({
      openDocuments: (target) => {
        setDocumentsFilter(targetKey(target));
        setDestination('documents');
      },
      openDiary: (seq) => {
        setDiaryFocus(seq);
        setDestination('diary');
      },
      openPlan: (focus) => {
        setPlanFocus(focus);
        setDestination('plan');
      },
      openPaymentPlan: (commitmentId) => {
        setMoneyFocus(commitmentId);
        setDestination('money');
      },
      openSnapshot: () => {
        setReportsFocus('snapshot');
        setDestination('reports');
      },
      openBackup: () => {
        setSettingsFocus('backup');
        setDestination('settings');
      },
      openSchedule: () => setDestination('schedule'),
      openChanges: () => {
        setPlanTab('changes');
        setDestination('plan');
      },
      openSnags: () => {
        setPlanTab('snags');
        setDestination('plan');
      },
      openPurchases: () => {
        setPlanTab('purchases');
        setDestination('plan');
      },
      openAftercare: () => {
        setPlanTab('handover');
        setPlanAnchor('aftercare-calendar');
        setDestination('plan');
      },
      openMeeting: () => {
        meetingDirty.current = false;
        setMeeting(true);
        setDestination('dashboard');
      },
      openMinutes: () => {
        setReportsFocus('meeting-minutes');
        setDestination('reports');
      },
    }),
    [],
  );
  const editInPlan = useCallback((id: string) => {
    setPlanFocus(id);
    setDestination('plan');
  }, []);

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
    setMeeting(false);
    if (hasWork) setDestination('dashboard');
  }
  const onStart = useCallback(() => setDestination('dashboard'), []);
  /** Go to `next`, leaving the meeting — straight away, or once the person agrees to drop its draft. */
  const go = useCallback((next: Destination) => {
    if (next === 'documents') setDocumentsFilter(null);
    if (next === 'diary') setDiaryFocus(null);
    if (next === 'money') setMoneyFocus(null);
    if (next === 'reports') setReportsFocus(null);
    if (next === 'settings') setSettingsFocus(null);
    setMeeting(false);
    meetingDirty.current = false;
    setDestination(next);
  }, []);
  const navigate = useCallback(
    (next: Destination) => {
      if (meeting && meetingDirty.current) setLeaving(next);
      else go(next);
    },
    [meeting, go],
  );
  const meetingClosed = useCallback(() => {
    meetingDirty.current = false;
    setMeeting(false);
  }, []);
  const showsMeeting = meeting && destination === 'dashboard' && hasWork;

  const closeWork = useCallback(() => {
    close.mutate(undefined, { onSuccess: () => setDestination('dashboard') });
  }, [close]);

  return (
    <NavigationContext.Provider value={navigation}>
      {/* One listener for files dropped from Explorer, for the whole window (U1): the screen on
          show decides what a drop does, and a screen that takes none says where to drop instead. */}
      <DropZone destination={destination} workOpen={hasWork}>
        <div className="flex h-full flex-col overflow-hidden rounded-lg">
          <TitleBar workName={snapshot?.work.name ?? null} lens />
          <div className="flex min-h-0 flex-1">
            <Sidebar
              active={showsStart ? null : destination}
              hasWork={hasWork}
              onNavigate={navigate}
            />
            {/* `relative`: the scroll region is the containing block of every absolutely placed
                element in it — the visually hidden labels most of all. Without it their containing
                block was the window, so one far down a long page stretched the document itself,
                and bringing a card into view lifted the whole window (E2's screenshots). */}
            <main
              tabIndex={0}
              aria-label={
                showsStart
                  ? t('start.title')
                  : showsMeeting
                    ? t('meeting.title')
                    : t(DESTINATION_LABELS[destination])
              }
              className="relative min-w-0 flex-1 overflow-y-auto bg-layer focus-visible:-outline-offset-2"
            >
              <DropNotice />

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
                  {!showsStart && showsMeeting && snapshot !== null && (
                    <MeetingPage
                      snapshot={snapshot}
                      onLeave={() => navigate('dashboard')}
                      onDirty={onMeetingDirty}
                      onClosed={meetingClosed}
                    />
                  )}
                  {!showsStart &&
                    !showsMeeting &&
                    destination === 'dashboard' &&
                    snapshot !== null && (
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
                      initialFocus={planFocus}
                      onFocusTaken={releasePlanFocus}
                      initialTab={planTab}
                      onTabTaken={releasePlanTab}
                      initialAnchor={planAnchor}
                      onAnchorTaken={releasePlanAnchor}
                    />
                  )}
                  {!showsStart && destination === 'schedule' && snapshot !== null && (
                    <SchedulePage snapshot={snapshot} />
                  )}
                  {!showsStart && destination === 'decisions' && snapshot !== null && (
                    <DecisionsPage snapshot={snapshot} onEdit={editInPlan} />
                  )}
                  {!showsStart && destination === 'diary' && snapshot !== null && (
                    <DiaryPage
                      snapshot={snapshot}
                      initialEntry={diaryFocus}
                      onFocusTaken={releaseDiaryFocus}
                    />
                  )}
                  {!showsStart && destination === 'money' && snapshot !== null && (
                    <MoneyPage
                      snapshot={snapshot}
                      initialCommitment={moneyFocus}
                      onFocusTaken={releaseMoneyFocus}
                    />
                  )}
                  {!showsStart && destination === 'documents' && snapshot !== null && (
                    <DocumentsPage
                      key={documentsFilter ?? 'all'}
                      snapshot={snapshot}
                      initialTarget={documentsFilter}
                    />
                  )}
                  {!showsStart && destination === 'reports' && snapshot !== null && (
                    <ReportsPage
                      snapshot={snapshot}
                      initialFocus={reportsFocus}
                      onFocusTaken={releaseReportsFocus}
                    />
                  )}
                  {destination === 'settings' && (
                    <SettingsPage
                      settings={settings}
                      initialFocus={settingsFocus}
                      onFocusTaken={releaseSettingsFocus}
                    />
                  )}
                  {destination === 'diagnostics' && <DiagnosticsPage />}
                  {destination === 'about' && <AboutPage />}
                </>
              )}
            </main>
          </div>
        </div>
      </DropZone>
      <ConfirmDialog
        open={leaving !== null}
        title={t('meeting.leave.title')}
        confirmLabel={t('meeting.leave.confirm')}
        confirmTestId="meeting-leave-confirm"
        danger
        onConfirm={() => {
          if (leaving !== null) go(leaving);
          setLeaving(null);
        }}
        onCancel={() => setLeaving(null)}
      >
        {t('meeting.leave.body', { minutes: term('meetingMinutes') })}
      </ConfirmDialog>
    </NavigationContext.Provider>
  );
}
