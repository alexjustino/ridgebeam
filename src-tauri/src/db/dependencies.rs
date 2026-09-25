//! Dependencies: "this starts after that finishes, and this many working days
//! later".
//!
//! An endpoint is an activity or a whole stage. Scheduling is the domain's
//! (`src/domain/schedule/`): it expands a stage endpoint to the stage's
//! activities and plans the result. The host does two things with that graph
//! and nothing else:
//!
//! - **It refuses a cycle, as the second guard.** The domain refuses first and
//!   says which loop by name; the host checks again because it does not trust
//!   the webview, over the same *expanded* graph — a stage waiting on an
//!   activity inside it is a loop, even though no two rows name each other. The
//!   refusal is `dependency_cycle`, and its message is the loop by the
//!   activities' names.
//! - **It keeps the graph free of dangling ends.** An endpoint names a row in
//!   one of two tables and so cannot be a foreign key; removing an activity or
//!   a stage removes the dependencies that name it, in the same transaction
//!   (`remove_naming_activity`, `remove_naming_stage`).
//!
//! # Changelog of this repository
//!
//! - F2: dependencies added, their lag changed, removed; the cycle guard; the
//!   cascade on removal.

use std::collections::{HashMap, HashSet, VecDeque};

use rusqlite::{params, Connection};

use crate::contract::{Dependency, Endpoint};
use crate::db::work::{exists, found, ACTIVITY_NOT_FOUND, STAGE_NOT_FOUND};
use crate::db::{new_id, now};
use crate::error::{Error, Result};

/// What an endpoint names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    /// One activity.
    Activity,
    /// Every activity in a stage.
    Stage,
}

impl Kind {
    /// The word the file and the wire use.
    pub fn as_str(self) -> &'static str {
        match self {
            Kind::Activity => "activity",
            Kind::Stage => "stage",
        }
    }
}

/// A checked endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct End {
    /// What it names.
    pub kind: Kind,
    /// The id of the activity or the stage.
    pub id: String,
}

/// The sentence for a dependency id that is not in this work.
pub const DEPENDENCY_NOT_FOUND: &str = "That dependency is not in this work.";

/// The sentence for a dependency from something to itself.
pub const SELF_DEPENDENCY: &str =
    "A dependency joins two different things, not one thing to itself.";

/// The sentence for a dependency that is already there.
pub const DUPLICATE_DEPENDENCY: &str = "That dependency is already in the plan.";

