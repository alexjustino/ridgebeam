# Design system

This is a contract, not advice. Every user-facing surface in Ridgebeam obeys it, and a change
that diverges is corrected rather than merged.

The goal is narrow and demanding: Ridgebeam should look like it belongs on Windows 11, not like
a web page inside a frame — and a person who has never planned a build should be able to read
every screen of it, in English or in Portuguese, without being told what a word means.

---

## 1. The one rule

> **A component never writes a raw value. If it is not a token, it does not exist.**

No hex colour, no pixel radius, no arbitrary duration, no one-off shadow in a component file.
The token layer is [`src/styles/tokens.css`](src/styles/tokens.css) and it is the only place a
value is decided.

If you need something the tokens do not offer, add it to the token layer with a reason — do not
approximate it locally. An approximation in one component is how a product stops looking like
one product.

The same rule holds for words: **a component never writes a raw string.** Every word a person
reads comes from the i18n tables (`src/i18n/`), in both languages, and a test fails on a literal
that does not (§8).

## 2. Colour

Semantic values live under their own namespaces (`--surface-*`, `--fg-*`, `--stroke-*`,
`--accent-*`, `--state-*`) and are mapped into Tailwind's colour namespace by reference with
`@theme inline`. That indirection is what lets a theme change re-colour every utility at once
rather than freezing a literal into the compiled CSS.

**Light is the base definition on bare `:root`.** Nothing is defined _only_ inside a media
query — a token must always resolve. Dark is declared twice on purpose: once under
`prefers-color-scheme` for the system default, once under `[data-theme='dark']` so an explicit
choice wins in both directions.

### Surfaces, in the order Windows layers them

| Token      | What it is                                                 |
| ---------- | ---------------------------------------------------------- |
| `backdrop` | the Mica material — transparent, because Windows paints it |
| `layer`    | the content region floating on Mica                        |
| `card`     | an opaque element inside the layer                         |
| `flyout`   | Acrylic popovers and menus                                 |

An opaque `body` background would cover the Mica material and undo the entire effect. It stays
transparent. Everything a person reads sits on an opaque `layer` or `card`: text over a
translucent material has a contrast nobody can promise.

### The accent colour is the user's, not ours

`src/app/theme.ts` reads the Windows accent **ramp** from the host and writes it into the token
layer. Windows exposes a ramp rather than a single colour because the shade that reads well on
white does not read well on near-black: light themes take the base and darker steps, dark themes
the lighter ones. Re-apply the ramp whenever the theme changes. In light, the fill and text
colour is the ramp's **first dark step**, not the raw accent — what Fluent does, and what keeps
accent text at 4.5:1 on white and on its own tint.

When the system cannot be asked, the built-in default is used and `fromSystem` is `false` — and
the interface says so. It does not pretend.

**The accent is not a judgement.** A readiness below 100 %, an activity with no responsible, a
work folder that is gone are states, and states take `--state-*` tokens (§2, _severity is never
colour alone_). The accent belongs to the person's desktop; it marks what is selected and what
can be pressed, never what is good or bad about their plan.

### A view says what it left out

A screen that cannot show every row does not quietly show the rest. A list cut to fit says how
many it did not show and how to see them; a figure computed over part of the plan says which
part. An incomplete picture presented as a complete one is worse than an admission.

### A mark that is always on is not a mark

An indicator earns its place by distinguishing. A warning printed beside every row teaches
nothing and costs a glance. Something that is always true is a label, not a warning, and it is
worded as one.

### An icon's own `title` is not a tooltip

A Fluent icon given `title` renders a `<title>` element inside its SVG: not a tooltip, not an
accessible name, and not findable as an attribute. An icon that carries meaning goes in a
wrapper with `role="img"`, `aria-label` and `title` — the same three things `IconButton`
requires — or it is decorative and `aria-hidden`. There is no third case.

### One word, one meaning

Before a state gets a word on a row, check the words already on that row, and check the
glossary (§8). An activity is _scheduled_ or _not scheduled_ — and not scheduled always arrives
with its reason, "no duration". A term the glossary gives one meaning is never used on a screen
for another. A glance that has to disambiguate is not a glance.

### A screen that removes everything keeps the way out

Anything that takes the chrome away earns it by making leaving the most obvious thing there: a
labelled button, Escape from anywhere, and the key named on the screen.

### A number can be opened

A figure on a screen is a button, and pressing it lists the rows it was added up from. A total
the reader cannot decompose is a claim; one they can is a fact they checked themselves. For this
product it is the first rule of all, and §8 says what it means for readiness.

### Two readings of one fact agree

When a surface shows the same fact twice — a percentage and the sentence under it, a count and a
list — the two must never contradict each other. They are computed from the same rows in the
same call, never from two queries that can drift.

### Severity is never colour alone

State (`info`, `success`, `caution`, `danger`) is carried by **colour and an icon and the
wording**. A red border alone is invisible to a large share of users. See `ui/InfoBar.tsx` for
the canonical shape.

## 3. Type

Segoe UI Variable with a declared fallback stack. The Fluent ramp:

`caption 12` → `body 14` (the product default) → `body-lg 16` → `subtitle 20` → `title 28` →
`display 40`

Folder paths, database paths, identifiers and schema versions are set in the mono face: they are
read character by character, and a look-alike character has to be visible. Dates, durations and
amounts are **not** mono — they are read as words by somebody planning a bathroom, and they are
formatted for the person's language, never as the database stores them.

## 4. Space, radius, elevation

Spacing is the 4 px scale. Radius follows Windows 11 geometry: 8 px on the window, 4–6 px on
controls. Elevation has exactly four steps — `card`, `flyout`, `dialog`, `toast` — and a
component picks one rather than inventing a shadow.

**Density** is one attribute, two values: `comfortable` (default) and `compact`. Rows and
controls read `--density-row` and `--density-control`; they never hard-code a height. Changing
one attribute on `<html>` re-sizes the whole product.

### The thing being edited stays in view

A screen where the form is long and the result is at the top is a screen where the result
scrolls away exactly when it starts to matter. A pane that carries the result of what is being
edited is `lg:sticky lg:top-6 self-start` beside the form, so it holds its place while the
person works down the column beside it. `self-start` is not optional: a grid item stretched to
the row's height has nothing left to stick to, and the rule silently does nothing. A sticky pane
taller than the window would pin its top and put its bottom out of reach, so the pane is also a
named scroll region — `lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto`, with `tabIndex={0}` and
an `aria-label` that says what it holds. It is a wide-window rule only — on a narrow window the
two panes are one column and the result belongs where the reading order puts it.

### A row of actions becomes a grid before it wraps one button alone

A wrapped row that leaves the last button by itself on a second line reads as a different kind
of action rather than the last of four, and it is the default window width that does it. A row
of peer actions is `grid grid-cols-2`, and `lg:flex` only where the column can hold the whole
row without wrapping. The order is the same either way — the destructive or secondary one last,
never promoted by the wrap. `flex-wrap` on a row of peers is what this rule replaces. Portuguese
is longer than English: a row is measured in the longer language, not the one it was written in.

## 5. Icons

**Fluent UI System Icons** (`@fluentui/react-icons`), and only that set. Mixing icon families is
immediately visible and cannot be undone later without touching every screen.

- Sizes 16 / 20 / 24, matched to the control they sit in.
- `Filled` variants indicate an active or selected state; `Regular` otherwise.
- **An icon is never the only cue.** `IconButton` requires a `label`, which becomes both the
  accessible name and the tooltip. That requirement is in the type signature so it cannot be
  forgotten.

