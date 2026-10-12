-- IB-017 undo.
--
-- Note what this does NOT claim: re-running the engine over the same frames reproduces today's
-- definition of a setup, not the one these rows were written under. `playbook_evaluations`
-- exists precisely because a later recomputation is a reconstruction, so dropping it is a real
-- loss of the record rather than a tidy-up.
drop table if exists cooldowns;
drop table if exists playbook_evaluations;
drop table if exists signals;
drop table if exists playbook_state;
drop type if exists playbook_source_mode;
