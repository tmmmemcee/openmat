# OpenMat — Open-Source Tournament Platform (working name)

Planning doc, drafted 2026-09-24. Scope: wrestling first (all styles), designed so other combat/bracket sports (BJJ, judo) can plug in later.

---

## 1. Why this exists (research summary)

**Where things stand now**
- TrackWrestling is owned by NBC Sports Next / FloSports and is being folded into FloWrestling. As of Nov 2025 its events, brackets and "MatCenter" are moving onto the Flo site ([Flo announcement](https://www.flowrestling.org/articles/14651007-the-flowrestling-and-trackwrestling-experience-is-leveling-up)).
- Flo's feature bar, which we need to match or beat: follow wrestlers ("MyWrestlers"), alerts for brackets posted, mat assignment, on-deck, bout start and result, and a live mat schedule. Push and email alerts are free. **SMS needs a paid subscription** ([Flo notifications](https://www.flowrestling.org/articles/16152313-flowrestling-notifications-how-to-get-alerts)). Streaming is paid.
- TrackWrestling's Madison tool takes only two inputs, group size and a weight-tolerance %, and runs once per division ([Track docs](https://support.trackwrestling.com/en/article/4262d8)). It has no age-aware grouping and no explainable overrides.
- Existing open-source projects are all partial:
  - [wrestling_scoreboard](https://github.com/Oberhauser-Dev/wrestling_scoreboard) (Flutter, UWW rules, team dual meets). Worth reusing or collaborating on for freestyle/Greco scoring logic.
  - [Wrestling Nerd](https://wnerd.mindtrove.info/) (Windows desktop brackets).
  - [evroon/bracket](https://github.com/evroon/bracket) (general single elim, round robin and Swiss; not wrestling-aware).
  - None of them covers registration → weigh-in → Madison → scheduling → live table scoring → fan alerts end to end.

**How we can win**
1. **Free and self-hostable**, including SMS (bring your own Twilio key) and no paywall on alerts.
2. **Works on bad gym Wi-Fi.** Table tablets keep running offline and sync later. This is the biggest practical pain at real tournaments.
3. **Youth-first bracketing.** Madison grouping by age and weight that can explain its choices, plus one-tap bump up a weight or age group.
4. **Accurate live "on deck / in the hole" with ETAs**, driven by real bout durations on each mat.
5. **Rules as data, versioned by season.** Rules change every year (NFHS moved takedowns to 3 points in 2024-25), so each ruleset is a config file with links to the official source.

---

## 2. Users and roles

| Role | Access | Needs |
|---|---|---|
| Tournament Director | Full event admin | Setup, divisions, brackets, schedule, mats, staff, publish |
| Bracketer / Admin | Event admin minus billing | Madison grouping, overrides, seeding, re-bracketing |
| Weigh-in Staff | Weigh-in station | Fast wrestler lookup, record weight, skin-check flag, scratch |
| Table Worker | **Scoped to one mat**, joins with a QR/PIN (no account) | Call bouts, check in, live score, finalize, correct |
| Coach | Their team | Bulk register, see team schedule and results, team alerts |
| Athlete / Parent | Their profile(s) | Register, see their bouts, get alerts |
| Fan | Public, no login needed to view | Brackets, mat board; an account (or just a push subscription) to follow |

---

## 3. Feature plans

Each feature lists **what it does**, **how we build it**, and **open questions**. Priority is P0 (MVP), P1 or P2.

### F1. Event setup (P0)
- **What:** Create an event (dates, venue, number of mats, timezone), divisions (age group × gender × style), the ruleset for each division, weigh-in windows, registration settings, staff invites.
- **How:**
  - Divisions come from templates such as "USAW Kids Folkstyle 8U–14U", "NFHS Varsity 14 weights", "UWW Freestyle Senior" and "Madison youth".
  - Age groups are defined by birth year, e.g. USAW 2026: 8U = born 2018–19, 10U = 2016–17, 12U = 2014–15, 14U = 2012–13 ([USAW Kids Nationals divisions](https://usawrestlingevents.com/event/2600004702/division)).
  - Each division carries its bout format, e.g. 8U/10U = 1-1-1 and 12U/14U = 1:00-1:30-1:30 for championship bouts at that event.
  - Clone a previous event as a starting point.
- **Open:** Should mats be restricted to certain divisions (e.g. mats 1–2 for 8U only)? Plan: yes, as optional mat pools.

### F2. Registration (P0 basic, P1 payments)
- **What:**
  - Online entry: name, DOB, gender, team/club, style(s), experience level, optional USAW/AAU card number, declared weight, parent contact, waiver.
  - Coach bulk entry and CSV import.
  - Walk-up entry at the event.
- **How:**
  - Build persistent athlete profiles so a kid's record carries across events.
  - Detect duplicates by name + DOB + team.
  - P1: payments via Stripe Connect, paid out to the host club's account; refunds; late fees.
  - P2: validate membership cards. USAW may not have a public API, so this needs research or a partnership. Fallback is a manual "card verified" checkbox at weigh-in.
- **Open:** How much data to collect on minors. Plan: the minimum listed above, and public views show name, team and age group only.

### F3. Weigh-ins and scratch weights (P0)
- **What:**
  - A station UI tuned for speed: search or scan a QR code, type the weight, save, next.
  - Supports scratch weights (Madison) and official weight classes with configurable allowances (e.g. +1 lb for day 2, a growth allowance, or a certified minimum).
  - Skin-check pass/fail, no-show/scratch, and a re-weigh audit log.
- **How:**
  - The weight is stored with who, when and which scale.
  - For official classes, the app auto-assigns the class with the smallest limit ≥ the recorded weight (after allowance). The wrestler's declared class is validated, with a "move to class X?" prompt if they missed weight.
  - Runs offline (see F13).
- **Open:** Scale integration over Bluetooth/USB could come in P2.

### F4. Division grouping: Madison / "scratch weight" brackets (P0, core differentiator)
- **What:** Automatically group wrestlers into pools or brackets of a target size where everyone is within X% of each other's weight, within the same age group (or within N years of age when groups cross age). Directors can override anything.
- **Background:**
  - The classic Madison method sorts by weight, pulls out the obvious extremes at the top and bottom, then groups the rest into even pools under a **10% weight / 2-year age** rule.
  - Anything outside the rule needs the family's consent ([Madison Weight System doc, Keystone Games](https://p10.hostingprod.com/@keystonegames.com/MadisonWeightSystem.pdf)).
  - Common pool sizes are 3–4 for round robin; 8 or 16 for elimination brackets.
- **Algorithm (optimal, not greedy):**
  1. Work within each division (e.g. 10U boys), or across neighbouring ages if the director enables cross-age.
  2. Sort wrestlers by weight.
  3. Use **dynamic programming over the sorted list**. It finds the partition into consecutive runs that minimizes total cost, where each group's cost is:
     - a *hard fail* if the spread `(max−min)/min` exceeds the tolerance and the group isn't forced;
     - a *hard fail* if the age span exceeds the max, when cross-age grouping is on;
     - a size penalty `|size − target|` weighted by a director slider, where groups of 1 are a hard fail and 2 is heavily penalized;
     - a spread penalty (tighter groups are better);
     - optional: an experience-level mismatch penalty (novice vs advanced) and a same-team penalty. Same-team is a soft penalty because small events can't always avoid it.
  4. If no valid partition exists, relax step by step (tolerance 10 → 12 → 15%) and **flag every group that breaks the rule** with its reason. Nothing breaks the rule silently.
  5. The runtime is O(n × maxGroupSize), which is instant even for 1,000 kids.
- **Overrides (wrestle up only, never down; decided 2026-09-24):**
  - Automatic grouping never mixes age divisions. Crossing ages happens only through a director bump-up.
  - **Bump up** a weight group: move the wrestler to the next heavier group and re-balance.
  - **Bump up** an age group: move the wrestler into the next age division's grouping.
  - **Pin** a wrestler to a group, **lock** a group so re-runs don't touch it, **drag and drop** between groups, **split** or **merge** groups.
  - Every override is logged, and violations show a badge (e.g. "11.8% spread, parent consent needed").
  - "Consent" can be recorded per wrestler, and a notification can go to the parent.
- **Official-weight divisions:** Same UI. Groups are fixed classes, and small classes can optionally be merged (e.g. combine 49 and 53 if each has 2 entries).
- **Open:** Default tolerance per age (10% is the classic; some directors use a fixed lb window for the lightest kids). Plan: support either % or lbs.

### F5. Bracket generation (P0: round robin + double elim; P1: the rest)
- **Formats:**
  - **Round robin**, 2–6 per pool: circle-method pairing, ordered so nobody wrestles back to back when avoidable.
  - Configurable RR placement tiebreakers: head-to-head, then fewest losses, then most falls/pin time, then team points, then coin flip.
  - **Single elimination**, with optional true 3rd.
  - **Double elimination / consolation:**
    - bracket sizes 4/8/16/32/64;
    - place depth of 4, 6 or 8;
    - optional **true second** (a rematch if the consolation winner hasn't already lost to the runner-up);
    - standard "loser of bout A drops to line A" consolation mapping, with semifinal crossover to avoid early rematches ([bracket mechanics](https://www.wvmat.com/brackets/brackets.htm)).
  - **UWW repechage** for freestyle/Greco: losers to the two finalists enter repechage for the two bronze medals, and everyone else is ranked by classification points ([UWW rules](https://cdn.uww.org/2025-12/wrestling_rules_1.pdf)).
  - **Pool-to-bracket:** pools of 3–4, then top 2 cross into a bracket.
  - **Dual meet / team tournament** (P2).
- **Seeding:** Manual drag, or by criteria (record, prior placement, ranking).
- **Byes:** Use standard bye-placement charts so byes spread evenly, with an option for random draw.
- **Teammate separation:** Try to keep same-team wrestlers on opposite halves.
- **How:**
  - A bracket is a **graph of bout "slots"**. Each slot has two inputs (seed line, winner-of-bout-X or loser-of-bout-Y) and outputs (winner → slot, loser → slot or eliminated).
  - Every format is a generator producing that graph, and advancement is the same generic engine for all of them.
  - This keeps new formats (and other sports) cheap to add.
- **Placement and team points:** Placement points and advancement points per ruleset (NFHS-style team scoring as a config).

### F6. Match order and mat scheduling (P0)
- **What:** Produce bout numbers and a per-mat queue that respects:
  - bracket dependencies;
  - **minimum rest per wrestler**: configurable, with defaults from the ruleset:
    - **NFHS 30 min** between consecutive matches (Rule 1-4-4, since 2023-24) and **max 6 matches/day** ([NFHS 2023-24 changes](https://nfhs.org/resources/sports/wrestling-rules-changes-2023-24));
    - **USAW 15 min minimum** (30 min at trials/qualifier events) ([USAW event rules](https://usawrestlingevents.com/event/2600004402/rules));
  - mat restrictions per division;
  - a "keep a pool on one mat" preference so youth pools stay together, which parents love;
  - even mat loads.
- **How:**
  - **Estimate** each bout's duration from its format (periods + breaks + overhead), then learn a rolling average per mat and division from real data.
  - **Initial schedule:** list-scheduling heuristic.
    1. Take the ready bouts (inputs known or known-by-then) in priority order: round, division order, bout number.
    2. Assign each to the mat that becomes free earliest, where both wrestlers' `lastBoutEnd + minRest ≤ start`.
    3. Otherwise try the next bout (look-ahead).
  - This is good enough in practice. We can swap in a constraint solver (OR-Tools CP-SAT) later if needed.
  - **Live re-flow:** The schedule is a *plan*, not a promise. After every result, re-compute ETAs, and let the director or the system pull a later bout forward when a wrestler isn't rested.
  - Rest is enforced as a **hard warning** at the table: "Wrestler X finished 12 min ago; needs 18 more. Skip to next bout?"
  - **Bout numbering:** per-mat ranges (Mat 1: 101–199) or global sequence; director choice.
- **Open:** Whether to let directors define "rounds" as session blocks (all 8U R1 before any 8U R2). Plan: yes, as an optional constraint.

### F7. Live mat board: on deck / in the hole (P0)
- **What:** For each mat, show **Now wrestling**, **On deck** (next), and **In the hole** (after that), plus an ETA for each, in three views:
  - a big-screen TV mode for the gym;
  - a phone view per mat;
  - a "my wrestlers" view that shows where each one is next.
- **How:**
  - The server pushes updates over WebSocket or SSE.
  - ETA = sum of the estimated remaining durations ahead of the bout on that mat.
  - Bouts that are blocked (waiting on rest or on the previous result) show as such rather than as a wrong ETA.

### F8. Follow and notifications (P0 push, P1 SMS/email)
- **What:** Follow a wrestler or a whole team. Alerts:
  - brackets posted;
  - **mat assignment**;
  - **in the hole**;
  - **on deck**;
  - bout start;
  - result;
  - placement;
  - schedule change (moved to another mat).
- **How:**
  - **Web Push** from the installable web app (PWA). On iPhone this needs iOS 16.4+ *and* the app added to the home screen, so we need a clear onboarding screen.
  - Email via SMTP. SMS via Twilio or similar using the host's own key (costs money per message, so it's opt-in per event).
  - P2: native app wrappers (Capacitor) for more reliable push.
  - Dedupe and throttle alerts, e.g. no "in the hole" alert if "on deck" follows within 60s.
  - **Follow without an account:** a push subscription tied to an anonymous device ID is enough.
- **Open:** Should a "your mat changed" alert be loud (always sent)? Plan: yes.

### F9. Table worker app: check-in, live scoring, corrections (P0)
- **What:**
  1. The table joins its mat with a QR/PIN.
  2. The screen shows the current bout.
  3. **Check in** both wrestlers (present / not present).
  4. If a wrestler isn't present, run the **call-out flow**: three calls or a timer (director setting), then **forfeit**.
  5. Run the **clock** and tap score buttons. Colors are red/green for folkstyle and red/blue for UWW, and each button is labelled by action (Takedown 3, Escape 1, Reversal 2, Near fall 2/3/4, Penalty, Stalling warning/point, Caution, Injury time, Blood time, Riding time for NCAA).
  6. **Finalize** with a result type: Dec, MD, TF, Fall (with time), Forfeit, Injury default, DQ, Medical forfeit, SV/TB.
  7. The winner advances automatically.
- **How:**
  - **Scoring is an append-only event log** per bout (`{t, clock, period, action, wrestler}`). The score is *computed* from the log.
  - Undo is the inverse event.
  - Post-bout **edits** are correction events with who and why. The director approves edits after a bout's winner has already wrestled again, and the app shows what downstream bouts are affected.
  - **"Result only" mode** for low-tech tables: just enter the final score and result type. This must be one tap away because many events start here.
  - Ruleset-driven buttons, including auto-detect of tech fall at the threshold (NFHS: 15 points; UWW freestyle: 10; Greco: 8).
  - Offline-first (F13).
- **Open:** Scoring from the ref's hand signals by a second tablet? Out of scope; one tablet per mat.

### F10. Rules library and scoring profiles (P0 data, grows over time)
- **What:**
  - Every style/ruleset is a versioned config: season, period lengths per division, point values, win-type thresholds, tech-fall margin, overtime structure, rest defaults, team-point table, and **links to the official rulebook**.
  - Plus a plain-English "how scoring works" page for fans and new parents.
- **Rulesets for v1:**
  - **NFHS folkstyle (high school):** 3-pt takedown and 2/3/4 near fall since 2024-25 ([NFHS 2024-25 changes](https://nfhs.org/resources/sports/wrestling-rules-changes-2024-25)). The full book is sold by NFHS, so we link to it and don't copy it.
  - **NCAA men's and women's:** [men's rules book](https://ncaaorg.s3.amazonaws.com/championships/sports/wrestling/rules/PRMWR_RulesBook.pdf), [case book](https://ncaaorg.s3.amazonaws.com/championships/sports/wrestling/rules/mens/2025-27PRMWR_CaseBook.pdf), [women's rules](https://ncaaorg.s3.amazonaws.com/championships/sports/wrestling/rules/womens/2025PRWWR_NCWWCRulebook.pdf). Adds riding time.
  - **USAW folkstyle (kids):** youth period formats per event.
  - **USAW / UWW freestyle and Greco-Roman:** step-out 1, exposure 2, 4/5-point grand amplitude, passivity, criteria tiebreaks, classification points ([USAW rulebook](https://www.usawmembership.com/usa_wrestling_rule_book.pdf), [UWW rules](https://cdn.uww.org/2025-12/wrestling_rules_1.pdf)).
  - **AAU** ([handbook](https://www.aausports.org/wrestling/rules-handbook/)), plus **"Custom"** for local leagues.
- **How:** YAML/JSON rulesets in the repo with a schema and unit tests. Community PRs update them each season. A ruleset is **pinned per event** so mid-season changes don't alter past results.
- **To verify with an official before coding:** current USAW folkstyle point values; any NFHS 2025-26 and 2026-27 changes; NCAA 2025-27 tiebreaker details.

### F11. Public results and fan experience (P0 basic)
- **What:**
  - Event hub: divisions, brackets (interactive, zoomable, printable), pools, mat board, team scores, placements.
  - Athlete profile with bout history.
  - Search by wrestler or team.
- **How:** Server-rendered for speed and SEO. Bracket rendered as SVG from the slot graph. Printable PDFs of brackets and bout sheets for the head table.

### F12. Director console (P0)
- **What:** One dashboard showing:
  - mats and their queues;
  - late or blocked bouts;
  - pending corrections;
  - check-in holdouts;
  - a "run ahead / behind" gauge.
- **Actions:** Move bout to mat, swap order, hold/release a division, re-seed before round 1, scratch a wrestler (forfeits cascade correctly), broadcast an announcement to followers.
- **Audit log** of everything.

### F13. Offline-first and sync (P0 architecture, not a feature toggle)
- **Problem:** Gyms have terrible Wi-Fi and cell coverage. If the table can't score, the event stops.
- **How:**
  - Tables store bout events locally (IndexedDB) and sync an outbox when the connection returns. Event IDs are generated on the device, so replays are safe.
  - The server is the source of truth for bracket advancement. Conflicts are rare, because one mat = one writer, and they are shown to the director rather than auto-merged.
  - **Optional "gym server" mode:** run the same server on a laptop or Raspberry Pi on the local network. Tables talk to it over LAN, and it forwards to the cloud when internet exists so fans still get updates.
- **Hard P0 requirement:** A table must be able to score a full bout with the network unplugged.

### F14. Multi-sport extensibility (P2, but designed in now)
- Core objects stay sport-neutral: Event, Division, Participant, Group, Bracket (slot graph), Bout, Mat/Area, Schedule, Follow, Notification.
- Each sport package provides:
  - a ruleset schema;
  - the scoring action set and win types;
  - its bracket formats;
  - its tiebreakers.
- BJJ and judo map almost directly: mats, weight + age + belt divisions, elimination and round robin.

---

## 4. Proposed architecture and stack

| Layer | Pick | Why |
|---|---|---|
| Language | **TypeScript end to end** | Largest contributor pool; bracket, scheduler and scoring logic shared between client (offline) and server |
| Web app | React + Vite **PWA** (or SvelteKit), Tailwind | Installable, Web Push, offline service worker; one codebase for fan, table and director |
| API | Node (Fastify) + tRPC or REST, **WebSockets/SSE** for live updates | Simple; realtime is essential |
| DB | **PostgreSQL** (Drizzle ORM); LISTEN/NOTIFY to fan out changes | Relational fits brackets well; one dependency to self-host |
| Jobs | pg-boss (Postgres-backed queue) for notifications | No Redis required |
| Offline | IndexedDB + outbox sync of append-only bout events | See F13 |
| Notifications | Web Push (VAPID), SMTP, Twilio (host-provided key) | Free by default |
| Packaging | Docker Compose (one command), plus a tiny "gym server" build | Self-hosters and clubs |
| Domain packages | `@openmat/brackets`, `@openmat/madison`, `@openmat/scheduler`, `@openmat/rules` (pure, heavily unit-tested) | The hard logic stays testable and reusable |
| License | **MIT** (decided) | Maximum adoption; anyone can use, host or build on it |

**Key data model (short form):** `Event → Division (ruleset, age/gender/style) → Group (Madison pool or weight class) → Bracket (format, slot graph) → Bout (slots, mat, bout#, scheduled/estimated start) → BoutEvent (log)`. Also `Athlete`, `Entry (athlete × event × division, weigh-in weight, overrides)`, `Team`, `Mat`, `StaffAssignment`, `Follow`, `NotificationLog`, `AuditLog`.

---

## 5. Phased roadmap

**Phase 0: foundations (2–3 wks)**
- Monorepo, CI, the domain packages with tests.
- Rulesets: NFHS folkstyle, USAW kids folkstyle, UWW freestyle.
- **Madison DP grouper and round-robin generator first.** It's the differentiator and pure logic.

**Phase 1: MVP, "run a local youth Madison tournament" (6–8 wks)**
- Event setup, CSV and online registration (no payments), weigh-in station.
- Madison grouping with overrides and flags.
- Round robin + double elim brackets, scheduler with rest enforcement.
- Table app: check-in, result-only *and* live scoring, corrections.
- Offline tables. Mat board with on deck / in the hole. Web Push follows.
- Public brackets and results; printable bout sheets.
- **Exit test:** a real club tournament, 4–6 mats, ~200 kids.

**Phase 2: grow (P1)**
- Payments.
- Official weight classes with allowances.
- Seeding, UWW repechage, pool-to-bracket, team scores.
- Email and SMS.
- Gym-server mode. Director console polish.

**Phase 3: expand (P2)**
- Dual meets and team tournaments.
- Streaming overlay (scoreboard as a browser source for OBS).
- Native wrappers, membership card validation.
- Other sports, rankings and athlete history across events.

---

## 6. Decisions (2026-09-24)

- **Name:** undecided. "OpenMat" stays as the placeholder.
- **Language:** TypeScript everywhere.
- **License:** MIT.
- **Hosting:** start as a free public site we run; paid hosting later once it's up. Self-hosting stays possible but isn't the focus.
- **Audience:** youth tournaments first, then a few high school coaches for their tournaments. That pulls **official weight classes, seeding and NFHS-style double elim** into the MVP, not Phase 2.
- **Must not require a technical person to run.** Everything is done in the web UI with guided setup (wizard + templates), sensible defaults, and plain-English warnings. No config files, no command line. Gym-server mode (F13) becomes a one-click download later, not part of the MVP.
- **Wrestle up, never down:** kids may be bumped up an age division and/or a weight group, never down. Auto-grouping keeps age divisions separate.

## 7. Progress

- [x] Repo scaffold (pnpm monorepo, MIT)
- [x] `@openmat/core`: age divisions (USAW birth-year rule), Madison grouping (DP, flags, bump-ups), round robin pairing, pool standings with tiebreakers, all unit tested
- [ ] Official weight classes + class assignment at weigh-in
- [ ] Elimination bracket slot graph (single/double elim, true second, byes, seeding)
- [ ] Scheduler (mats, rest enforcement, ETAs)
- [ ] Rulesets (NFHS, USAW kids folkstyle, UWW) + bout event log scoring
- [ ] Web app (event wizard, registration, weigh-in, grouping UI, table app, mat board, follows)
