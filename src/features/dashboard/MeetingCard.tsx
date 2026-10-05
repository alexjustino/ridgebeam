import { DocumentText20Regular, PeopleTeam20Regular } from '@fluentui/react-icons';
import { useMemo } from 'react';

import { useNavigation } from '@/app/navigation';
import { MEETING_LABEL_KEYS, meetingSummary, type OpenActionRow } from '@/domain/meetings';
import type { WorkSnapshot } from '@/domain/plan';
import { actionGroupLabel, openActionDue, openActionWho } from '@/features/meeting/meetingWords';
import { useI18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { FigureRow } from '@/ui/FigureRow';

/**
 * **This week's meeting** on the front door (slice G1, decision 5): the way into the meeting
 * (`meeting-open`), which opens a full page with the agenda already written from the record; the last
 * meeting's number and day; and the actions it left — open (`meeting-actions-open`) and past their
 * day (`meeting-actions-overdue`), each a figure that opens onto its actions, and the open ones by
 * whom. Once a meeting has been held, **Meeting minutes as a PDF…** (`dashboard-minutes`) goes to the
 * Reports card that writes them, with the focus on its path field (D4's pattern).
 *
 * Shown on every work: before the first meeting it says what the first agenda will start from. Every
 * number is the domain's `meetingSummary`; the card adds words only.
 */
export function MeetingCard({ snapshot, today }: { snapshot: WorkSnapshot; today: string }) {
  const i18n = useI18n();
  const { t, number, day } = i18n;
  const term = useTerms();
  const navigation = useNavigation();
  const summary = useMemo(() => meetingSummary(snapshot, today), [snapshot, today]);

  const renderRow = (row: OpenActionRow) => (
    <>
      <span className="font-semibold text-fg">{row.text}</span>
      <span aria-hidden="true"> — </span>
      <span>{openActionWho(i18n, row)}</span>
      <span aria-hidden="true"> — </span>
      <span>{openActionDue(i18n, row)}</span>
      <span aria-hidden="true"> — </span>
      <span>{t('meeting.action.from', { number: row.meetingNumber })}</span>
    </>
  );

  return (
    <div data-testid="dashboard-meeting">
      <Card
        title={t('meeting.title')}
        actions={
          <Button
            appearance="accent"
            icon={<PeopleTeam20Regular />}
            data-testid="meeting-open"
            className="shrink-0"
            onClick={navigation.openMeeting}
          >
            {t('meeting.open')}
          </Button>
        }
      >
        <p data-testid="meeting-last" className="text-body text-fg">
          {summary.last === null
            ? t('meeting.card.none')
            : t('meeting.card.last', {
                number: summary.last.number,
                day: day(summary.last.heldOn),
              })}
        </p>
        {summary.held > 0 && (
          <>
            <div className="mt-3 grid gap-4 md:grid-cols-2">
              <FigureRow<OpenActionRow>
                testId="meeting-actions-open"
                size="title"
                figure={summary.open}
                label={t(MEETING_LABEL_KEYS.open)}
                value={number(summary.open.value)}
                rowsLabel={t('meeting.card.rows.open')}
                renderRow={renderRow}
              />
              <FigureRow<OpenActionRow>
                testId="meeting-actions-overdue"
                size="title"
                figure={summary.overdue}
                label={t(MEETING_LABEL_KEYS.overdue)}
                value={number(summary.overdue.value)}
                rowsLabel={t('meeting.card.rows.overdue')}
                renderRow={renderRow}
              />
            </div>
            {summary.byPerson.length > 0 && (
              <section data-testid="meeting-actions-by-person" className="mt-3 flex flex-col gap-1">
                <h3 className="text-body font-semibold text-fg">{t('meeting.card.byPerson')}</h3>
                <ul className="flex flex-col gap-1">
                  {summary.byPerson.map((group) => {
                    const label = actionGroupLabel(i18n, group);
                    return (
                      <li key={group.key} data-action-person={group.personId ?? group.key}>
                        <FigureRow<OpenActionRow>
                          testId="meeting-actions-person"
                          size="inline"
                          figure={group.open}
                          label={label}
                          value={number(group.open.value)}
                          rowsLabel={t('meeting.card.rows.group', { name: label })}
                          renderRow={renderRow}
                        />
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            <div className="mt-3">
              <Button
                icon={<DocumentText20Regular />}
                data-testid="dashboard-minutes"
                onClick={navigation.openMinutes}
              >
                {t('meeting.card.minutes', {
                  minutes: term('meetingMinutes', { capital: true }),
                })}
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
