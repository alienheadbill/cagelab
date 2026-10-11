insert into private.daily_rulesets (rules_version, active_from, rotation_salt)
values ('fight-card-v2', date '2026-10-12', 2026101202);

insert into private.daily_ruleset_fixtures (rules_version, fixture_id, position)
values
  ('fight-card-v2', 'card-2024-001-r1', 0),
  ('fight-card-v2', 'card-2024-002-r1', 1),
  ('fight-card-v2', 'card-2024-003-r1', 2);