### The mark

**A gable with its ridge beam.** Two rafters meet at the apex; the beam at the top is the one
solid piece, in the one warm colour — the product is named after it, and it only goes up because
everything under it was planned first. What the drawing has to satisfy:

- **Monochrome-capable.** It must read as one colour before it reads as two: a taskbar, an
  installer, a black-and-white print of About and a disabled state will all take it that way.
- **Legible at 16 px.** Few shapes, no stroke thinner than the gap beside it, nothing that turns
  to grey mush in a tray.
- **It is a building part, not a house icon.** A generic house is every property app's; a gable
  with the beam drawn is this product's.

`src-tauri/icons/ridgebeam.svg` is the source, on its plate, and every raster the platform needs
is generated from it, never edited by hand:

```bash
node -e "require('sharp')('src-tauri/icons/ridgebeam.svg').resize(1024,1024).png().toFile('src-tauri/icons/ridgebeam-1024.png')"
npx tauri icon src-tauri/icons/ridgebeam-1024.png --output src-tauri/icons
```

`src/assets/mark.svg` is the same drawing without its plate, shown beside the name in the title
bar and on About, so the window, the installer and the screen all carry one mark.

## 6. Motion

Fluent curves and durations, from the token layer: `--ease-easy`, `--ease-decelerate`,
`--ease-accelerate`; 100 / 150 / 200 / 300 ms. Motion connects states — a figure that opens onto
its rows grows from where it was — it does not decorate.

Loading shows a skeleton of the shape that is coming, not a spinner.

**`prefers-reduced-motion` is honoured globally**, in `global.css`, not per component. A
component cannot forget it. Nothing animates in a loop.

> A hard-won rule: check the **built** CSS, not just the source. A minifier that drops a prefix
> it does not understand can turn a conditional animation into an unconditional one from
> perfectly correct source.

## 7. Accessibility — WCAG 2.1 AA, without an asterisk

- Visible focus on every interactive element, in both themes. `:focus-visible` is styled
  globally; never remove an outline without replacing it.
- Full keyboard reach. **The keyboard reaches everything from a new work to its first diary
  entry** — the folder, the stage, the activity, its duration and its responsible, the readiness
  figure and the rows it opens onto — with no pointer at any step (SPEC §6, slice F11). In F0 the
  journey is new work to readiness 100 %.
- **Every screen has an `h1`**: one, first in the reading order, naming the screen in the same
  words the navigation used to get there.
- **Every scrolling region has an accessible name**, so a person who moves by region knows which
  list they are in before they start reading it.
- Contrast verified in both themes, including accent-on-surface.
- Minimum target 32 px at comfortable density.
- Live regions for anything that changes without a click — through `announce()` from
  `ui/announce.ts`, rendered by the one `Announcer` mounted with the providers. A component never
  renders its own live region for a transient message. A readiness figure that changes because a
  row was filled is announced with its new value and sentence.
- Dialogs (`Modal`, `ConfirmDialog`) hold Tab and give focus back on close, via `useFocusTrap`.
- **The `lang` attribute follows the language.** `<html lang>` is `en` or `pt-BR` as the person
  chose, so a screen reader pronounces _atividade_ as Portuguese and not as English.

**Held by gates, not by review:** `src/styles/tokens.test.ts` checks every text-on-surface pair
in both themes; the end-to-end suite runs axe-core, every rule on, on every destination in
**both themes and both languages**, where a serious or critical violation is a failure (ADR-011);
the keyboard journey is driven with real key presses.

## 8. The canonical primitives

Everything lives in `src/ui/`. If a screen needs something that is not here, it is built here
first — not inline in the feature.

`Button` · `IconButton` · `SplitButton` · `Input` · `TextArea` · `SearchBox` · `Select` ·
`Combobox` · `DatePicker` · `TimePicker` · `Checkbox` · `Radio` · `ChoiceGroup` · `Toggle` ·
`Slider` · `Badge` · `Chip` · `Avatar` · `Card` · `Modal` · `ConfirmDialog` · `Drawer` ·
`Flyout` · `Tooltip` · `Menu` · `ContextMenu` · `CommandBar` · `TabStrip` · `Breadcrumb` ·
`ProgressBar` · `ProgressRing` · `Skeleton` · `EmptyState` · `Toast` · `InfoBar` · `Kbd` ·
`Resizer` · `VirtualList`

Present at F0, carried over from the sibling products rather than reinvented: `Button`, `Input`,
`TextArea`, `Select`, `Checkbox`, `ChoiceGroup`, `Card`, `TabStrip`, `ProgressBar`, `InfoBar`,
`EmptyState`, `Modal`, `ConfirmDialog` and the `Announcer`. `src/ui/` is the authoritative list;
each of the rest arrives with the slice that first needs it, and arrives _here_, never inline in
a feature.

`TabStrip` takes a `label`, and it is **required**: a strip with no accessible name is a row of
words to anybody who is not looking at it.

**A day is typed in the product's language, never the webview's.** Every date input is
`DateField`; `<input type="date">` does not appear in this codebase, because it draws the day in the
order of the machine's locale — `10/02/2026` month-first on an English Windows, read by a Brazilian as
the 10th of February. Portuguese shows and reads `DD/MM/AAAA`; English shows the product's own short
day, `Feb 10, 2026` — the month as a word — and refuses a day written in figures alone unless the year
comes first, the one numeric order nobody reads two ways. The value in and out is always the stored
form `YYYY-MM-DD` (or `''`), so the language never reaches the data. Typing is forgiving (any
separator or none, the month as a word in either order, the stored form itself); a year is four
digits and never guessed; text that is not a day yet is said in the field's own problem line once the
person leaves it — never silently replaced. The expected form is the field's placeholder and its
`aria-describedby` hint; the calendar beside it is a month grid driven by the arrows, Page Up/Down,
Enter and Escape, and Escape closes the calendar, not the dialog the field sits in.

`ChoiceGroup` is for two to four mutually exclusive options — the language, the theme, the lens
in Settings — a radio group underneath, drawn with the canonical button. A longer list is a
`Select`, with **one exception**: a quick choice made on site in every diary entry — the day's
weather, a lost day's cause — may hold **up to seven short options**, because one tap beats opening
a list with gloves on; the group wraps onto a second line rather than overflowing its card
(ADR-043).

**`ProgressBar` is for a job the product is running, never for the work.** It is a real
`<progress>` with a required label, for something like a backup being written. It is never drawn
for a stage or an activity: progress on a work is derived from the diary (slice F4) and shown as
a figure that opens onto the entries it came from — a bar on a plan row would look like
something a person can set, and nothing can (below).

A shortcut shown beside the thing it triggers is a `Kbd`, everywhere, so a person learns to read
it once.

### What this product adds

These are Ridgebeam's born-with rules. They hold on every screen from F0, and a screen that
breaks one is not merged.

- **A figure carries its rows and opens onto them — readiness first.** Every number on every
  screen is computed from rows the domain returns with it (`Figure { value, rows }`), and pressing
  it lists those rows. The readiness figure is the first and the model for the rest: it is a
  button, its accessible name states the value and what it measures — _"Readiness 50 %: what the
  plan knows of what it must know"_ — and it opens onto one row per thing the plan does not yet
  know, each naming the activity and its stage and saying what is missing. A figure with no rows
  to open is not shown; it is a figure nobody can check.
