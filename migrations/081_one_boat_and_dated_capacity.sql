-- =============================================================
-- 081 — One boat per bangkero, no accept without an active boat,
--       and a date-aware fit check (run AFTER 080)
-- =============================================================
-- Four things the app alone could not fix:
--
--   1. DUPLICATE BOATS. profile.service's boat read used
--      maybeSingle(), which ERRORS when a bangkero already had two
--      rows — so every "save" fell into the insert branch and
--      created another boat. Pedro ended up with a fleet. Every
--      extra boat is RETIRED (soft-deleted, 049) and a partial
--      UNIQUE index makes it impossible to repeat.
--
--   2. ACCEPTING WITH NO BOAT. accept_booking_hold only checked that
--      the bangkero row existed, so an account with no active boat
--      could take trips it could never sail (no manifest, no
--      capacity, no QR). It now raises.
--
--   3. "BOAT FULL" ON A FUTURE DATE. fits_booking summed accepted
--      passengers across EVERY date, so tomorrow's trip ate today's
--      seats (and vice versa). It now compares the booking's own
--      sailing day, matching 080's capacity trigger.
--
--   4. CHARTER BOARDING. passenger_details has no UPDATE policy, so
--      the sailing-day tick list could not exist. set_rental_rider_boarded
--      proves the caller owns the rental's boat and flips boarded_at.
--
-- Idempotent: safe to re-run.
-- =============================================================

begin;

-- -------------------------------------------------------------
-- 1. Collapse duplicate boats — retire the extras, keep the history
-- -------------------------------------------------------------
-- 046 refuses a DELETE for any boat with linked rows, and 047/049
-- put triggers on re-pointing bangka_id, so duplicates are RETIRED
-- instead: 049's soft-delete keeps every booking, rental, manifest,
-- alert and tracking row exactly where it is, and the partial unique
-- index below only covers live rows.
--
-- The keeper is the boat with the most history; the insert-bug
-- duplicates are empty, so they rank last. One statement on purpose:
-- the Supabase SQL editor commits between statements, so a TEMP table
-- does not survive from the CREATE to the UPDATE (42P01).
update bangkas k
set deleted_was_active = coalesce(k.deleted_was_active, k.is_active),
    is_deleted = true,
    deleted_at = now(),
    is_active = false,
    rental_listed = false
where k.deleted_at is null
  and k.id in (
    select r.id
    from (
      select id,
             row_number() over (
               partition by bangkero_id
               order by n_rentals desc, n_manifests desc, n_fixes desc, id
             ) as rn
      from (
        select k2.id, k2.bangkero_id,
               (select count(*) from boat_rentals   br where br.bangka_id = k2.id) as n_rentals,
               (select count(*) from trip_manifest  tm where tm.bangka_id = k2.id) as n_manifests,
               (select count(*) from vessel_tracking vt where vt.bangka_id = k2.id) as n_fixes
        from bangkas k2
        where k2.deleted_at is null
      ) s
    ) r
    where r.rn > 1
  )
  -- Same columns admin_delete_bangka writes (049). 048's trigger refuses
  -- to deactivate a boat that is mid-trip, so those are skipped here and
  -- the check below stops the migration with a readable message.
  and not exists (
    select 1 from bookings b
    where b.bangka_id = k.id and b.trip_stat in ('open', 'pending', 'accepted')
  )
  and not exists (
    select 1 from boat_rentals rent
    where rent.bangka_id = k.id
      and rent.status in ('awaiting_payment', 'pending', 'confirmed')
  );

do $$
declare
  v_bad text;
begin
  select string_agg(x.bangkero_id::text || ' (' || x.n || ' live boats)', ', ')
  into v_bad
  from (
    select bangkero_id, count(*) as n
    from bangkas
    where deleted_at is null
    group by bangkero_id
    having count(*) > 1
  ) x;
  if v_bad is not null then
    raise exception 'More than one live boat for: %. Finish or cancel their bookings/rentals, then re-run 081.', v_bad;
  end if;
end $$;

-- Soft-deleted boats are allowed to pile up (049); live ones are not.
create unique index if not exists bangkas_one_per_bangkero
  on bangkas (bangkero_id)
  where deleted_at is null;

-- -------------------------------------------------------------
-- 2. Date-aware fit check
-- -------------------------------------------------------------
-- The old 3-arg version must go, otherwise a 3-arg call is ambiguous
-- between it and this one's default.
drop function if exists fits_booking(uuid, text, int);