/// Every dependency, in the order it was declared.
///
/// # Errors
///
/// [`Error::Database`] when the table cannot be read.
pub fn list(conn: &Connection) -> Result<Vec<Dependency>> {
    let dependencies = conn
        .prepare(
            "SELECT id, blocker_kind, blocker_id, blocked_kind, blocked_id, lag_days
             FROM dependency ORDER BY created_at, id",
        )?
        .query_map([], |row| {
            Ok(Dependency {
                id: row.get(0)?,
                blocker: Endpoint {
                    kind: row.get(1)?,
                    id: row.get(2)?,
                },
                blocked: Endpoint {
                    kind: row.get(3)?,
                    id: row.get(4)?,
                },
                lag_days: row.get(5)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(dependencies)
}

/// Declare that `blocked` starts `lag_days` working days after `blocker`
/// finishes. Returns the dependency's id.
///
/// # Errors
///
/// [`Error::InvalidInput`] for an endpoint not in this work, a dependency from
/// something to itself, or one already there; [`Error::DependencyCycle`] for
/// one that would close a loop over the expanded graph.
pub fn add(conn: &Connection, blocker: &End, blocked: &End, lag_days: i64) -> Result<String> {
    let tx = conn.unchecked_transaction()?;
    must_exist(&tx, blocker)?;
    must_exist(&tx, blocked)?;
    if blocker == blocked {
        return Err(Error::InvalidInput(SELF_DEPENDENCY.into()));
    }
    let duplicate: i64 = tx.query_row(
        "SELECT count(*) FROM dependency
         WHERE blocker_kind = ?1 AND blocker_id = ?2 AND blocked_kind = ?3 AND blocked_id = ?4",
        params![
            blocker.kind.as_str(),
            blocker.id,
            blocked.kind.as_str(),
            blocked.id
        ],
        |row| row.get(0),
    )?;
    if duplicate > 0 {
        return Err(Error::InvalidInput(DUPLICATE_DEPENDENCY.into()));
    }
    refuse_a_cycle(&tx, blocker, blocked)?;

    let id = new_id();
    tx.execute(
        "INSERT INTO dependency (id, blocker_kind, blocker_id, blocked_kind, blocked_id, lag_days,
                                 created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            id,
            blocker.kind.as_str(),
            blocker.id,
            blocked.kind.as_str(),
            blocked.id,
            lag_days,
            now()
        ],
    )?;
    tx.commit()?;
    Ok(id)
}

/// Change a dependency's lag. The graph does not change, so neither can a loop.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the dependency is not in this work.
pub fn set_lag(conn: &Connection, id: &str, lag_days: i64) -> Result<()> {
    let changed = conn.execute(
        "UPDATE dependency SET lag_days = ?2 WHERE id = ?1",
        params![id, lag_days],
    )?;
    found(changed, DEPENDENCY_NOT_FOUND)
}

/// Remove a dependency.
///
/// # Errors
///
/// [`Error::InvalidInput`] when the dependency is not in this work.
pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let changed = conn.execute("DELETE FROM dependency WHERE id = ?1", [id])?;
    found(changed, DEPENDENCY_NOT_FOUND)
}

/// Remove every dependency that names an activity. Called inside the
/// transaction that removes the activity.
///
/// # Errors
///
/// [`Error::Database`] when the rows cannot be removed.
pub fn remove_naming_activity(conn: &Connection, activity_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM dependency
         WHERE (blocker_kind = 'activity' AND blocker_id = ?1)
            OR (blocked_kind = 'activity' AND blocked_id = ?1)",
        [activity_id],
    )?;
    Ok(())
}

/// Remove every dependency that names a stage, or any activity in it — which
/// the stage's removal takes with it. Called inside the transaction that
/// removes the stage, before the activities go.
///
/// # Errors
///
/// [`Error::Database`] when the rows cannot be removed.
pub fn remove_naming_stage(conn: &Connection, stage_id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM dependency
         WHERE (blocker_kind = 'stage' AND blocker_id = ?1)
            OR (blocked_kind = 'stage' AND blocked_id = ?1)
            OR (blocker_kind = 'activity'
                AND blocker_id IN (SELECT id FROM activity WHERE stage_id = ?1))
            OR (blocked_kind = 'activity'
                AND blocked_id IN (SELECT id FROM activity WHERE stage_id = ?1))",
        [stage_id],
    )?;
    Ok(())
}

fn must_exist(conn: &Connection, end: &End) -> Result<()> {
    let (sql, sentence) = match end.kind {
        Kind::Activity => ("SELECT 1 FROM activity WHERE id = ?1", ACTIVITY_NOT_FOUND),
        Kind::Stage => ("SELECT 1 FROM stage WHERE id = ?1", STAGE_NOT_FOUND),
    };
    if exists(conn, sql, &end.id)? {
        Ok(())
    } else {
        Err(Error::InvalidInput(sentence.into()))
    }
}

/// The activities an endpoint stands for, in breakdown order. An empty stage
/// stands for none, and a dependency onto it can close no loop.
fn expand(conn: &Connection, kind: &str, id: &str) -> Result<Vec<String>> {
    match kind {
        "activity" => Ok(vec![id.to_string()]),
        "stage" => {
            let ids = conn
                .prepare("SELECT id FROM activity WHERE stage_id = ?1 ORDER BY position")?
                .query_map([id], |row| row.get(0))?
                .collect::<std::result::Result<Vec<String>, _>>()?;
            Ok(ids)
        }
        // A kind the schema's CHECK would never have let in.
        _ => Ok(Vec::new()),
    }
}