- **The readiness sentence is built from counts, never from concatenated words.** "1 activity has
  no responsible." and "2 activities have no duration." are **pluralised i18n keys** with the
  count as a parameter, one key per rule, the form chosen by the language's own plural rule
  (`Intl.PluralRules`, never `count === 1`) — and never `count + ' ' + noun + ' ' + verb`. Portuguese and English do not agree on where the
  number goes, which words change with it, or whether zero is plural; a sentence assembled from
  pieces is correct in one language by accident. The sentence and the figure are computed from
  the same rows in the same call (§2, _two readings of one fact agree_).
- **Every screen exists in English and in Portuguese, and the literals test is the gate.**
  `src/i18n/en.ts` and `src/i18n/pt-BR.ts` hold every string; the dictionaries test fails when a
  key exists in one and not the other, and the literals test fails when a component renders a
  string that is not in the table. The one allowed literal is the name, _Ridgebeam_. A screen is
  captured in both languages before it is called done, and its layout is judged in the longer
  one.
- **The owner's lens is the default, and a lens never stores anything.** A new work opens in the
  owner's lens — _this week, what to decide, what to pay, what is done_ — because the person least
  likely to know the vocabulary is the one most likely to leave on the first screen (SPEC R3). A
  lens is a vocabulary and an arrangement over the same rows: switching it changes words and
  order, never data. The lens a person last used is a setting (ADR-013); nothing in a work is
  kept per lens.
- **Nothing on any screen sets progress.** No slider, no percentage field, no "mark as 60 %
  done", no checkbox that means _finished_ on an activity row. Progress is derived from diary
  entries (slice F4); until the diary exists, the product shows no progress at all rather than a
  progress somebody typed (ADR-009). A control that looks like it could set progress is refused
  at review even if it does something else.
- **A term shown must be in the glossary.** Every noun of the domain a screen shows — _work,
  stage, activity, duration, responsible, readiness_ — is a term in
  [`src/i18n/glossary.json`](src/i18n/glossary.json), with its plain sentence in both languages,
  rendered into [`docs/GLOSSARY.md`](docs/GLOSSARY.md) by a gate. A new term enters the glossary
  in the same pull request as the screen that first shows it. A lens that shows a term absent
  from the glossary is a mandatory negative case (SPEC §6). A domain noun on a screen is read
  through the one lookup that resolves the language and the lens together (`useTerm`), so it
  changes with the lens and can never show one lens's word beside another's (ADR-014).
- **Arrangements are the same rows, never a copy.** The Plan shows the work as a breakdown, by
  room and as a checklist — three arrangements, each a pure function in `src/domain/` of the one
  snapshot of the work, and a test holds that they contain exactly the same activities (ADR-014).
  No arrangement keeps a list of its own, caches a row, or has a field the others lack. **Editing
  lives in one place**, the breakdown; the other two say where, with a link that opens the
  breakdown and puts focus on that row. An activity in two rooms appears under both, and the
  group says so, rather than silently counting it twice. The checklist's box is a mark of the
  list, drawn, not a control: it cannot be pressed, it has no checked state, and a note beside
  the list says that done arrives from the diary.
- **Order is changed by keyboard, and every move is announced.** A stage among stages, or an
  activity within its stage, moves with **Alt+ArrowUp** and **Alt+ArrowDown** on the focused row,
  and with **Move up** and **Move down** buttons beside it that do exactly the same thing — the
  chord is never the only way, and the buttons are labelled, never arrows alone. After a move the
  focus stays on the row that moved, the numbering follows at once, and the new place is
  announced through `announce()` in the person's language — _"Tiling moved to position 2 of 3."_
  At the first or last place nothing moves and nothing fails. A drag handle, if one ever arrives,
  is a third way, never the first.
- **The critical path is never colour alone.** A critical bar on the Gantt, a critical row in a
  list, a critical activity anywhere is marked by colour **and** by a mark that survives without
  it — a heavier stroke on the bar, an icon beside the row — **and** by words: the bar's
  accessible name ends with _critical_, and the critical path is also given as a list, in order,
  beside the chart. The colour is a `--state-*` token, never the accent, which is the person's
  desktop and not a judgement (§2). A Gantt that has to be seen in colour to be read is not
  finished.
- **A baseline is drawn under the plan, never over it.** The current plan is what a person acts
  on; the baseline is what it was agreed to be. So the baseline's bars are ghosts beneath the
  current ones — lighter, outlined, behind — and never the other way round, never side by side as
  equals, and never in the critical colour. A difference between the two is not left for the eye
  to find: it is the slip, a figure that opens onto the activities whose finish moved, each with
  its days (§2, _a number can be opened_). An activity can move inside its float without moving
  the finish, so the figure is not the largest row: each row also says how far its finish now
  lies past the baseline's finish, and a positive slip is the largest of those. Days are working days, and the figure says "early" in
  words when the plan is ahead, not with a minus sign alone.
- **A locked plan says why and offers the way out — never a disabled control without a
  sentence.** Once the plan is approved, the rows a baseline records are locked until a
  replanning is opened with a reason (ADR-027) — and the screen says so where a person would try:
  the breakdown carries an `InfoBar` with the sentence, _"The plan is approved. To change it,
  replan it with a reason first."_, and a **Replan…** button beside it that opens the reason
  dialog. No field is disabled for the lock: the rows stay the controls they were, and an edit
  tried anyway shows the host's own sentence in that row's problem line, where the edit was
  tried — the pattern of a closed stage. While a replanning is open, its day and its reason are
  shown on the Plan, the Schedule and the Dashboard, so nobody edits an approved plan without seeing
  why it is open. The reason is required: a blank one is refused inside the dialog, with a
  sentence, and nothing is opened.
- **A comparison is counted figures with rows.** Two baselines compare as counts in words — _"3
  dates moved · 1 activity added · 1 stage removed · money +R$ 1.200,00"_ — and each count opens
  onto its rows: the activity and its stage, both dates and the working days between them, said
  in words as the slip says them — _"3 days"_, _"2 days early"_ — never by a sign or a colour
  alone. The pair is read from the earlier
  baseline to the later whichever way it was chosen, and the screen says so; the reasons between
  them are listed in order, each with its baseline's number. Money a baseline did not record
  reads _not recorded_, never 0 and never a dash. The same baseline chosen twice is a sentence
  where the result would be, and no result is drawn — never an empty comparison that looks like
  "nothing changed" (ADR-028).
- **A what-if says it is not saved.** Whatever a person tries on the What if card is computed in
  memory and never written, and the card says so in a sentence that is always there — _"A
  what-if is not saved: nothing here changes the plan. To keep it, replan with a reason."_ Its finish date and its days are
  labelled as the what-if's and shown beside the plan's, never in place of them: the Gantt, the
  slip and the dashboard keep showing the plan. There is no **Apply**; **Clear** drops the
  what-if, and so does leaving the Schedule or a restart.
- **A cycle is refused with its chain, by name.** A dependency that would close a loop is refused
  before anything is saved, and the refusal names the loop the way a person would read it —
  _"Plaster → Foundations → Walls → Plaster"_, or _"Walls → Walls"_ for a stage made to wait
  on itself — the activities' and stages' own names in order, the same shape the host uses, in an `InfoBar` beside the
  control that asked — never "invalid dependency", never an identifier, never a silent no-op. The
  domain says it before the host is asked; if the host refuses anyway, its sentence is shown the
  same way. A plan already holding a cycle is not drawn: the Schedule says so, and says which.
  A dependency that joins nothing — onto a stage with no activities — is shown as such, not
  hidden.
