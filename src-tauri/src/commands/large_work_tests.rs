//! A large work, measured (F11, decision 8f): 2 000 activities, 3 000 diary
//! entries and 2 000 payments — the size the domain's benchmark reads — and
//! the two reads the interface makes of it: `work_get` (the whole plan, the
//! ledger included) and `diary_list` (every entry).
//!
//! The work is written through the repositories, not the commands: 7 000
//! command calls would each return a snapshot, which measures the fixture,
//! not the reads. `synchronous` is lowered while it is written, for the same
//! reason; the reads run under the product's own pragmas.
//!
//! It is not `#[ignore]`d: the whole test — writing the work included — takes
//! under two seconds in a debug build, so it runs in the gate. The benchmark
//! runs it again in release, by name, and prints the numbers:
//!
//! ```text
//! cargo test --release -- --nocapture a_large_work_is_read_within_its_budget
//! ```
//!
//! Each build has its budget: 5 × the first measurement on the development
//! machine (best of three), rounded up — debug: `work_get` 8.3 ms,
//! `diary_list` 23.4 ms; release: 4.2 ms and 12.8 ms.

use std::time::{Duration, Instant};

use crate::commands::diary::diary_list_with;
use crate::commands::work::tests::host_with_a_work;
use crate::commands::work::{work_close_with, work_get_with};
use crate::contract::{DiaryRange, DoneLine};
use crate::db::{self, diary, lock, payments};

const ACTIVITIES: usize = 2_000;
const ENTRIES: usize = 3_000;
const PAYMENTS: usize = 2_000;
const STAGES: usize = 20;

/// The best of `runs`, and what the last run returned.
fn best_of<T>(runs: usize, mut read: impl FnMut() -> T) -> (Duration, T) {
    let mut best = Duration::MAX;
    let mut last = None;
    for _ in 0..runs {
        let started = Instant::now();
        last = Some(read());
        best = best.min(started.elapsed());
    }
    (best, last.expect("at least one run"))
}

#[test]
fn a_large_work_is_read_within_its_budget() {
    let (_db, open, _scratch) = host_with_a_work();
    let started = Instant::now();
    {
        let slot = lock(&open.0);
        let conn = &slot.as_ref().unwrap().conn;
        conn.pragma_update(None, "synchronous", "OFF").unwrap();
        let person = db::work::add_person(conn, "Synthetic crew").unwrap();
        let stages: Vec<String> = (0..STAGES)
            .map(|i| db::work::add_stage(conn, &format!("Stage {i}")).unwrap())
            .collect();
        let activities: Vec<String> = (0..ACTIVITIES)
            .map(|i| {
                db::work::add_activity(conn, &stages[i % STAGES], &format!("Activity {i}")).unwrap()
            })
            .collect();
        for i in 0..ENTRIES {
            diary::append(
                conn,
                &diary::NewEntry {
                    day: format!("2026-{:02}-{:02}", 1 + (i / 28) % 12, 1 + i % 28),
                    kind: "entry".into(),
                    corrects_seq: None,
                    note: Some(format!("Entry {i}: work went on as planned.")),
                    weather: Some("sun".into()),
                    lost_day: false,
                    hours: Some(8.0),
                    deliveries: None,
                    incidents: None,
                    visitors: None,
                    author_name: "Synthetic author".into(),
                    done: vec![DoneLine {
                        activity_id: activities[i % ACTIVITIES].clone(),
                        state: "worked".into(),
                        quantity: None,
                        note: None,
                    }],
                    present: vec![person.clone()],
                    photos: Vec::new(),
                },
            )
            .unwrap();
        }
        for i in 0..PAYMENTS {
            payments::append(
                conn,
                &payments::NewPayment {
                    day: format!("2026-{:02}-{:02}", 1 + (i / 28) % 12, 1 + i % 28),
                    person_id: Some(person.clone()),
                    stage_id: stages[i % STAGES].clone(),
                    commitment_id: None,
                    amount_cents: 1_000 + i as i64,
                    what_for: Some(format!("Payment {i}")),
                    receipt_hash: None,
                    author_name: "Synthetic owner".into(),
                },
            )
            .unwrap();
        }
        conn.pragma_update(None, "synchronous", "FULL").unwrap();
    }
    let written = started.elapsed();

    let (work_get, plan) = best_of(3, || work_get_with(&open).unwrap());
    let (diary_list, entries) = best_of(3, || {
        diary_list_with(&open, &DiaryRange::default()).unwrap()
    });

    assert_eq!(plan.activities.len(), ACTIVITIES);
    assert_eq!(plan.payments.len(), PAYMENTS);
    assert_eq!(entries.len(), ENTRIES);
    println!(
        "large work ({ACTIVITIES} activities, {ENTRIES} entries, {PAYMENTS} payments; \
         written in {written:?}): work_get {work_get:?}, diary_list {diary_list:?}"
    );
    let budget = |measured: Duration, budget_ms: u64, what: &str| {
        assert!(
            measured <= Duration::from_millis(budget_ms),
            "{what} took {measured:?}, over its budget of {budget_ms} ms"
        );
    };
    budget(work_get, WORK_GET_BUDGET_MS, "work_get");
    budget(diary_list, DIARY_LIST_BUDGET_MS, "diary_list");
    work_close_with(&open);
}

/// `work_get` over the large work: 5 × the first measurement, rounded up.
const WORK_GET_BUDGET_MS: u64 = if cfg!(debug_assertions) { 45 } else { 25 };

/// `diary_list` over the large work: 5 × the first measurement, rounded up.
const DIARY_LIST_BUDGET_MS: u64 = if cfg!(debug_assertions) { 120 } else { 65 };
