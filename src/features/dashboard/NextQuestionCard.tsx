import {
  ArrowRight20Regular,
  ArrowSync20Regular,
  Checkmark20Regular,
  PersonAdd20Regular,
} from '@fluentui/react-icons';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';

import { useNavigation } from '@/app/navigation';
import { LIMITS } from '@/data/commands';
import { useMakeDecision, useUpdateActivity, useUpdateCostLine } from '@/data/queries';
import type { WorkSnapshot } from '@/domain/plan';
import { openQuestions, QUESTION_MESSAGE_KEYS, type Question } from '@/domain/questions';
import type { Schedule } from '@/domain/schedule';
import { PEOPLE_ADD_FOCUS } from '@/features/plan/PeopleCard';
import type { MessageKey } from '@/i18n/en';
import { toCents } from '@/i18n/format';
import { useI18n, type I18n } from '@/i18n/useI18n';
import { useTerms } from '@/i18n/useTerm';
import { announce } from '@/ui/announce';
import { Button } from '@/ui/Button';
import { Card } from '@/ui/Card';
import { InfoBar } from '@/ui/InfoBar';
import { Input } from '@/ui/Input';
import { Select } from '@/ui/Select';

import { useSkipped } from './skipped';

/**
 * Next question (F11, decision 7; SPEC R3): the Dashboard's first card, in every lens, while the plan
 * still has something to be told — one question at a time, in plain words, from the domain's
 * `openQuestions`: a duration where the template gave a range, a responsible, a price, a decision
 * about to fall due. The card never works a question out itself; the domain says what to ask and
 * which command, row and field the answer writes, and the answer goes through that command like any
 * other edit — so a locked plan asks nothing, and the card is not shown.
 *
 * **Keep** writes the answer; **Skip for now** moves on without answering, for this session. The
 * card says how many of the plan's questions are answered ("3 of 22 answered"). After either, the
 * focus goes to the next question's answer; when the last one is answered and the card goes, the
 * focus goes where the Dashboard says (`onGone`).
 */
export function NextQuestionCard({
  snapshot,
  scheduled,
  today,
  onGone,
}: {
  snapshot: WorkSnapshot;
  scheduled: Schedule;
  today: string;
  onGone: () => void;
}) {
  const { t, tp, number } = useI18n();
  const { keys, skip, askAgain } = useSkipped(snapshot.work.workId);
  const open = useMemo(
    () => openQuestions(snapshot, scheduled, today, keys),
    [snapshot, scheduled, today, keys],
  );
  const question = open.questions.find((each) => !keys.has(each.key)) ?? null;
  const shown = !open.locked && open.questions.length > 0;
  // Set by Keep, Skip and Ask again: the next thing drawn takes the focus, because the control
  // that was pressed may be gone with the question it belonged to.
  const acted = useRef(false);
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!acted.current) return;
    acted.current = false;
    if (!shown) {
      onGone();
      return;
    }
    const target =
      card.current?.querySelector<HTMLElement>('[data-testid="next-answer"]') ??
      card.current?.querySelector<HTMLElement>('[data-testid="next-again"]') ??
      null;
    target?.focus();
  }, [shown, question?.key, onGone]);

  if (!shown) return null;

  const count = t(QUESTION_MESSAGE_KEYS.count, {
    answered: number(open.answered),
    total: number(open.total),
  });

  return (
    <div ref={card} data-testid="next-question">
      <Card
        title={t('nextQuestion.title')}
        description={t('nextQuestion.description')}
        actions={
          <span
            data-testid="next-count"
            className="text-body whitespace-nowrap text-fg-secondary tabular-nums"
          >
            {count}
          </span>
        }
      >
        {question === null ? (
          <div className="flex flex-col gap-2">
            <p className="text-body text-fg">{tp('nextQuestion.allSkipped', open.skipped)}</p>
            <div>
              <Button
                icon={<ArrowSync20Regular />}
                data-testid="next-again"
                onClick={() => {
                  acted.current = true;
                  askAgain();
                }}
              >
                {t('nextQuestion.askAgain')}
              </Button>
            </div>
          </div>
        ) : (
          <QuestionForm
            key={question.key}
            question={question}
            snapshot={snapshot}
            onKept={() => {
              acted.current = true;
              announce(t('nextQuestion.kept', { count }));
            }}
            onSkip={() => {
              acted.current = true;
              skip(question.key);
              announce(t('nextQuestion.skipped'));
            }}
          />
        )}
      </Card>
    </div>
  );
}

/** A question's sentence, its numbers and days in the person's language. */
function questionText(i18n: I18n, question: Question): string {
  const { t, number, day } = i18n;
  const key = question.messageKey as MessageKey;
  switch (question.kind) {
    case 'duration':
      return t(key, {
        name: question.params.name,
        min: number(question.params.min),
        max: number(question.params.max),
        days: number(question.params.days),
      });
    case 'responsible':
      return t(key, { name: question.params.name });
    case 'price':
      return t(key, { label: question.params.label });
    case 'decision':
      return t(key, { name: question.params.name, deadline: day(question.params.deadline) });
  }
}

/** Where the question is in the plan: its stage, and for a cost line on an activity, the activity. */
function whereText(i18n: I18n, question: Question): string | null {
  if (question.stageName === null) return null;
  if (question.kind === 'price' && question.activityName !== null) {
    return i18n.t('nextQuestion.inActivity', {
      stage: question.stageName,
      activity: question.activityName,
    });
  }
  return i18n.t('nextQuestion.in', { stage: question.stageName });
}