- **A deadline is never typed.** No screen offers a date field for when a decision is due. What
  a person types is the **lead time** — how many working days between deciding and having — and
  the deadline is shown beside it, computed and read-only, with its status in words: _due in 3
  working days_, _due today_, _overdue by 2 working days_, _made on 30 Sep_, or _no deadline yet_
  with the reason, "nothing in this stage is scheduled" (ADR-017). Where a deadline is shown, it
  is the domain's: it moves when the schedule moves, and a screen never keeps a copy of it. The
  same holds for every computed date in the product — a finish date, a start, a slip — none is an
  input.
- **Overdue on creation is said, not refused.** A decision whose lead time is longer than the
  time left is kept, and the row says so the moment it is added or its lead time raised — a
  caution `InfoBar` on that row, in words: _"Already overdue: 10 working days of lead time, but
  Tiling starts in 4 working days."_ Refusing it would teach a person to type a shorter lead time
  than the real one, and the plan must be able to say the truth. The same goes for every fact
  the plan can hold that is bad news: it is shown, with its reason, never rejected so that the
  screen can stay green.
- **An entry is never edited: it is corrected.** A diary entry has no Edit, no Delete and no
  field that opens in place. Where a person would expect an edit, the entry offers **Correct…**,
  which opens the detailed form filled from the entry, as a new entry that names the one it
  corrects, and asks — required — what was wrong. The day view keeps both: the original struck
  through with _"corrected by #N"_, the correction beside it, in the same card. The word on the
  button is _Correct_, never _Edit_, because what it does is not an edit, and a person who has
  just written the wrong thing should see at once that the record keeps it (ADR-019). A day that
  already has an entry takes another, ordered after it; nothing offers to replace one.
- **A photo is a copy the work owns.** Choosing a photo copies it into the work folder, and the
  screen says so in those words: the list of chosen files before saving shows each one's name,
  and after saving the photo is shown from the work, not from where it came. A refused photo is
  named, with the reason, under the control that chose it — the host's own sentence, which names
  the file and the cap or the format it failed — and nothing of the entry is saved. Thumbnails are images with an `alt` that
  says what they are (the entry's day and the file's name); the original opens in the system's
  viewer on a labelled button, never on a bare click of the image alone. A photo whose thumbnail
  could not be made shows a placeholder that says so, not a broken image (ADR-021).
- **Progress is a state, not a slider.** An activity is _not started_, _started_ or _finished_,
  and the diary is the only thing that moves it (ADR-020). The Gantt fills a finished bar solid
  and marks a started one — by shape and in the bar's accessible name, never colour alone — and
  keeps the planned bar; the checklist ticks a line when the diary says finished, and the tick is
  still not a control. A percentage appears only where the diary recorded quantities against a
  planned quantity, and it never reads 100 % before the diary says finished. No screen shows a
  number the site did not produce.
- **A gate says which items hold it, never just no.** Where a stage cannot start or close, the
  button is disabled **and** the items holding it are listed beside it, by name — _"2 items are
  not answered: The work was inspected; Photos were taken"_ — each unanswered or answered _no_,
  and each reachable from the list. The interface computes this from the domain and never asks
  the host only to be refused; when the host refuses anyway, its sentence names the same items.
  A disabled button with no reason is a defect report somebody else has to write (§10). A closed
  stage says it is closed wherever its rows appear — _"Closed on 30 Sep — reopen it on the Gates
  tab to change it"_ — and its rows are read-only, not hidden (ADR-022).
- **Money is never a float.** An amount is a whole number of cents from the database to the
  domain to the moment it is drawn, and only then is it formatted — by the platform's own number
  formatting, in the work's currency and the person's language: _US$ 1.000,00_ in Portuguese,
  _$1,000.00_ in English. A person types major units with decimals; the interface turns them into
  cents once, and refuses what is not an amount with a sentence. No component divides, rounds or
  sums money on its own: every money figure comes from the domain with its rows (ADR-024), and
  a negative amount — a reversal, a variance — reads with its sign **and** in words ("reversed",
  "under"), never by colour alone. _Over committed_ is a mark in words with the excess beside it.
- **A warning comes before the act it warns about.** When the product can see that an act will put
  the person somewhere they would not choose to be — a payment that runs ahead of the work — it says
  so on the form, as the person types, before the button that does it is pressed, and never only in
  a report afterwards. The form shows what the act would change, live, as figures from the domain —
  on the Ledger, a panel under the fields (`payment-preview`) with what the commitment has earned so
  far, what has been paid and what would be paid after this payment, and whether that leaves money
  due, the two even, or money paid ahead. When the act crosses the line, a caution `InfoBar`
  (`payment-ahead-warning`) titled _Ahead of the work_ says it in one sentence with the amount, the
  commitment, what is earned and the next milestone with what it waits for — _"This payment puts you
  R$ 500,00 ahead of the work on Tiler's quote: earned so far R$ 300,00 — Tiles laid (40 %) is not
  earned yet: Lay the tiles is not finished yet."_ — and a second line that gives the decision back:
  _"You can still record it: whether to pay is yours to decide."_ **A warning is not a refusal**:
  the button stays enabled and keeps its label, **Record the payment**, because the act is the
  person's to decide and, once done, a fact; the record keeps it and marks it afterwards, as _over
  committed_ is marked. The sentence comes from the domain's preview (`paymentPreview`), never from
  a component's own arithmetic. It never warns about undoing — a reversal is not warned about — and
  a commitment with no payment plan is not warned about either: the panel says that whether the
  payment is ahead cannot be said. It is never colour alone: the caution tone, the `InfoBar`'s icon
  and the sentence, each enough on its own (ADR-037).
- **A payment plan says what earns it, and since when.** A commitment's **Payment plan** is a
  disclosure under it on Money → By stage, open by default while the commitment has none. A
  milestone reads with its share and its amount, the fact that earns it in words — _when Tiling
  starts_, _when Lay the tiles is finished_, _when Tiling closes_, _an advance, on agreeing — paid
  before any work_ — and its state from the domain: _earned on 3 Oct_ or _not yet_. Nothing on the
  screen marks a milestone earned; the diary and the gates do. An advance says plainly that it is
  money ahead of the work, on purpose. A plan that does not reach 100 % says how much is in it and
  how much is not — _"70 % in the plan; 30 % not in the plan yet."_ — never a total that pretends
  the rest is covered; a commitment with no plan says it has none and is not evaluated, neither
  ahead nor behind. **Add the usual plan** carries its sentence beside it: a common split, not
  advice — change it to what you agreed. Once a payment names the commitment, the plan is shown as
  it is, with the sentence that says why — a plan rewritten after paying would hide being ahead of
  the work — and no control that would change it; a closed stage does not lock it, and the plan says
  so. Paid ahead and money due are marks on the commitment in words with the amount — _"R$ 500,00
  ahead of the work"_ in the danger tone with an error icon, _"R$ 300,00 earned and not paid"_ as
  information with an info icon — never colour alone.
- **A chart says what it left out.** A chart is a picture of rows the product also shows as a
  table. The S-curve of planned against paid draws two lines told apart by colour **and** by dash,
  with a legend in words; it is `role="img"` with a sentence naming both totals and the last day,
  and the table beneath it, one row per week, is the reading a screen reader and a careful person
  use. What the chart could not place, it says: a cost line with nothing scheduled is placed at
  the work's start, and the chart names how much and why, instead of hiding it in the first
  week's slope.
