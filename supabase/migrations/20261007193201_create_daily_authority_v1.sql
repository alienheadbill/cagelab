create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table private.daily_rulesets (
  rules_version text primary key,
  active_from date not null unique,
  rotation_salt bigint not null,
  created_at timestamptz not null default current_timestamp,
  constraint daily_rulesets_rules_version_not_blank
    check (pg_catalog.btrim(rules_version) <> '')
);

create table private.daily_ruleset_fixtures (
  rules_version text not null
    references private.daily_rulesets(rules_version) on delete restrict,
  fixture_id text not null,
  position smallint not null
    constraint daily_ruleset_fixtures_position_nonnegative check (position >= 0),
  created_at timestamptz not null default current_timestamp,
  primary key (rules_version, fixture_id),
  unique (rules_version, position),
  constraint daily_ruleset_fixtures_fixture_id_not_blank
    check (pg_catalog.btrim(fixture_id) <> '')
);

create table private.daily_assignments (
  challenge_date date primary key,
  rules_version text not null,
  fixture_id text not null,
  seed integer not null
    constraint daily_assignments_seed_nonnegative check (seed >= 0),
  created_at timestamptz not null default current_timestamp,
  constraint daily_assignments_ruleset_fixture_fk
    foreign key (rules_version, fixture_id)
    references private.daily_ruleset_fixtures(rules_version, fixture_id)
    on delete restrict
);

alter table private.daily_rulesets enable row level security;
alter table private.daily_ruleset_fixtures enable row level security;
alter table private.daily_assignments enable row level security;

revoke all on table private.daily_rulesets from public, anon, authenticated;
revoke all on table private.daily_ruleset_fixtures from public, anon, authenticated;
revoke all on table private.daily_assignments from public, anon, authenticated;

insert into private.daily_rulesets (rules_version, active_from, rotation_salt)
values ('fight-card-v1', date '2026-10-07', 2026100701);

insert into private.daily_ruleset_fixtures (rules_version, fixture_id, position)
values
  ('fight-card-v1', 'card-2024-001-r1', 0),
  ('fight-card-v1', 'card-2024-002-r1', 1),
  ('fight-card-v1', 'card-2024-003-r1', 2);

create or replace function public.get_today_daily_assignment()
returns table (
  challenge_date date,
  fixture_id text,
  rules_version text,
  seed integer
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_date date := (current_timestamp at time zone 'UTC')::date;
  v_rules private.daily_rulesets%rowtype;
  v_fixture_count integer;
  v_hash bytea;
  v_fixture_hash bigint;
  v_seed_hash bigint;
  v_fixture_position integer;
  v_fixture_id text;
  v_seed integer;
begin
  return query
  select da.challenge_date, da.fixture_id, da.rules_version, da.seed
  from private.daily_assignments as da
  where da.challenge_date = v_date;

  if found then
    return;
  end if;

  select dr.*
  into v_rules
  from private.daily_rulesets as dr
  where dr.active_from <= v_date
  order by dr.active_from desc
  limit 1;

  if not found then
    raise exception 'No Daily ruleset is active for %', v_date
      using errcode = 'P0001';
  end if;

  select pg_catalog.count(*)::integer
  into v_fixture_count
  from private.daily_ruleset_fixtures as drf
  where drf.rules_version = v_rules.rules_version;

  if v_fixture_count < 1 then
    raise exception 'Daily ruleset % has no fixtures', v_rules.rules_version
      using errcode = 'P0001';
  end if;

  v_hash := pg_catalog.decode(
    pg_catalog.md5(
      v_date::text
      || '|fight-card-daily|'
      || v_rules.rules_version
      || '|'
      || v_rules.rotation_salt::text
    ),
    'hex'
  );

  v_fixture_hash :=
      pg_catalog.get_byte(v_hash, 0)::bigint * 16777216
    + pg_catalog.get_byte(v_hash, 1)::bigint * 65536
    + pg_catalog.get_byte(v_hash, 2)::bigint * 256
    + pg_catalog.get_byte(v_hash, 3)::bigint;

  v_seed_hash :=
      pg_catalog.get_byte(v_hash, 4)::bigint * 16777216
    + pg_catalog.get_byte(v_hash, 5)::bigint * 65536
    + pg_catalog.get_byte(v_hash, 6)::bigint * 256
    + pg_catalog.get_byte(v_hash, 7)::bigint;

  v_fixture_position := pg_catalog.mod(v_fixture_hash, v_fixture_count)::integer;
  v_seed := pg_catalog.mod(v_seed_hash, 2147483647)::integer;

  select drf.fixture_id
  into v_fixture_id
  from private.daily_ruleset_fixtures as drf
  where drf.rules_version = v_rules.rules_version
    and drf.position = v_fixture_position;

  if not found then
    raise exception 'Daily ruleset % is missing fixture position %',
      v_rules.rules_version, v_fixture_position
      using errcode = 'P0001';
  end if;

  insert into private.daily_assignments (
    challenge_date,
    rules_version,
    fixture_id,
    seed
  )
  values (
    v_date,
    v_rules.rules_version,
    v_fixture_id,
    v_seed
  )
  on conflict on constraint daily_assignments_pkey do nothing;

  return query
  select da.challenge_date, da.fixture_id, da.rules_version, da.seed
  from private.daily_assignments as da
  where da.challenge_date = v_date;
end;
$function$;

revoke all on function public.get_today_daily_assignment() from public;
grant execute on function public.get_today_daily_assignment() to anon, authenticated, service_role;

comment on schema private is
  'Non-exposed CageLab backend state. Access through reviewed public RPCs only.';

comment on table private.daily_rulesets is
  'Append-only Fight Card Daily rule versions, activated by UTC date.';

comment on table private.daily_ruleset_fixtures is
  'Immutable ordered fixture pool for each Fight Card Daily rules version.';

comment on table private.daily_assignments is
  'Persisted authoritative UTC date to fixture/rules/seed assignments.';

comment on function public.get_today_daily_assignment() is
  'Returns or atomically creates today''s authoritative UTC Fight Card Daily assignment. Clients supply no authority fields.';