create or replace function fits_booking(
  p_bangkero uuid,
  p_service text,
  p_pax int,
  p_date date default null
) returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_day date := coalesce(p_date, v_today);
  v_capacity integer;
  v_taken integer;
begin
  -- A rental is a whole-boat charter, not a seat sale.
  if p_service = 'rental' then
    return true;
  end if;

  select capacity into v_capacity
  from bangkas
  where bangkero_id = p_bangkero
    and is_active
    and deleted_at is null
  order by id
  limit 1;

  select coalesce(sum(b.num_of_passenger), 0) into v_taken
  from bookings b
  where b.operator_id = p_bangkero
    and b.trip_stat = 'accepted'
    and b.service_type <> 'cargo'
    and coalesce(b.scheduled_date, v_today) = v_day;

  return coalesce(v_capacity, 0) >= p_pax + v_taken;
end;
$$;

revoke all on function fits_booking(uuid, text, int, date) from public, anon;
grant execute on function fits_booking(uuid, text, int, date) to authenticated, service_role;

-- -------------------------------------------------------------
-- 3. Charter boarding tick
-- -------------------------------------------------------------
-- passenger_details has no UPDATE policy at all (tracker E7), so the
-- bangkero cannot tick a charter party member from the client. This
-- RPC proves the caller owns the rental's boat, then writes only
-- boarded_at on that rental's companion row.
create or replace function set_rental_rider_boarded(
  p_rental_id uuid,
  p_passenger_id uuid,
  p_boarded boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1
    from boat_rentals r
    join bangkas k on k.id = r.bangka_id
    where r.id = p_rental_id
      and k.bangkero_id = auth.uid()
  ) then
    raise exception 'this charter is not on your boat';
  end if;

  update passenger_details
  set boarded_at = case when p_boarded then now() else null end
  where id = p_passenger_id
    and boat_rental_id = p_rental_id;
  if not found then
    raise exception 'that passenger is not on this charter';
  end if;
end;
$$;

revoke all on function set_rental_rider_boarded(uuid, uuid, boolean) from public, anon;
grant execute on function set_rental_rider_boarded(uuid, uuid, boolean) to authenticated, service_role;