- **One editing place for documents; elsewhere, a count that links.** A document is added,
  titled, typed, attached, detached and removed on the **Documents** destination and nowhere
  else. A stage header, an activity row, a decision, a diary entry, a commitment and a payment
  show a paperclip and a count — _"2 documents"_ — that is a link opening the Documents page
  filtered to that target, never a second editor (§8, _arrangements are the same rows, never a
  copy_). Adding files names every one refused, with its reason, in one list beside the control
  that chose them; the files that were kept are kept. Removing a document whose file something
  else still names says, in words, that the file stays in the work folder and why (ADR-025).
- **A PDF is a mark, not a picture.** A PDF is never rendered inside the product: it is shown as
  the same document mark every time — an icon from the one icon set, with the word _PDF_ and the
  file's title beside it — and it opens in the system's own viewer on a labelled button. No
  screen draws a first-page preview, a blurred placeholder or anything that suggests the product
  looked inside the file; it did not. An image shows its thumbnail, with an `alt` that says what
  it is; a missing thumbnail shows the mark and says so.
- **N/A always carries its reason.** _Not applicable_ is an answer, not a way to skip a
  question: choosing it opens a small form that asks why, and the answer is not recorded without
  one. Wherever the answer is shown, the reason is shown with it — _"N/A — no tiling in this
  room"_ — never the letters alone. An answer is shown with who gave it and when, and giving
  another answer adds to the history rather than replacing it; the screen shows the latest.
  Starting a stage cannot be undone, and its confirmation says so in words before the button is
  pressed.
- **A range is shown as a range until a person picks.** An activity that came from a template with
  3 to 5 working days has **no duration**, and every screen says exactly that: the breakdown's
  duration field stays empty with the range as its hint and placeholder — never pre-filled with
  either end, never the middle — readiness's row reads that it has a range and no duration yet, and
  the Gantt does not draw a bar it would have to invent. The only ways a range becomes a number are a person
  typing one, or pressing **Use the upper end of each range** or **Use the lower end** — two labelled
  buttons under a sentence that counts the activities with a range and no duration; they write only
  those, and announce what they did. No screen averages, rounds or picks an end on its own; a
  number the product chose would read as the template's promise (ADR-029).
- **A probability is said as N in 10, in words.** A chance the product computes — the finish by a
  date, the plan's own date met, how often an activity is critical — is said as a natural frequency
  in a sentence: _"8 in 10 chances of finishing by 14 November 2026"_, _"The plan's date, 2
  October, has 3 in 10 chances."_, _"critical in 6 of 10 runs"_. The sentence is whole tenths, in
  every lens, because "8 in 10" is what a person with no training in statistics reads correctly and
  a bare "80 %" is read as a promise. **Tenths are floored, never rounded** — 0.79 is "7 in 10" — so
  the words never promise more than the runs showed; "10 in 10" only when every run finished by
  then, "fewer than 1 in 10" below a tenth, and "almost no chance" when no run did, never
  "impossible". The engineer's lens adds the percentile — _(P80)_ — and the share of the runs in
  percent, floored the same way, beside the sentence and never in place of it. The words come from
  the domain (`naturalFrequency`), never from a component's own arithmetic, so a sentence and its
  percentage cannot disagree (§2, _two readings of one fact agree_). A chance is never colour alone
  and never a gauge that looks like a score. Where nothing gives a chance — no activity has a range
  — the card shows the plan's date and says in words that _every activity is counted as certain_,
  and how to give a range; it never shows "10 in 10" as though the plan were sure. The method is on
  the page with the result: how many runs, from which ranges, seeded so the same plan gives the same
  numbers, fewer runs on a large plan said as such, and what the runs leave out — _each activity is
  drawn on its own_. The simulation's own guesses stay inside it: an activity with a range and no
  duration is drawn around the middle of its range, and no screen shows that middle as a duration
  (_a range is shown as a range until a person picks_, above). And a chance never moves the plan:
  the Gantt's dates, the slip and the deadlines stay the plan's (ADR-035).
- **A template is labelled a starting point, never a quote.** Wherever a template is offered — the
  Start screen's picker, **Start from a template…** on an empty breakdown — its preview says what
  it holds in counted words (stages, activities, decisions, checks) and says, in a sentence that is
  always there, that it is _a starting point, with ranges — not a quote_. A work started from one
  says where its plan came from — "Started from: Bathroom renovation, v1" — as provenance, never as
  a link that would suggest the template still governs it. A cost line a template brought is a
  label with **no amount**: it reads _not priced yet_ in words, in the money figures and on the
  line itself, never 0, never a dash and never an empty cell that could be mistaken for zero, and
  the planned figure says how many lines it did not count. A template that cannot be applied is a
  list of its problems in sentences, each saying where in the file it is — never "invalid file".
- **A report says what the screen says, in the same words.** A PDF is composed from the rows the
  screen shows, by the same domain selections, through the same `t()` and the same dictionaries —
  never from a second calculation and never from words written for paper only (ADR-031). A figure on
  the page carries its rows under it, as it opens onto them on the screen. The weekly report is in
  the **owner's** words whatever lens is on, because it is the owner's report; the diary and the
  schedule follow the lens and the language on screen. A string the page cannot print is a defect
  the encoder test finds before a person does: the three stand-ins (→ `->`, ≥ `>=`, ≤ `<=`) are the
  only difference allowed, and a `?` fails the gate. What the page leaves out it says in words — the
  weekly report and the diary count photos and say they are in the work's folder, a note shortened
  in a row is whole in the diary's PDF, and the handover book, which prints its photos, names each
  PDF document without reproducing it — and each card on **Reports** says in one line what its file
  holds **and what it does not**, and after writing names the path and offers **Open**.
- **The plan asks one question at a time.** While a work's plan still has open questions — an
  activity with a range and no duration, an activity with nobody responsible, a cost line not priced
  yet, a decision not made that is overdue or due within 14 calendar days — the dashboard's first
  card, in every lens, is **Next question**: one question, in plain words, with the one control that
  answers it and nothing else — _"How many working days will Remove the tiles take? Most take 1 to
  2."_ and a number. **Keep** sends the answer through the same command the breakdown uses, so it is
  refused or locked exactly as an edit there would be; **Skip for now** moves to the next question
  for this session and records nothing; when every question left was skipped, the card says so and
  offers **Ask the skipped ones again**. The card says how many are answered of how many — _"3 of 22
  answered"_ — and when none are left, or the plan is approved and locked, it is not shown. Nothing
  is asked of a closed stage, which the host would refuse to change. The order is the domain's
  (`nextQuestion`), never the screen's. The breakdown stays where it is: the card is a way in for
  the person who does not know where to start, never the only way to answer, and never a second
  editor with rules of its own (ADR-034). After every other question, and only then, the card
  may ask one that is **optional** — _"What is the most Rebuild could take, in working days? The plan says 4."_ — of an activity on the critical path with a duration and no range; it is marked
  optional, it is not in the "3 of 22 answered" count, because the plan lacks nothing without it,
  and its answer gives the activity a range from its duration to the answer, so no optimism is
  invented (ADR-035).
