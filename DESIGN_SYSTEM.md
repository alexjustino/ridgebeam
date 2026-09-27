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

`ChoiceGroup` is for two to four mutually exclusive options — the language, the theme, the lens
in Settings — a radio group underneath, drawn with the canonical button. A longer list is a
`Select`.

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
- **The rail is `nav[data-rail]`, and each entry carries `data-destination`.** The rail is one
  `<nav>` element marked `data-rail`, and each destination in it carries
  `data-destination="<id>"` with the same id the router uses — `dashboard`, `plan`, `schedule`,
  `decisions`, `diary`, `settings`, `diagnostics`, `about`. The end-to-end suite and the accessibility audit find destinations by
  these attributes and never by visible text, which changes with the language (§9).
- **Degrade visibly: a missing work folder is a state with a way out.** A recent work whose
  folder is gone is not hidden and not an error dialog: its row says the folder was not found
  where it was last seen, and offers to find it from a dialog or to take it off the list. A
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
Schedule · Decisions · Diary, then Settings · Diagnostics · About. Between the two groups sits a hairline with `role="separator"` —
a separator and **never** a disabled button, a heading nobody can reach or an empty `div` used as
a gap: the grouping has to be a fact for somebody who is listening to the rail rather than
looking at it, and nothing new may appear in the tab order to say it.

**Decisions** is the owner's _what to decide_: every decision of the work in one list, overdue
first, then due, then those with no deadline yet, and the made ones last, each with its stage,
lead time, deadline and days left, and the way to mark it made or reopen it. Names and lead times
are edited where the rest of the plan is, in the breakdown, and the list links back there — one
place to edit, as for the arrangements (§8).

**Diary** is the site's: _today_ at the top, one tap already on the day — the activities running,
each with _worked on_ and _finished_, the people present, the weather, and **Save today** — with
**More…** for the note, hours, a lost day, deliveries, incidents, visitors and photos. Below it,
the days, newest first, each a card of its entries: who wrote it, when, what was done, who was
there, the weather and the photos, and **Correct…** on each. A day in the future is refused with
a sentence before anything is asked of the host.

With no work open, Dashboard, Plan, Schedule, Decisions and Diary have nothing to show: the
Start screen — a new work, an open work, the recent works — takes the content region, and the
five destinations are disabled
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
  control keeps what was typed so the person can correct it rather than watch it revert.

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
