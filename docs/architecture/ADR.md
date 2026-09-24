# Architecture Decision Records

Binding decisions. A record here is not a suggestion: changing one requires a new record that
supersedes it, not an edit in passing. Each entry states the context, the decision, and — the
part that matters most later — the cost we accepted.

The six decisions the specification marks **ADR-PROPOSED** (the plan is intent and the diary is
fact; readiness is a measure; a decision's deadline is computed; the plan is never rewritten in
silence; three lenses over one model; templates are plans) are recorded here by the slice that
makes each of them true, not before.

| #               | Decision                          | Status                          |
| --------------- | --------------------------------- | ------------------------------- |
| [001](#adr-001) | The product is named Ridgebeam    | Accepted — 2026-09-24, by Alex  |

---

## ADR-001 — The product is named Ridgebeam {#adr-001}

**Status.** Accepted — 2026-09-24, decided by Alex.

**Context.** The specification's §0 required the name to be chosen by a person, before the
repository existed, from three finalists brought with collision evidence: GitHub repositories and
handles, the package registries, the Microsoft Store, the `.app`/`.dev`/`.com`/`.io` domains,
USPTO and INPI, and a plain web search for the name with "construction" and "app". The name had
to be one English word or a plain compound, pronounceable in English and Portuguese, sayable on a
site and in a kitchen, carrying a real essence of building, and not sound like an enterprise
suite. The incumbents (Procore, Buildertrend, Fieldwire, Autodesk Build, PlanGrid, CoConstruct,
Houzz Pro, Buildbook, Levelset, Primavera, Project, Sienge, Obra Prima, Mobuss) were taken and
were not references.

One round ran on 2026-09-24. The specification's seven starting references (Plumbline, Topout,
Groundwork, Sitebook, Plinth, Underpin, Lintel) and twenty-one more from the same families — a
part of the building, a tool of the trade, a moment of the build, the book kept on site — went
through the same battery. What fell, and the evidence:

- **Plumbline** — the specification's first hypothesis, crowded: npm, crates.io and PyPI packages
  taken; `.app`, `.dev` and `.com` taken; a "PlumbLine" spirit-level app on Google Play; 20 US
  marks containing the word (Plumbline Services, class 37, registered; Treace Medical, filed 2024)
  and 16 more for "plumb line"; a GitHub organisation with the name.
- **Topout** — `topout.build` is a construction software suite (Closeout Compass, Runway, Permit
  Tracker), and TopOut CM is a construction management firm.
- **Lintel** — `uselintel.com`, AI plan review for construction. **Chalkline** — VisiSpecs, a
  construction specification suite. **Stringline** — three construction apps (a calculator, a
  field tool, a quoting platform). **Sitebook** — `sitebook.com.au`, construction management with
  iOS and Android apps. **Setout** — `setoutapp.com`, practice management for architecture with
  stages, decisions and timelines: the same audience. **Housebook** — a construction documentation
  app. **Brickbook** — `brickbook.eu`, a B2B platform where contractors find subcontractors.
  **Trysquare** — `trysquare.app` is a live assessment product. **Plinth** — a foundation
  calculator, a UK charity platform and three more apps. **Groundwork**, **Underpin**,
  **Formwork**, **Corbel**, **Trowel**, **Tiebeam**, **Kingpost**, **Levelbook**, **Sawhorse**,
  **Eaves** — multiple products or companies each.

Three finalists survived. **Firstbrick** — the first brick, the one essence a layperson needs no
sentence for — but `firstbrick.app` has been parked "Coming Soon" since 2020 and renewed to 2027,
`firstbrick.com` has been held since 2010, and INPI holds **FIRST BRICK TOYS** as a registration
in force (classes 16 and 28, 2024) beside an archived "PROJETO FIRST BRICK". **Ridgepole** — the
same piece of the roof in its older word — collides with the 1 100-star Ruby schema tool
`ridgepole/ridgepole`, its RubyGems name and GitHub organisation, and three US marks (housewares,
registered 2022; cosmetics, one registered and one abandoned).

**Decision.** The product is **Ridgebeam**: the beam at the very top of a pitched roof, where
the rafters meet — the highest piece of a house's frame and the last structural one to go up; in
Brazil the _cumeeira_, whose day is a celebration because from it the house has its shape.
Pronounced RIJ-beem in English and "rídj-bim" in Portuguese. The sentence a layperson is told:
"It is the beam at the top of the roof. When it goes up the house has its shape — and it only
goes up because everything under it was planned first." That is the product's thesis in one
object.

**Evidence for Ridgebeam.** GitHub: five repositories with the word, none above one star, and a
user "Ridgebeam" with two tiny repositories; the repository `alexjustino/ridgebeam` was free.
npm, crates.io, PyPI and RubyGems: free. Microsoft Store: no product with the name (the search
returns beam-calculation apps). Domains: `ridgebeam.app`, `.dev` and `.io` free (RDAP 404);
`.com` registered 2011, answering 404, held by Ridgebeam Building Company, a timber-framing
contractor. USPTO, queried through the search system's own index: zero marks containing
"ridgebeam"; one "RIDGE BEAM" (class 27, floor mats, an individual in China, filed 2022). INPI,
radical search: no result. TMview, offices US and BR: no rows. Web: Ridgebeam Construction, a
kitchen-and-bathroom remodeler in San Francisco since 1997, and the timber framer above — small
contractors, no software.

**What was not verified, stated plainly.** The USPTO's public search page returned "no results"
for every query in the session, including a control that has seventy-three marks; the counts
above came from the same system's search index, queried directly, with the control passing.
The INPI control query did not run: the anonymous session expired after the four searches — the
internal control is that the same session returned three processes for "firstbrick" and none for
the others. The Microsoft Store search is fuzzy and was read from the results page, not from a
catalogue. Google Play and the App Store were covered by web search only. Before the name is
used outside this repository — a store listing, a domain — a person with a session at TSDR and
at INPI closes these gaps; the product is free and the repository is public, so this is a
documented risk (spec R11), not a blocker.

**Cost accepted.** Two small Californian contractors trade under the word and one holds `.com`;
a person searching "ridgebeam construction" will find them first for a while. One US mark reads
"RIDGE BEAM" in an unrelated class. The word is two syllables of trade vocabulary that a
first-time owner has to be told once, where Firstbrick would have needed no telling; the
one-sentence essence is therefore part of the product's voice — on the About screen, in the
README and in the glossary — not an afterthought. The name is always one word, capitalised,
never "Ridge Beam" and never "RB". Firstbrick and Ridgepole stay in the record as the runners-up.