- **An empty week is printed, and says it is empty.** A week with no diary entry still makes a
  weekly report: its **first line**, in strong type, says that nothing was written and how many
  working days are over with nothing written — _"No diary entry this week: 3 working days are over
  with nothing written. The rest of this report is still printed."_ — and the working days without
  an entry are listed by date. Then the rest of the report follows as it would on any week:
  readiness, the finish, the decisions, the money and the stages as they stand. A report never
  drops a section because it has nothing in it — a figure with nothing to count is printed with its
  zero — and never leaves a reader unable to tell an empty week from a page that failed to print
  (SPEC R2).
- **A book says what it still lacks before it is printed.** A document meant to be kept as the
  record — the handover book — is never written silently incomplete. Its card on **Reports** shows,
  before the button that writes it, a counted figure of its gaps (`handover-gaps`) that opens onto
  its rows like any other figure — _"The book has 4 gaps"_, then each one by name: a check that
  needs a photo answered without one, a check that needs a photo not answered, a stage not closed, a
  room with no photo, no warranty or manual at all, no care note. **The gaps do not disable the
  button**: an owner may want the book halfway through, so writing stays the person's decision, as a
  warning is not a refusal (above). And what the screen said, the page says: a book written while
  any stage is open says on its first page that it was _written while the work was in progress_, and
  that page prints the same gaps, with their rows. The book is in the **owner's** words whatever
  lens is on, like the weekly report. A photo in it is captioned with what it shows — the check or
  the activity, and the day — and a photo of hidden work is printed full width, others two to a row.
  A care note is printed as the person wrote it, and never offered by the product as advice. Where a
  check needs a photo, its photo field is open from the start and the Gates tab says why, so nobody
  learns of the rule from a refusal (ADR-038).
- **A file meant to be sent carries nothing that runs and nothing the reader did not need.** The
  owner's snapshot is read on somebody else's phone, in a browser the product never sees, and may be
  forwarded from there. So it has **no script, no link and nothing loaded from anywhere**: a figure
  opens onto its rows through `<details>` and `<summary>`, which need none, and the summary is a tap
  target at least 44 pixels tall; the style is inline, in the system's own fonts, one readable
  column at most 42 rem wide, a wide table scrolling sideways inside its own box rather than the
  page; **light and dark follow the reader's phone** through `prefers-color-scheme`, never a toggle;
  and printed, its figures are shown open where the browser allows. It holds what the owner needs to
  know where the work stands and **nothing else**: no phone number, no e-mail address, no document,
  no control that would suggest it can be answered. Its words are the screen's, in the owner's lens
  and the language on screen, and its **last line says the day it was written and that it does not
  change when the work does**, because a file that looks live will be read as if it were. The card
  that writes it says what it holds and what it does not, and that **sending it is the person's**;
  the product offers no Send button, because it sends nothing (ADR-039).
- **A drop zone is the window, and it says what a drop will do.** Files dragged from Explorer are
  taken in as if they had been chosen in the dialog, so a drop has no rules of its own: it takes
  what that screen's dialog would offer, and the host refuses in the dialog's sentences. There is
  **one** overlay, for the whole window, never a target drawn on a card: while files are over the
  window it says, in a sentence and in its own polite live region, what will happen on **this**
  screen — _they will join this entry's photos_, _they will be added to the work's documents_ — or
  that nothing will happen here and where files can be dropped instead. It is gone when the files
  leave or land, and with reduced motion it appears without moving. **Nothing happens silently**: a
  drop that nothing took leaves its sentence as an information bar at the top of the content —
  announced, closable, gone at the next screen or the next drag — and every name a drop left out is
  named in one sentence, _"Week 1 was left out: it is a folder, or not a kind of file taken here."_
  (ADR-040).
- **An impact is shown before a decision, always.** Nothing that moves the finish or the money is
  decided on a blank. The form that raises a change order shows what it does **as it is written,
  before it is saved** (`change-impact`) — computed by the schedule, never typed, in one sentence
  that says the working days, both dates and the money: _"Finishes 3 working days later — on 14 Nov
  instead of 11 Nov; costs $1,200.00 more."_ The dialog that approves, declines or withdraws it
  shows the same impact again, from the same call, so the two readings cannot disagree (§2), and
  says what approving will do — _"The replanning is open with this change applied; review the plan
  and take the next baseline."_ — before the button is pressed, not after. Days are always
  **working** days and the sentence says so; a change that does not move the finish says that in
  words, and a change with no price says _not priced_, never _$0.00_. The impact is a figure like
  any other, and opens onto the activities it moves. Approving is not destructive and does not take
  the danger tone; the confirming button repeats the verb — **Approve**, **Decline**, **Withdraw**
  (ADR-041). A change declined or withdrawn is **never shown as a cost**: it has no price line of
  its own, and its impact reads as what approving it would have done — _"Not applied. Had it been
  approved: …"_. A figure's value is a number and its unit lives in the label — _Working days added
  by changes_ **+2**, never a sentence in the value's place.
- **A projection says what it counts and what it does not, in words, beside the number.** A figure
  about the future — whether the money lasts, and its chance — is read as a promise unless the
  screen says what it was made from. So the **Will the money last?** card (`runway-card`) puts,
  beside its sentence and never behind a tooltip, what it **left out**, each counted with its rows:
  money expected on an earlier day that has not arrived — _"1 expected sum has not arrived:
  $5,000.00 not counted — money that has not come is not money."_ — the cost lines _not priced yet_,
  money the schedule cannot date, which it counted this week, and money dated after the last week,
  listed and not counted. A late sum is never quietly added to the money coming in and never quietly
  dropped. The sentence is one, from the domain, and the figures, the weeks' table and the balance
  chart read the same rows in the same call, so they cannot disagree (§2): _"Money runs short in the
  week of 16 Nov — $4,200.00 short."_ or _"The money lasts to the end, with $1,800.00 to spare."_ A
  figure's label carries its unit — **Money runs short in the week of** shows the week's Monday as a
  day, **Money left at the end** an amount — and a short week's closing reads _"$700.00 short"_,
  never a minus sign, which a layperson misreads and a screen reader reads as "minus". The short
  sentence takes the **danger** tone with its error icon and its words, never colour alone; the
  money that lasts is **not** a success state, because a projection is not an achievement. The weeks
  are a real table, as the S-curve's is, each week a row with what came in, what went out and what
  was left, and the chart is drawn as the S-curve is. The chance follows _a probability is said as N
  in 10, in words_ — _"3 in 10 chances that the money runs short before the work ends."_ — and where
  no activity has a range the card says so instead of giving one: _"Every duration is taken as
  certain, so the weeks below are the only answer. Give activities a range to see the chance."_ The
  card ends with what it is: _"A projection, not a promise: it is as good as the schedule, the
  payment plans and the dates typed here."_ The dashboard shows the week or the money left with the
  sentence, and no chance (ADR-042).
- **The plan and the forecast are never the same number on screen.** The plan's finish date and its
  slip say what the plan says — plan against plan — and the forecast says when the work will finish
  **as things stand**, read from the diary (ADR-043). They are two facts, and a screen shows them
  apart, each labelled with what it is and never one in the place of the other: the **As things
  stand** card (`forecast-card`) sits beside the finish and the slip, not over them; the Gantt, the
  slip and the deadlines stay the plan's; and the card's sentence says which is which — _"As things
  stand it finishes on 23 Oct — 5 working days after the baseline's 16 Oct."_ Its days are working
  days, said in words as the slip says them, and ahead of the baseline reads as early in words, not
  as a minus sign alone. A forecast that happens to fall on the plan's date is still labelled as the
  forecast: the two agreeing is a fact about the site, not a reason to show one number.
