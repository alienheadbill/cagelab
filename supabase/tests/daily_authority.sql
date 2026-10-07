-- Fight Card Daily authority contract checks.
-- Run against a migrated database. This file is intentionally transaction-safe:
-- if today's assignment does not already exist, any row created by the test is
-- rolled back at the end.

begin;

do $test$
declare
  v_first record;
  v_second record;
begin
  select * into v_first from public.get_today_daily_assignment();
  select * into v_second from public.get_today_daily_assignment();

  if v_first.challenge_date <> (current_timestamp at time zone 'UTC')::date then
    raise exception 'assignment date is not UTC today';
  end if;

  if v_first.fixture_id is null or pg_catalog.btrim(v_first.fixture_id) = '' then
    raise exception 'assignment fixture is missing';
  end if;

  if v_first.rules_version is null or pg_catalog.btrim(v_first.rules_version) = '' then
    raise exception 'assignment rules version is missing';
  end if;

  if v_first.seed < 0 then
    raise exception 'assignment seed is negative';
  end if;

  if v_first.challenge_date is distinct from v_second.challenge_date
     or v_first.fixture_id is distinct from v_second.fixture_id
     or v_first.rules_version is distinct from v_second.rules_version
     or v_first.seed is distinct from v_second.seed then
    raise exception 'assignment is not stable across repeated calls';
  end if;

  if not exists (
    select 1
    from private.daily_ruleset_fixtures as drf
    where drf.rules_version = v_first.rules_version
      and drf.fixture_id = v_first.fixture_id
  ) then
    raise exception 'assignment fixture does not belong to its rules version';
  end if;

  if pg_catalog.has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'anon unexpectedly has private-schema USAGE';
  end if;

  if pg_catalog.has_table_privilege('anon', 'private.daily_assignments', 'SELECT') then
    raise exception 'anon unexpectedly has direct assignment SELECT';
  end if;

  if pg_catalog.has_table_privilege('authenticated', 'private.daily_assignments', 'SELECT') then
    raise exception 'authenticated unexpectedly has direct assignment SELECT';
  end if;

  if not pg_catalog.has_function_privilege(
    'anon',
    'public.get_today_daily_assignment()',
    'EXECUTE'
  ) then
    raise exception 'anon cannot execute assignment RPC';
  end if;
end;
$test$;

set local role anon;
select * from public.get_today_daily_assignment();
reset role;

rollback;
