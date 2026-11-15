-- =============================================================
-- 080 — Race and money guards (run AFTER 079)
-- =============================================================
-- Three holes the app alone cannot close, because each one is a
-- decision the database has to make atomically:
--
--   1. OVERBOOKING. accept_booking_hold checks capacity BEFORE it takes
--      the per-boat advisory lock, so two passengers tapping accept at the
--      same moment on a 6-seat boat can both pass the check and both land.
--      A trigger on bookings now re-checks the boat load while holding the
--      same lock, inside the accept transaction: whoever commits second is
--      refused with a readable message.
--
--   2. MONEY LEAVING AFTER THE BOAT SAILED. An approved downpayment can be
--      refunded after depart_time, and a completed trip can be refunded
--      from the web console. Both now raise.
--
--   3. ONE RIDE + ONE PADALA ON THE SAME DAY. 062's passenger-slot trigger
--      compares every service type against every other, so a passenger who
--      books a ride cannot also send a parcel that day. Cargo and passenger
--      bookings are now counted separately.
--
-- Idempotent: safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- 1. Capacity guard on accept
-- -------------------------------------------------------------
create or replace function enforce_bangka_capacity_on_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today    date := (now() at time zone 'Asia/Manila')::date;
  v_day      date := coalesce(new.scheduled_date, v_today);
  v_capacity integer;
  v_taken    integer;
begin
  -- Only a trip that is (or becomes) accepted occupies seats.
  if new.trip_stat <> 'accepted' or new.operator_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.trip_stat = 'accepted' then
    return new;
  end if;
  -- Parcel stubs carry a synthetic 1 pax and do not ride in a seat.
  if new.service_type = 'cargo' then
    return new;
  end if;

  -- Serialise every accept for this boat. Same key for every transaction,
  -- so the second one blocks here until the first commits.
  perform pg_advisory_xact_lock(hashtext('bangka-capacity:' || new.operator_id::text));

  select capacity into v_capacity
  from bangkas
  where bangkero_id = new.operator_id
    and deleted_at is null
  order by capacity desc
  limit 1;

  -- No boat on file yet: never block the demo on missing master data.
  if v_capacity is null then
    return new;
  end if;

  select coalesce(sum(b.num_of_passenger), 0) into v_taken
  from bookings b
  where b.operator_id = new.operator_id
    and b.trip_stat = 'accepted'
    and b.service_type <> 'cargo'
    and b.id <> new.id
    and coalesce(b.scheduled_date, v_today) = v_day;

  if v_taken + new.num_of_passenger > v_capacity then
    raise exception
      'This boat is full: % of % seats are already taken on that date.',
      v_taken, v_capacity;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bookings_capacity on bookings;
create trigger trg_bookings_capacity
  before insert or update of trip_stat, operator_id, num_of_passenger, scheduled_date on bookings
  for each row
  execute function enforce_bangka_capacity_on_accept();

revoke all on function enforce_bangka_capacity_on_accept() from public, anon;
grant execute on function enforce_bangka_capacity_on_accept() to authenticated, service_role;

-- -------------------------------------------------------------
-- 2. No refund once the boat has sailed
-- -------------------------------------------------------------
create or replace function guard_downpayment_refund_after_departure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status <> 'refunded' or old.status = 'refunded' then
    return new;
  end if;

  if new.booking_id is not null then
    if exists (
      select 1 from bookings
      where id = new.booking_id and depart_time is not null
    ) then
      raise exception 'That trip already sailed — its downpayment can no longer be refunded.';
    end if;
  end if;

  if new.boat_rental_id is not null then
    if exists (
      select 1 from boat_rentals
      where id = new.boat_rental_id
        and (started_at is not null or completed_at is not null or status = 'completed')
    ) then
      raise exception 'That charter already started — its downpayment can no longer be refunded.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_downpayments_refund_guard on downpayments;
create trigger trg_downpayments_refund_guard
  before update of status on downpayments
  for each row
  execute function guard_downpayment_refund_after_departure();

revoke all on function guard_downpayment_refund_after_departure() from public, anon;
grant execute on function guard_downpayment_refund_after_departure() to authenticated, service_role;

-- -------------------------------------------------------------
-- 3. One ride AND one padala per day (062 counted them together)
-- -------------------------------------------------------------
create or replace function enforce_passenger_booking_slot()
returns trigger
language plpgsql set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Manila')::date;
  v_day date := coalesce(new.scheduled_date, v_today);
  v_same_day boolean := v_day <= v_today;
  v_clash integer;
begin
  select count(*) into v_clash
  from bookings b
  where b.user_id = new.user_id
    and b.id <> new.id
    and b.trip_stat in ('pending', 'open', 'accepted')
    and coalesce(b.scheduled_date, v_today) = v_day
    -- A ride and a padala are different journeys for the same person.
    and (b.service_type = 'cargo') = (new.service_type = 'cargo')
    and (v_same_day or b.scheduled_time is not distinct from new.scheduled_time);

  if v_clash > 0 then
    if v_same_day then
      raise exception 'You already have a same-day booking of this kind. Finish or cancel it first.';
    else
      raise exception 'You already have an advance booking for that date and sailing time.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bookings_passenger_slot on bookings;
create trigger trg_bookings_passenger_slot
  before insert or update of trip_stat, scheduled_date, scheduled_time on bookings
  for each row
  when (new.trip_stat in ('pending', 'open', 'accepted'))
  execute function enforce_passenger_booking_slot();

revoke all on function enforce_passenger_booking_slot() from public, anon;
grant execute on function enforce_passenger_booking_slot() to authenticated, service_role;

-- Verify:
--   -- triggers present
--   select tgname from pg_trigger where tgrelid = 'bookings'::regclass;
--   -- second accept beyond capacity must raise "This boat is full"
--   -- refunding an approved downpayment after depart_time must raise
--   -- a passenger with a ride may still create one padala the same day