- **What the record does not explain is always shown.** The **Why is it late?** card
  (`delay-card`) attributes the working days the work is late to causes, each a figure that opens
  onto the entries, decisions and changes it was counted from (§2, _a number can be opened_). The
  days it cannot attribute are a row of their own (`delay-unexplained`), said in words —
  _"3 days the record does not explain"_ — **whenever they are not zero**: never folded into
  _other_, never behind a tooltip, never left off because the rest looks complete (§2, _a view says
  what it left out_). Causes are said in the owner's words — _waiting for a decision_, _the crew did
  not come_ — and a party is the name the record gives, never a verdict: the card attributes, it does
  not judge. When the work is on or ahead of the baseline the card says so, and lists no cause.
- **A snag is closed with a photo or withdrawn with a reason, never deleted.** The Plan's **Snags**
  tab (`data-tab="snags"`) lists what is still to fix, open first, an overdue one marked in words
  and with its icon, never by colour alone (§2), each row carrying its state (`data-snag-id`,
  `data-state`). An open snag offers exactly two ways out and no third: **Fix…** (`snag-fix`), whose
  dialog requires a photo of it fixed — its photo field is open from the start and says why, so
  nobody learns the rule from a refusal — and **Withdraw…** (`snag-withdraw`), whose dialog requires
  the reason. There is **no Edit and no Delete**, on the row or in a menu, because a snag that can
  disappear is a snag nobody fixed: a mistake is withdrawn, and a withdrawn snag stays in the list
  as withdrawn, with its reason. A fixed snag shows its two photos side by side, the problem and the
  fix. Withdrawing is not destructive and does not take the danger tone; the confirming button
  repeats the verb — **Fix**, **Withdraw**. The dashboard's **Still to fix** card
  (`dashboard-snags`) — open, overdue, by person, each a figure with its rows — is not shown while
  the work has never had a snag, and once it has had one it stays, reading zero when all are closed,
  so the end of the list is a fact on screen and not a card that vanished (ADR-044).
- **Held money is shown as held, never as due.** A retention not yet earned reads _held until …_ —
  its stage closed and its person's snags closed — with how many snags hold it, in the neutral tone:
  it is not owed, so it is never in **due now**, never in the danger or warning tone, never in a
  week of the projection as money going out; the projection lists it apart, beside the number, as
  money the owner is holding (§8, _a projection says what it counts and what it does not_). The
  payment plan's editor offers **Hold back as retention** (`milestone-retention`) as the last part,
  suggested at 5 % and editable, and says in a sentence beside it that this is a common practice,
  not advice — as the usual split does. Paying a retention before it is earned is paying ahead of
  the work: the Ledger's warning says so before the payment is saved, as for any milestone, and the
  button is never disabled (ADR-044).
- **An agenda is built from the record, and says when it is empty.** The meeting's agenda
  (`meeting-agenda`) is not a form to fill in: every item on it is a row another screen already
  shows — an action still open, a decision due, a change waiting, a snag open, money falling due or
  held, why it is late, what starts in the next two weeks, a gate coming up — built by the same
  call, so the agenda and that screen cannot disagree (§2, _two readings of one fact agree_). Each
  item carries its kind (`data-agenda-item`, `data-kind`), and its sections come in one fixed order,
  whatever the lens. **A section with nothing in it is left out**, never shown as a heading over
  nothing; **an agenda with nothing on it says so in a sentence** — the record has nothing for this
  meeting — rather than showing an empty page that looks like a failure to load. An overdue item is
  marked in words and with its icon, never by colour alone (§2), and what is new since the last
  meeting is marked in words. What nobody wrote down is not on the agenda, and the screen does not
  pretend otherwise. On an item, the meeting offers **the action the product already has for it**,
  with the very dialog its own screen opens — **Make the decision…**, **Approve…** or **Decline…**,
  **Fix…** or **Withdraw…**, **Raise a snag…** — never a second, simpler form that could disagree
  with the first; done, the item shows what was done in a sentence — _"Decision made: White oak"_ —
  and says that it is already in the record (ADR-045).
- **Minutes are written once, at the close.** Nothing about a meeting is in the record until
  **Close the meeting** (`meeting-close`): until then the attendees, the notes, what was said on
  each item and the actions raised are a draft, and the screen says so. Leaving the meeting with a
  draft asks before discarding it — `ConfirmDialog`, naming what will be lost. Closing asks once
  (`meeting-confirm`), saying what will be written and that **the minutes cannot be changed
  afterwards**: closing is not destructive and does not take the danger tone, and the confirming
  button repeats the verb. There is **no Edit and no Delete** on a meeting, an attendee, an item or
  an action, on the row or in a menu; a mistake is said in the next meeting's minutes. An action is
  written as what, who and by when (`meeting-action-text`, `meeting-action-person`,
  `meeting-action-due`), each a field with its label; once written it leaves only by **Done** or
  **Drop** (`action-done`, `action-drop`), each once, and the next agenda opens with the actions
  still open, oldest first. The minutes printed are in the **owner's** words whatever lens is on,
  like the weekly report, and end with what they are: a record, not a signature (ADR-045).
- **An order-by day is shown with what it is computed from.** The day to order a purchase by is
  never a date alone on a row: it moves when the work slips or gets ahead, and a bare date reads as
  a promise somebody made. Beside it the row says the two things it is computed from — **the start
  as things stand** of the activity that needs it, labelled as the forecast's and never as the
  plan's (§8, _the plan and the forecast are never the same number on screen_), and **the lead
  time**, in calendar days, said as days — _"Order by 14 Oct: needed on 4 Nov as things stand, and
  the supplier takes 21 days."_ The unit is always said, because a decision's lead time is counted
  in working days and a purchase's in calendar days (§2, _one word, one meaning_). Once ordered, the
  row says the day it was ordered and the day it is expected, and when that is after the day it is
  needed it says so in words. On the Plan's **Purchases** tab (`data-tab="purchases"`) each row
  carries its state (`data-purchase-id`, `data-state`, `data-late`), and **late to order**, **to
  order this week**, **late to arrive** and **arrives after it is needed** are said in words and
  with their icon, never by colour alone (§2); a purchase late to order is counted among this
  week's too, but its row says it once. What happened to a purchase is recorded through
  **Mark as ordered…** (`purchase-ordered`), **Mark as delivered…** (`purchase-delivered`) and **The
  order fell through…** (`purchase-cancel`), each a dialog that asks the day (`purchase-event-day`)
  and takes a note (`purchase-event-note`), confirmed by a button that repeats the verb
  (`purchase-event-confirm`); none is destructive, none takes the danger tone, and an event once
  recorded offers no Edit and no Delete. A purchase is edited and removed only while nothing has
  happened to it. A purchase whose activity is finished, or whose stage is closed, is not flagged,
  and says why; one whose activity is not scheduled says that it has no day to order by yet, and
  why. The dashboard's **To order this week** card (`dashboard-purchases`) — to order this week,
  late to order and late to arrive (`purchases-week-value`, `purchases-late-value`,
  `purchases-arriving-late-value`), each a figure that opens onto its rows (§2, _a number can be
  opened_) — is not shown while the work has no purchase. The product orders nothing, and no screen
  says it will (ADR-046).

