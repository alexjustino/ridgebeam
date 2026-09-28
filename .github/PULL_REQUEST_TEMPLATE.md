## What changed

<!-- One sentence: what this does and why. -->

## Slice

<!-- F0 foundation, F1 the plan, ... or "fix" / "docs". -->

## Gates

- [ ] `npm run gates` green locally
- [ ] tests cover the new rule, **including the negative case**
- [ ] every figure this change shows carries its rows and opens onto them
- [ ] nothing this change writes to the plan bypasses the diary or the baseline

## Verified running

<!-- Not "it compiles". Which screen was opened, in which theme and which language, driven how?
     If this touches a report, an export or a backup, say which file was written, where, and
     what read it back. -->

- Screen(s):
- Theme(s): light / dark
- Language(s): en / pt-BR
- Keyboard reachable: yes / no / not applicable

## Documentation

- [ ] README / ADR / CHANGELOG / SPEC / DATA_MODEL / DESIGN_SYSTEM / GLOSSARY updated where
      behaviour, contract or procedure changed

## Fixtures

- [ ] every fixture this change adds is synthetic, and says so

## Templates

<!-- Only when this adds or changes a file in templates/. Otherwise write "not applicable".
     The procedure is CONTRIBUTING.md, "The template library". -->

- Template(s):
- [ ] `npx vitest run src/domain/templates` passes — the library test validates every file and
      applies it to an empty work
- [ ] every duration and lead time is a range of working days, not a single number
- [ ] no price, no brand, no supplier, no real place, person or contact, no standard cited by
      number
- [ ] the English and the Portuguese were each read by somebody who speaks the language
- [ ] `version` raised by one, if the template was already in the library

## What I could not verify

<!-- Mandatory, and never empty. What was not opened, not printed, not read by somebody who is
     not an engineer, not tested on a clean machine. If everything was verified, write
     "nothing". -->

## Risk

<!-- What could break, and what would show it. -->
