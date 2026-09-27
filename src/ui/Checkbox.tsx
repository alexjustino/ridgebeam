import { Checkmark12Filled } from '@fluentui/react-icons';

/**
 * The canonical checkbox.
 *
 * The real `<input type="checkbox">` **is** the box: its native look is removed and it is drawn
 * from the token layer, so it carries the accessible role, the keyboard behaviour, the form
 * semantics and the global `:focus-visible` ring for free, and it is the element a pointer, a
 * keyboard and an automation driver all reach. The check mark is drawn over it and takes no
 * pointer events. (A box drawn beside an invisible input is a box that tools consider not there.)
 *
 * The mark is rendered only while the box is checked — never hidden by a class. The Fluent icon
 * injects its own `display: inline` at runtime, after the app's stylesheet, and would win over
 * `hidden`: an unchecked box then shows a grey tick, which is what shipped in F1 and was caught
 * in F4's screenshots.
 */
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  testId,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The accessible name. Required — a box with no name is a box nobody can use. */
  label: string;
  disabled?: boolean;
  /** Names the box itself for the end-to-end suite, which reads and presses the real input. */
  testId?: string;
}) {
  return (
    <span className="relative inline-grid size-5 shrink-0 place-items-center">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        data-testid={testId}
        onChange={(event) => onChange(event.target.checked)}
        className={[
          'peer size-4 cursor-pointer appearance-none rounded-sm border bg-card',
          'transition-colors duration-100 ease-easy',
          'border-stroke-strong hover:border-fg-secondary',
          'checked:border-accent checked:bg-accent checked:hover:border-accent',
          'disabled:cursor-not-allowed disabled:border-stroke-subtle disabled:bg-card',
        ].join(' ')}
      />
      {checked ? (
        <Checkmark12Filled
          aria-hidden="true"
          className="pointer-events-none absolute text-fg-on-accent"
        />
      ) : null}
    </span>
  );
}