/// Refuse the new dependency if, once expanded, it closes a loop.
///
/// The new dependency adds an edge from every activity `b` it expands to on
/// the blocker side to every activity `d` on the blocked side. A loop through
/// one of those edges exists exactly when some `d` already reaches some `b` —
/// so one breadth-first search from every `d` at once answers it, and the path
/// it finds, closed by the new edge, is the loop the message names.
fn refuse_a_cycle(conn: &Connection, blocker: &End, blocked: &End) -> Result<()> {
    let blockers = expand(conn, blocker.kind.as_str(), &blocker.id)?;
    let blocked_ones = expand(conn, blocked.kind.as_str(), &blocked.id)?;
    if blockers.is_empty() || blocked_ones.is_empty() {
        return Ok(());
    }

    let names: HashMap<String, String> = conn
        .prepare("SELECT id, name FROM activity")?
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<std::result::Result<HashMap<_, _>, _>>()?;
    let name = |id: &str| names.get(id).cloned().unwrap_or_else(|| id.to_string());
    let loop_of = |ids: Vec<String>| -> Error {
        Error::DependencyCycle(
            ids.iter()
                .map(|id| name(id))
                .collect::<Vec<_>>()
                .join(" → "),
        )
    };

    // An activity on both sides: the new dependency makes it wait on itself.
    let blocker_set: HashSet<&str> = blockers.iter().map(String::as_str).collect();
    if let Some(both) = blocked_ones
        .iter()
        .find(|d| blocker_set.contains(d.as_str()))
    {
        return Err(loop_of(vec![both.clone(), both.clone()]));
    }

    // Every edge already in the plan, expanded.
    let mut next: HashMap<String, Vec<String>> = HashMap::new();
    for dependency in list(conn)? {
        let from = expand(conn, &dependency.blocker.kind, &dependency.blocker.id)?;
        let to = expand(conn, &dependency.blocked.kind, &dependency.blocked.id)?;
        for a in &from {
            next.entry(a.clone())
                .or_default()
                .extend(to.iter().cloned());
        }
    }

    // Breadth first from every blocked activity at once, looking for a blocker.
    let mut came_from: HashMap<String, Option<String>> = HashMap::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    for d in &blocked_ones {
        came_from.insert(d.clone(), None);
        queue.push_back(d.clone());
    }
    while let Some(at) = queue.pop_front() {
        if blocker_set.contains(at.as_str()) {
            // `at` is a blocker reached from some blocked activity: walk back
            // to it, then close the loop with the new edge.
            let mut path = vec![at.clone()];
            let mut cursor = at.clone();
            while let Some(Some(previous)) = came_from.get(&cursor) {
                path.push(previous.clone());
                cursor = previous.clone();
            }
            path.reverse();
            // path: d … at. The loop reads at → d … at.
            let mut chain = vec![at.clone()];
            chain.extend(path);
            return Err(loop_of(chain));
        }
        for following in next.get(&at).into_iter().flatten() {
            if !came_from.contains_key(following) {
                came_from.insert(following.clone(), Some(at.clone()));
                queue.push_back(following.clone());
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::work::tests::a_work;
    use crate::db::work::{add_activity, add_stage, remove_activity, remove_stage, snapshot};

    fn activity(id: &str) -> End {
        End {
            kind: Kind::Activity,
            id: id.into(),
        }
    }

    fn stage(id: &str) -> End {
        End {
            kind: Kind::Stage,
            id: id.into(),
        }
    }

    /// Two stages: Structure (Foundations, Walls) and Finishes (Plaster, Paint).
    struct Plan {
        structure: String,
        finishes: String,
        foundations: String,
        walls: String,
        plaster: String,
        paint: String,
    }

    fn plan(conn: &Connection) -> Plan {
        let structure = add_stage(conn, "Structure").unwrap();
        let finishes = add_stage(conn, "Finishes").unwrap();
        Plan {
            foundations: add_activity(conn, &structure, "Foundations").unwrap(),
            walls: add_activity(conn, &structure, "Walls").unwrap(),
            plaster: add_activity(conn, &finishes, "Plaster").unwrap(),
            paint: add_activity(conn, &finishes, "Paint").unwrap(),
            structure,
            finishes,
        }
    }

    fn cycle(result: Result<String>) -> String {
        match result {
            Err(Error::DependencyCycle(chain)) => chain,
            other => panic!("expected a dependency_cycle, got {other:?}"),
        }
    }

    #[test]
    fn a_dependency_is_stored_with_its_lag_and_comes_back_in_the_snapshot() {
        let conn = a_work();
        let p = plan(&conn);

        add(&conn, &activity(&p.walls), &stage(&p.finishes), 2).unwrap();

        let deps = snapshot(&conn).unwrap().dependencies;
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].blocker.kind, "activity");
        assert_eq!(deps[0].blocked.kind, "stage");
        assert_eq!(deps[0].blocked.id, p.finishes);
        assert_eq!(deps[0].lag_days, 2);

        set_lag(&conn, &deps[0].id, 5).unwrap();
        assert_eq!(snapshot(&conn).unwrap().dependencies[0].lag_days, 5);
        remove(&conn, &deps[0].id).unwrap();
        assert!(snapshot(&conn).unwrap().dependencies.is_empty());
    }

    #[test]
    fn a_loop_between_activities_is_refused_with_the_chain_by_name() {
        let conn = a_work();
        let p = plan(&conn);
        add(&conn, &activity(&p.foundations), &activity(&p.walls), 0).unwrap();
        add(&conn, &activity(&p.walls), &activity(&p.plaster), 0).unwrap();

        let chain = cycle(add(
            &conn,
            &activity(&p.plaster),
            &activity(&p.foundations),
            0,
        ));

        assert_eq!(chain, "Plaster → Foundations → Walls → Plaster");
        assert_eq!(
            snapshot(&conn).unwrap().dependencies.len(),
            2,
            "nothing was added"
        );
    }

    /// No two rows name each other, and still the plan would wait on itself:
    /// the stage stands for every activity in it, the Walls included.
    #[test]
    fn a_stage_waiting_on_an_activity_inside_it_is_a_loop() {
        let conn = a_work();
        let p = plan(&conn);

        let chain = cycle(add(&conn, &activity(&p.walls), &stage(&p.structure), 0));
        assert_eq!(chain, "Walls → Walls");

        let chain = cycle(add(
            &conn,
            &stage(&p.structure),
            &activity(&p.foundations),
            0,
        ));
        assert_eq!(chain, "Foundations → Foundations");
    }

    #[test]
    fn a_loop_closed_through_a_stage_endpoint_is_refused() {
        let conn = a_work();
        let p = plan(&conn);
        add(&conn, &stage(&p.structure), &stage(&p.finishes), 0).unwrap();

        let chain = cycle(add(&conn, &activity(&p.paint), &activity(&p.walls), 0));

        assert_eq!(chain, "Paint → Walls → Paint");
    }

    #[test]
    fn a_dependency_onto_an_empty_stage_is_accepted_and_can_close_no_loop() {
        let conn = a_work();
        let p = plan(&conn);
        let empty = add_stage(&conn, "Landscaping").unwrap();

        add(&conn, &stage(&p.finishes), &stage(&empty), 0).unwrap();
        add(&conn, &stage(&empty), &stage(&p.structure), 0).expect("empty: stands for nothing");
    }

    #[test]
    fn a_dependency_to_itself_twice_or_to_nothing_is_invalid_input() {
        let conn = a_work();
        let p = plan(&conn);
        add(&conn, &activity(&p.walls), &activity(&p.plaster), 1).unwrap();

        for (refused, sentence) in [
            (
                add(&conn, &activity(&p.walls), &activity(&p.walls), 0),
                SELF_DEPENDENCY,
            ),
            (
                add(&conn, &stage(&p.finishes), &stage(&p.finishes), 0),
                SELF_DEPENDENCY,
            ),
            (
                add(&conn, &activity(&p.walls), &activity(&p.plaster), 3),
                DUPLICATE_DEPENDENCY,
            ),
            (
                add(&conn, &activity(&new_id()), &activity(&p.plaster), 0),
                ACTIVITY_NOT_FOUND,
            ),
            (
                add(&conn, &activity(&p.walls), &stage(&new_id()), 0),
                STAGE_NOT_FOUND,
            ),
            (
                // An activity's id offered as a stage's is not a stage.
                add(&conn, &activity(&p.walls), &stage(&p.paint), 0),
                STAGE_NOT_FOUND,
            ),
        ] {
            let error = refused.expect_err(sentence);
            assert_eq!(error.kind(), "invalid_input");
            assert_eq!(error.to_string(), sentence);
        }
        let nobody = new_id();
        assert_eq!(
            set_lag(&conn, &nobody, 1).unwrap_err().to_string(),
            DEPENDENCY_NOT_FOUND
        );
        assert_eq!(
            remove(&conn, &nobody).unwrap_err().to_string(),
            DEPENDENCY_NOT_FOUND
        );
    }

    #[test]
    fn removing_an_activity_removes_the_dependencies_that_name_it_and_no_other() {
        let conn = a_work();
        let p = plan(&conn);
        add(&conn, &activity(&p.foundations), &activity(&p.walls), 0).unwrap();
        add(&conn, &activity(&p.walls), &stage(&p.finishes), 0).unwrap();
        add(&conn, &activity(&p.plaster), &activity(&p.paint), 0).unwrap();

        remove_activity(&conn, &p.walls).unwrap();

        let deps = snapshot(&conn).unwrap().dependencies;
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].blocker.id, p.plaster);
    }

    #[test]
    fn removing_a_stage_removes_the_dependencies_on_it_and_on_its_activities() {
        let conn = a_work();
        let p = plan(&conn);
        let later = add_stage(&conn, "Handover").unwrap();
        let clean = add_activity(&conn, &later, "Clean").unwrap();
        add(&conn, &stage(&p.structure), &stage(&p.finishes), 0).unwrap();
        add(&conn, &activity(&p.walls), &activity(&p.plaster), 0).unwrap();
        add(&conn, &activity(&p.paint), &activity(&p.foundations), 0)
            .expect_err("a loop through the stage dependency");
        add(&conn, &activity(&p.paint), &activity(&clean), 0).unwrap();

        remove_stage(&conn, &p.structure).unwrap();

        let deps = snapshot(&conn).unwrap().dependencies;
        assert_eq!(deps.len(), 1, "only Paint → Clean survives");
        assert_eq!(deps[0].blocked.id, clean);
    }

    #[test]
    fn the_schema_refuses_a_self_dependency_a_duplicate_a_bad_kind_and_a_bad_lag() {
        let conn = a_work();
        let p = plan(&conn);
        let a = &p.walls;
        let b = &p.plaster;
        let insert = |id: &str, from_kind: &str, from: &str, to_kind: &str, to: &str, lag: &str| {
            conn.execute(
                &format!(
                    "INSERT INTO dependency (id, blocker_kind, blocker_id, blocked_kind, blocked_id,
                                             lag_days, created_at)
                     VALUES ('{id}', '{from_kind}', '{from}', '{to_kind}', '{to}', {lag}, 't')"
                ),
                [],
            )
        };
        insert(&new_id(), "activity", a, "activity", b, "0").expect("an ordinary one");

        for (case, refused) in [
            ("self", insert(&new_id(), "activity", a, "activity", a, "0")),
            (
                "duplicate",
                insert(&new_id(), "activity", a, "activity", b, "4"),
            ),
            ("kind", insert(&new_id(), "room", a, "activity", b, "0")),
            (
                "negative lag",
                insert(&new_id(), "activity", b, "activity", a, "-1"),
            ),
            (
                "fractional lag",
                insert(&new_id(), "activity", b, "activity", a, "1.5"),
            ),
            (
                "long lag",
                insert(&new_id(), "activity", b, "activity", a, "3651"),
            ),
        ] {
            assert!(refused.is_err(), "{case}");
        }
    }
}