/**
 * One question and its answer. Mounted afresh for every question (keyed by it), so what was typed
 * for one never carries into the next; a refusal keeps what was typed, with the reason under it.
 */
function QuestionForm({
  question,
  snapshot,
  onKept,
  onSkip,
}: {
  question: Question;
  snapshot: WorkSnapshot;
  onKept: () => void;
  onSkip: () => void;
}) {
  const i18n = useI18n();
  const { t, number, currency, describeError } = i18n;
  const term = useTerms();
  const navigation = useNavigation();
  const ids = useId();
  const activity = useUpdateActivity();
  const costLine = useUpdateCostLine();
  const decision = useMakeDecision();
  const [value, setValue] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const pending = activity.isPending || costLine.isPending || decision.isPending;

  const refused = (error: unknown) => setProblem(describeError(error));
  const done = { onSuccess: onKept, onError: refused };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const typed = value.trim();
    const { answer } = question;
    switch (answer.field) {
      case 'durationDays': {
        const days = Number(typed);
        if (typed === '' || !Number.isInteger(days) || days < 1 || days > LIMITS.durationDays) {
          setProblem(t('plan.invalid.duration', { max: number(LIMITS.durationDays) }));
          return;
        }
        setProblem(null);
        activity.mutate({ id: answer.targetId, patch: { durationDays: days } }, done);
        return;
      }
      case 'responsibleId': {
        if (typed === '') {
          setProblem(t('nextQuestion.invalid.person'));
          return;
        }
        setProblem(null);
        activity.mutate({ id: answer.targetId, patch: { responsibleId: typed } }, done);
        return;
      }
      case 'amountCents': {
        const cents = toCents(typed);
        if (cents === null) {
          setProblem(t('money.invalid.amount'));
          return;
        }
        setProblem(null);
        costLine.mutate({ id: answer.targetId, patch: { amountCents: cents } }, done);
        return;
      }
      case 'answer': {
        setProblem(null);
        decision.mutate({ id: answer.targetId, answer: typed === '' ? null : typed }, done);
        return;
      }
    }
  };

  const where = whereText(i18n, question);
  const field = `${ids}-answer`;
  const hint = `${ids}-hint`;

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-3" data-kind={question.kind}>
      <div>
        <p className="text-body-lg font-semibold text-fg">{questionText(i18n, question)}</p>
        {where !== null && <p className="mt-0.5 text-caption text-fg-tertiary">{where}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={field} className="text-caption font-semibold text-fg-secondary">
          {question.kind === 'duration'
            ? t('nextQuestion.field.duration', { duration: term('duration', { capital: true }) })
            : question.kind === 'responsible'
              ? term('responsible', { capital: true })
              : question.kind === 'price'
                ? t('nextQuestion.field.price', { currency: currency(snapshot.work.currency) })
                : t('nextQuestion.field.decision')}
        </label>
        {question.kind === 'responsible' ? (
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Select
              id={field}
              data-testid="next-answer"
              aria-describedby={hint}
              value={value}
              onChange={(event) => {
                setValue(event.target.value);
                setProblem(null);
              }}
            >
              <option value="">{t('nextQuestion.choosePerson')}</option>
              {snapshot.people.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </Select>
            <Button
              appearance="subtle"
              icon={<PersonAdd20Regular />}
              data-testid="next-add-person"
              className="justify-self-start"
              onClick={() => navigation.openPlan(PEOPLE_ADD_FOCUS)}
            >
              {t('nextQuestion.addPerson')}
            </Button>
          </div>
        ) : (
          <Input
            id={field}
            data-testid="next-answer"
            aria-describedby={hint}
            aria-invalid={problem !== null}
            className={question.kind === 'decision' ? '' : 'max-w-56'}
            autoComplete="off"
            {...(question.kind === 'duration'
              ? {
                  type: 'number',
                  inputMode: 'numeric' as const,
                  min: 1,
                  max: LIMITS.durationDays,
                  step: 1,
                }
              : question.kind === 'price'
                ? { type: 'number', inputMode: 'decimal' as const, min: 0, step: 0.01 }
                : { type: 'text', maxLength: LIMITS.answer })}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setProblem(null);
            }}
          />
        )}
        <span id={hint} className="text-caption text-fg-tertiary">
          {question.kind === 'duration'
            ? t('nextQuestion.hint.duration')
            : question.kind === 'responsible'
              ? snapshot.people.length === 0
                ? t('nextQuestion.hint.noPeople')
                : t('nextQuestion.hint.responsible')
              : question.kind === 'price'
                ? t('nextQuestion.hint.price')
                : t('nextQuestion.hint.decision')}
        </span>
      </div>

      {problem !== null && (
        <div data-testid="next-problem">
          <InfoBar severity="caution" title={t('nextQuestion.refused')}>
            {problem}
          </InfoBar>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Button
          type="submit"
          appearance="accent"
          icon={<Checkmark20Regular />}
          data-testid="next-keep"
          disabled={pending}
        >
          {pending ? t('common.working') : t('nextQuestion.keep')}
        </Button>
        <Button
          icon={<ArrowRight20Regular />}
          data-testid="next-skip"
          disabled={pending}
          onClick={onSkip}
        >
          {t('nextQuestion.skip')}
        </Button>
      </div>
    </form>
  );
}
