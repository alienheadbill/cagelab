-- Fight Card Daily leaderboard RPC contract checks.
-- Any test rows are rolled back.

begin;

do $test$
declare
  v_assignment record;
  v_score_id bigint;
  v_count integer;
begin
  select * into v_assignment from public.get_today_daily_assignment();

  v_score_id := public.submit_daily_score(
    v_assignment.challenge_date,
    v_assignment.fixture_id,
    v_assignment.rules_version,
    88,
    '  Contract Test  '
  );

  if v_score_id is null then
    raise exception 'valid score submission returned no id';
  end if;

  select count(*)::integer
  into v_count
  from private.daily_scores as ds
  where ds.id = v_score_id
    and ds.display_name = 'Contract Test'
    and ds.score = 88;

  if v_count <> 1 then
    raise exception 'valid score was not normalized/stored correctly';
  end if;

  begin
    perform public.submit_daily_score(
      v_assignment.challenge_date,
      'not-a-real-fixture',
      v_assignment.rules_version,
      88,
      'Invalid Assignment'
    );
    raise exception 'invalid assignment was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  begin
    perform public.submit_daily_score(
      v_assignment.challenge_date,
      v_assignment.fixture_id,
      v_assignment.rules_version,
      101,
      'Invalid Score'
    );
    raise exception 'out-of-range score was accepted';
  exception
    when sqlstate '22023' then null;
  end;

  if pg_catalog.has_schema_privilege('anon', 'private', 'USAGE') then
    raise exception 'anon unexpectedly has private-schema USAGE';
  end if;

  if pg_catalog.has_table_privilege('anon', 'private.daily_scores', 'SELECT') then
    raise exception 'anon unexpectedly has direct Daily score SELECT';
  end if;

  if not pg_catalog.has_function_privilege(
    'anon',
    'public.submit_daily_score(date,text,text,integer,text)',
    'EXECUTE'
  ) then
    raise exception 'anon cannot submit through Daily score RPC';
  end if;

  if not pg_catalog.has_function_privilege(
    'anon',
    'public.get_daily_leaderboard(date,text,text,integer)',
    'EXECUTE'
  ) then
    raise exception 'anon cannot read Daily leaderboard RPC';
  end if;
end;
$test$;

set local role anon;
select public.submit_daily_score(
  (select challenge_date from public.get_today_daily_assignment()),
  (select fixture_id from public.get_today_daily_assignment()),
  (select rules_version from public.get_today_daily_assignment()),
  91,
  'Anon Contract'
);

select * from public.get_daily_leaderboard(
  (select challenge_date from public.get_today_daily_assignment()),
  (select fixture_id from public.get_today_daily_assignment()),
  (select rules_version from public.get_today_daily_assignment()),
  20
);
reset role;

rollback;
