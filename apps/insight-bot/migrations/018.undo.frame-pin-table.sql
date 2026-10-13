-- IB-054 undo.
--
-- Dropping the pin table loses the pins, and `playbook_evaluations.frame_revision` /
-- `frame_version` are NOT a substitute: they record what each arm read, which is the thing the
-- pin exists to make agree. If they already disagree for a close, the pin is what would have
-- told you, and after this it is gone.
--
-- Partitions go with the parent — `drop table` on a partitioned table takes them.
drop table if exists playbook_frame_pins;
