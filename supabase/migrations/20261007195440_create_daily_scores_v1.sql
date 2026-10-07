alter table private.daily_assignments
  add constraint daily_assignments_identity_key
  unique (challenge_date, fixture_id, rules_version);

create table private.daily_scores (
  id bigint generated always as identity primary key,
  challenge_date date not null,
  fixture_id text not null,
  rules_version text not null,
  score smallint not null
    constraint daily_scores_score_range check (score between 0 and 100),
  display_name text not null,
  created_at timestamptz not null default current_timestamp,
  constraint daily_scores_display_name_length
    check (pg_catalog.char_length(display_name) between 1 and 24),
  constraint daily_scores_assignment_identity_fk
    foreign key (challenge_date, fixture_id, rules_version)
    references private.daily_assignments(challenge_date, fixture_id, rules_version)
    on delete restrict
);

alter table private.daily_scores enable row level security;
revoke all on table private.daily_scores from public, anon, authenticated;

create index daily_scores_leaderboard_idx
  on private.daily_scores (
    challenge_date,
    fixture_id,
    rules_version,
    score desc,
    created_at asc
  );

create or replace function public.submit_daily_score(
  p_challenge_date date,
  p_fixture_id text,
  p_rules_version text,
  p_score integer,
  p_display_name text default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_display_name text;
  v_score_id bigint;
begin
  if p_score is null or p_score < 0 or p_score > 100 then
    raise exception 'Daily score must be an integer from 0 to 100'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.daily_assignments as da
    where da.challenge_date = p_challenge_date
      and da.fixture_id = p_fixture_id
      and da.rules_version = p_rules_version
  ) then
    raise exception 'Daily assignment identity is not valid'
      using errcode = '22023';
  end if;

  v_display_name := pg_catalog.btrim(coalesce(p_display_name, ''));
  if v_display_name = '' then
    v_display_name := 'Anonymous';
  end if;

  if pg_catalog.char_length(v_display_name) > 24 then
    raise exception 'Display name must be 24 characters or fewer'
      using errcode = '22023';
  end if;

  insert into private.daily_scores (
    challenge_date,
    fixture_id,
    rules_version,
    score,
    display_name
  )
  values (
    p_challenge_date,
    p_fixture_id,
    p_rules_version,
    p_score::smallint,
    v_display_name
  )
  returning id into v_score_id;

  return v_score_id;
end;
$function$;

create or replace function public.get_daily_leaderboard(
  p_challenge_date date,
  p_fixture_id text,
  p_rules_version text,
  p_limit integer default 20
)
returns table (
  display_name text,
  score integer,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'Leaderboard limit must be between 1 and 200'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from private.daily_assignments as da
    where da.challenge_date = p_challenge_date
      and da.fixture_id = p_fixture_id
      and da.rules_version = p_rules_version
  ) then
    raise exception 'Daily assignment identity is not valid'
      using errcode = '22023';
  end if;

  return query
  select
    ds.display_name,
    ds.score::integer,
    ds.created_at
  from private.daily_scores as ds
  where ds.challenge_date = p_challenge_date
    and ds.fixture_id = p_fixture_id
    and ds.rules_version = p_rules_version
  order by ds.score desc, ds.created_at asc
  limit p_limit;
end;
$function$;

revoke all on function public.submit_daily_score(date, text, text, integer, text) from public;
revoke all on function public.get_daily_leaderboard(date, text, text, integer) from public;
grant execute on function public.submit_daily_score(date, text, text, integer, text)
  to anon, authenticated, service_role;
grant execute on function public.get_daily_leaderboard(date, text, text, integer)
  to anon, authenticated, service_role;

comment on table private.daily_scores is
  'Anonymous/community Fight Card Daily scores keyed to an existing authoritative assignment. Client-computed scores are not anti-cheat verified.';

comment on function public.submit_daily_score(date, text, text, integer, text) is
  'Submits a 0-100 client-computed Daily score only when date/fixture/rules identify an existing authoritative assignment.';

comment on function public.get_daily_leaderboard(date, text, text, integer) is
  'Reads scores for one exact authoritative Daily assignment, ordered by score descending then submission time.';
