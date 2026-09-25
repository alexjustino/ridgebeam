-- Ridgebeam — application migration 002: the choices a person makes once and
-- expects to find again after a restart.
--
-- Key and value, both text, one row per setting. There is no column per
-- preference and no JSON blob holding all of them: a column per preference is a
-- migration every time a slice adds a choice, and one blob is a row that has to
-- be read, parsed and written whole to change a single word.
--
-- What the table does *not* say is which keys exist. That list is in the host
-- (`commands/settings.rs`), not in a CHECK: the list grows with the interface,
-- and a CHECK enumerating it would need a migration to record a fact the host
-- already refuses to get wrong. The bounds here are the ones that hold whatever
-- the list becomes — a key is an identifier, a value is a short string — so a
-- file edited by something other than this product still cannot make the host
-- read a megabyte to find out what the theme is.
--
-- Nothing in here is secret, and nothing in here is about a work.

CREATE TABLE settings (
    key        TEXT NOT NULL PRIMARY KEY CHECK (length(key) BETWEEN 1 AND 64),
    value      TEXT NOT NULL CHECK (length(value) <= 4096),
    updated_at TEXT NOT NULL
);