-- -------------------------------------------------------------
-- 4. Accept: needs a real, active boat + the booking's own day
-- -------------------------------------------------------------
-- Body is 071's verbatim, with the boat gate and the date now passed
-- through to fits_booking.
create or replace function accept_booking_hold(
  p_booking_id uuid, p_operator_name text
) returns void as $$
declare
  v bookings%rowtype;
  v_route routes%rowtype;
  v_port text;
  v_dest text;
  v_advance boolean;
  v_group_id uuid;
  v_group_day date;
  v_group_slot text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into v from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'booking not found';
  end if;
  if v.trip_stat <> 'open' then
    raise exception 'taken by another bangkero';
  end if;

  if not coalesce(v.is_dispatchable, true) then
    raise exception 'this booking cannot be accepted directly';
  end if;

  v_advance := v.scheduled_date is not null
           and v.scheduled_date > (now() at time zone 'Asia/Manila')::date;

  if not v_advance
     and (v.held_by is distinct from auth.uid()
          or v.hold_expires_at is null
          or v.hold_expires_at <= now()) then
    perform assign_next_hold(p_booking_id);
    select * into v from bookings where id = p_booking_id;
    if v.trip_stat <> 'open' then
      raise exception 'taken by another bangkero';
    end if;
  end if;

  if v.rejected_by is not null and v.rejected_by @> array[auth.uid()] then
    raise exception 'you already passed on this request';
  end if;

  select * into v_route from routes where id = v.route_id;
  v_port := v_route.start_port_id;
  v_dest := v_route.end_port_id;

  if not v_advance and not dev_dispatch_bypass() then
    if not exists (
      select 1 from port_queue pq
      where pq.bangkero_id = auth.uid()
        and pq.port_id = v_port
        and pq.left_at is null
    ) then
      raise exception 'your boat is not queued at this port';
    end if;
    if exists (
      select 1 from port_queue pq
      where pq.bangkero_id = auth.uid()
        and pq.port_id = v_port
        and pq.left_at is null
        and pq.entered_at > now() - interval '5 minutes'
    ) then
      raise exception 'your boat is still entering the port queue';
    end if;
  end if;

  if not exists (select 1 from bangkeros b where b.id = auth.uid()) then
    raise exception 'not a registered bangkero';
  end if;
  if not exists (
    select 1 from bangkeros b where b.id = auth.uid() and b.is_available
  ) then
    raise exception 'you are offline — turn on availability to accept';
  end if;

  -- 081: a boat must exist and be active before any trip is taken.
  if not exists (
    select 1 from bangkas k
    where k.bangkero_id = auth.uid()
      and k.is_active
      and k.deleted_at is null
  ) then
    raise exception 'your boat is not active yet — wait for BangkaGo to approve it before accepting trips';
  end if;

  if not dev_gates_bypass() then
    if not exists (
      select 1 from bangkeros b
      where b.id = auth.uid() and b.verification_stat = 'verified'
    ) then
      raise exception 'your documents are not approved yet';
    end if;
    if not bangkero_rating_ok(auth.uid()) then
      raise exception 'your rating is too low to accept bookings';
    end if;
  end if;

  if not v_advance and not dev_dispatch_bypass() then
    if not exists (
      select 1 from vessel_tracking vt
      join bangkas bk on bk.id = vt.bangka_id
      where bk.bangkero_id = auth.uid()
        and vt.recorded_at > now() - interval '3 minutes'
    ) then
      raise exception 'your boat has no recent GPS position';
    end if;
  end if;

  if not v_advance and not route_ok(auth.uid(), v_dest) then
    raise exception 'you have accepted trips to another destination';
  end if;

  if not fits_booking(
    auth.uid(),
    v.service_type,
    v.num_of_passenger,
    coalesce(v.scheduled_date, (now() at time zone 'Asia/Manila')::date)
  ) then
    raise exception 'not enough space on your boat for this trip';
  end if;

  if not v_advance and v.held_by is distinct from auth.uid() then
    raise exception 'this request is being offered to another boat right now';
  end if;

  v_group_day := coalesce(
    v.scheduled_date,
    (now() at time zone 'Asia/Manila')::date
  );
  v_group_slot := case
    when v_advance then coalesce(v.scheduled_time, '')
    else ''
  end;

  perform pg_advisory_xact_lock(
    hashtext('booking_group'),
    hashtext(auth.uid()::text || '|' || v.route_id || '|' ||
             v_group_day::text || '|' || v_group_slot)
  );

  select group_booking_id into v_group_id
  from bookings
  where operator_id = auth.uid()
    and route_id = v.route_id
    and trip_stat = 'accepted'
    and group_booking_id is not null
    and coalesce(scheduled_date, (now() at time zone 'Asia/Manila')::date) = v_group_day
    and (not v_advance or coalesce(scheduled_time, '') = v_group_slot)
  order by accepted_at asc nulls last
  limit 1;

  if v_group_id is null and exists (
    select 1
    from bookings
    where operator_id = auth.uid()
      and route_id = v.route_id
      and trip_stat = 'accepted'
      and group_booking_id is null
      and coalesce(scheduled_date, (now() at time zone 'Asia/Manila')::date) = v_group_day
      and (not v_advance or coalesce(scheduled_time, '') = v_group_slot)
  ) then
    v_group_id := gen_random_uuid();
    update bookings
    set group_booking_id = v_group_id
    where operator_id = auth.uid()
      and route_id = v.route_id
      and trip_stat = 'accepted'
      and group_booking_id is null
      and coalesce(scheduled_date, (now() at time zone 'Asia/Manila')::date) = v_group_day
      and (not v_advance or coalesce(scheduled_time, '') = v_group_slot);
  end if;

  update bookings
  set trip_stat = 'accepted',
      operator_id = auth.uid(),
      operator_name = p_operator_name,
      accepted_at = now(),
      held_by = null,
      hold_expires_at = null,
      group_booking_id = v_group_id
  where id = p_booking_id
    and trip_stat = 'open';
  if not found then
    raise exception 'taken by another bangkero';
  end if;
end;
$$ language plpgsql security definer set search_path = public;

revoke execute on function accept_booking_hold(uuid, text) from public;
revoke execute on function accept_booking_hold(uuid, text) from anon;
grant execute on function accept_booking_hold(uuid, text) to authenticated;
grant execute on function accept_booking_hold(uuid, text) to service_role;

commit;

-- Verify:
--   -- no bangkero should own two live boats
--   select bangkero_id, count(*) from bangkas where deleted_at is null
--   group by 1 having count(*) > 1;                        -- expect 0 rows
--   -- a bangkero with no active boat must be refused
--   select accept_booking_hold('<open booking id>', 'Test'); -- expect the boat error
--   -- tomorrow's trip must not eat today's seats
--   select fits_booking('<uid>', 'ride', 4, current_date + 1);
