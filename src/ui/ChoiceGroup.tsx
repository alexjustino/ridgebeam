import { useRef } from 'react';

import { Button } from './Button';

/**
 * A few mutually exclusive options, each a button, one of them pressed.
 *
 * A radio group underneath — the semantics screen readers and the keyboard
 * expect — drawn with the canonical button so it looks like the rest of the
 * product. For two to four options; a longer list is a `Select`.
 *
 * The arrows move the choice as a radio group's do — Right and Down to the next option, Left and
 * Up to the one before, wrapping — and the focus goes with it (F11: the keyboard reaches
 * everything). Every option stays in the Tab order, as every control in this product does; nothing
 * roves. Space and Enter press the focused option, as they press any button.
 *
 * Options that do not fit the width wrap onto the next line rather than run out of the card (E3:
 * the seven causes of a lost day, in Portuguese, are wider than a narrow window).
 *
 * `compact` is the title bar's form: compact buttons and no visible label — the group is still
 * named, for anybody who is listening rather than looking.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
  labels,
  disabled = false,
  compact = false,
}: {
  label: string;
  options: readonly T[];
  /** The chosen option, or `null` when none is chosen yet (an optional choice). */
  value: T | null;
  onChange: (next: T) => void;
  /** Display text per option; the option id is shown, capitalised, without it. */
  labels?: Partial<Record<T, string>>;
  disabled?: boolean;
  compact?: boolean;
}) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  const step = (from: number, by: number) => {
    const next = options[(from + by + options.length) % options.length];
    if (next === undefined) return;
    onChange(next);
    buttons.current.get(next)?.focus();
  };

  return (
    <div className="flex items-center gap-3">
      {!compact && (
        <span className="w-28 shrink-0 text-caption font-semibold text-fg-tertiary uppercase">
          {label}
        </span>
      )}
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {options.map((option, index) => (
          <Button
            key={option}
            ref={(element: HTMLButtonElement | null) => {
              if (element === null) buttons.current.delete(option);
              else buttons.current.set(option, element);
            }}
            role="radio"
            aria-checked={option === value}
            data-value={option}
            appearance={option === value ? 'accent' : compact ? 'subtle' : 'standard'}
            size={compact ? 'compact' : 'standard'}
            onClick={() => onChange(option)}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              const by =
                event.key === 'ArrowRight' || event.key === 'ArrowDown'
                  ? 1
                  : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                    ? -1
                    : 0;
              if (by === 0 || options.length < 2) return;
              event.preventDefault();
              step(index, by);
            }}
            disabled={disabled}
            className={labels?.[option] ? '' : 'capitalize'}
          >
            {labels?.[option] ?? option}
          </Button>
        ))}
      </div>
    </div>
  );
}