- **The rail is `nav[data-rail]`, and each entry carries `data-destination`.** The rail is one
  `<nav>` element marked `data-rail`, and each destination in it carries
  `data-destination="<id>"` with the same id the router uses — `dashboard`, `plan`, `schedule`,
  `decisions`, `diary`, `money`, `documents`, `reports`, `settings`, `diagnostics`, `about`. The end-to-end suite and the accessibility audit find destinations by
  these attributes and never by visible text, which changes with the language (§9).
- **Degrade visibly: a missing work folder is a state with a way out.** A recent work whose
  folder is gone is not hidden and not an error dialog: its row says the folder was not found
  where it was last seen, and offers **Find it…** — a folder chosen in the dialog or typed, which
  opens only if it holds the same work; a folder holding another work is refused with a sentence
  naming both — or to take it off the list. A
  work whose folder disappears while it is open stops, says so in a sentence, and takes the
  person back to the Start screen — never a blank screen and never a stack trace (§10).

### Asking "are you sure"

`ConfirmDialog`, always. It names what will happen, the confirming button repeats the verb, and
a destructive action takes the danger tone — with the wording carrying the consequence too,
never colour alone. The dialog names the thing by the name the person gave it: removing a stage
says which stage and how many activities go with it, and the button says **Remove** — not "OK",
which says nothing about what is about to happen. `window.confirm` is not themed, not
keyboard-consistent, and blocks the window's own event loop; it does not appear in this
codebase.

## 9. The window

The window is drawn without system decorations so Mica runs behind the chrome and the command
surface shares the title strip, the way modern Windows applications are built. The three window
controls are ours, including Fluent hover behaviour: close turns red, the others take the
neutral hover. The title bar carries the mark, the product name and the name of the open work.

Drag regions are marked with `data-tauri-drag-region`; interactive children inside them opt out
automatically via `global.css`.

**Known gap, tracked rather than hidden.** Snap Layouts — hovering maximise to choose a layout —
requires native `WM_NCHITTEST` handling that a custom title bar does not get for free.
Maximising works; the hover flyout does not appear yet.

### The rail

The destinations are ordered **the work first, then the product**: Dashboard · Plan ·
Schedule · Decisions · Diary · Money · Documents · Reports, then Settings · Diagnostics · About —
eleven destinations. Between the two groups sits a hairline with `role="separator"` —
a separator and **never** a disabled button, a heading nobody can reach or an empty `div` used as
a gap: the grouping has to be a fact for somebody who is listening to the rail rather than
looking at it, and nothing new may appear in the tab order to say it.

**Decisions** is the owner's _what to decide_: every decision of the work in one list, overdue
first, then due, then those with no deadline yet, and the made ones last, each with its stage,
lead time, deadline and days left, and the way to mark it made or reopen it. Names and lead times
are edited where the rest of the plan is, in the breakdown, and the list links back there — one
place to edit, as for the arrangements (§8).

**Plan** holds five tabs over the same work: **Breakdown**, **By room** and **Checklist** — the
three arrangements of the same rows (§8) — **People** and **Gates**. **People** lists everyone
with their trade, contact, availability and stages, the days they were on site and the last one
— from the diary, never typed — and what they are owed, from money (ADR-026); people are edited
in the breakdown's People card. **Gates** is one card per stage in order: its state
(_Planned_, _Started on …_, _Closed on …_), its start and close checklists with each item's
latest answer and the **Yes**, **No** and **N/A** buttons, a photo beside an item answered with
one, and **Start stage**, **Close stage** and **Reopen**. Checks are written in the breakdown —
where the rest of the plan is edited, with **Add the usual checks** until templates (F9) — and
answered on Gates.

**Diary** is the site's: _today_ at the top, one tap already on the day — the activities running,
each with _worked on_ and _finished_, the people present, the weather, and **Save today** — with
**More…** for the note, hours, a lost day, deliveries, incidents, visitors and photos. Below it,
the days, newest first, each a card of its entries: who wrote it, when, what was done, who was
there, the weather and the photos, and **Correct…** on each. A day in the future is refused with
a sentence before anything is asked of the host.

**Money** holds three tabs: **By stage** and **By trade** — planned, committed, paid, remaining
and variance, each a button that opens onto its rows, with _over committed_ marked in words —
and the **Ledger**, payments newest first with their receipts, a form to record one, and
**Reverse…** on each. Cost lines are written in the breakdown, where the rest of the plan is;
commitments on By stage. The S-curve and its table sit above the tabs.

**Documents** is the library of every file the work holds: filters by kind and by what a file is
attached to; each file with its thumbnail or its mark, an editable title and kind, its size and
day, its attachments as chips, and **Open**, **Attach to…**, **Detach** and **Remove**; **Add
documents…** at the top, which attaches to the work unless a target is chosen.

**Reports** is where files leave the product: one card each for the **weekly report**, **the
diary** (as a PDF and as CSV), **the schedule** and **the work as JSON**. Each card says in one line
what its file holds and what it does not, chooses where to write it in the save dialog, writes it,
names the path it wrote and offers **Open**; a refusal is a sentence on that card. The diary's card
says how many entries there are and that the chain was verified just now before it offers to write
(ADR-032).

With no work open, Dashboard, Plan, Schedule, Decisions, Diary, Money, Documents and Reports have
nothing to show: the Start screen — a new work, an open work, the recent works — takes the
content region, and the eight destinations are disabled
with the reason in their accessible description, not removed. A rail that changes shape under
the keyboard is a rail nobody learns.

Tab order is the rail's navigation, as it is everywhere else in this product; after the title
bar's three window controls, the first Tab lands on the rail's first destination — no roving
`tabIndex`, nothing that moves under the keyboard.

## 10. Degrade visibly, never silently

A native capability that is unavailable must be _seen_ to be unavailable.

- Mica unsupported → a solid token surface, and the application still looks deliberate.
- The accent ramp could not be read → the default is used and the interface reports it.
- **A work folder that is gone** → a state with a way out (§8): found again from a dialog, taken
  off the list, or — if it went while open — back to the Start screen with a sentence.
- **A folder that cannot hold a new work** — not empty, not writable — → refused with a sentence
  that names the folder and the reason, beside the field that chose it.
- **An activity that cannot be scheduled** → shown as _not scheduled_, with the reason ("no
  duration"), never as a blank cell or a date of zero.
- **A value the host refuses** → the host's own sentence under the control that sent it, and the
  control keeps what was typed so the person can correct it rather than watch it revert. **One
  refusal is the exception: `plan_approved`.** Typing into a locked plan is not a draft — the
  value is not wrong, the plan is closed to it — so the control goes back to the value the plan
  holds and the sentence under it says why and how to open it ("The plan is approved. To change
  it, replan it with a reason first."). Keeping the typed value there would show a plan that says
  one thing on screen and another in the work (ADR-027). **A refused range is the second (D1):**
  an optimistic–pessimistic pair is two fields saved as one value, and a refusal leaves one end
  typed against the other held — a pair the work never had. So both fields go back to the range
  the work holds, and the host's sentence under the pair names the range and the duration it must
  hold (ADR-035).

Silence is the bug. A disabled button with no reason is a defect report somebody else has to
write.

## 11. The gate

Every pull request that touches a user-facing surface is checked against this document, and:

- the screen was **opened in the real application**, in **both themes and both languages**,
  captured, and driven by keyboard;
- `npm run gates` is green — including ESLint, where `react-hooks/rules-of-hooks` is an error,
  because a hook after an early return type-checks cleanly and crashes the screen at runtime; the
  literals and dictionaries tests; and the glossary gate.

A green type-check is not evidence that a UI works.
