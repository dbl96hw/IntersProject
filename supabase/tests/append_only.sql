-- Checks that candidate_reviews is append-only (see migrations/001_init.sql).
-- Run after the migration, e.g. `psql "$DATABASE_URL" -f supabase/tests/append_only.sql` or in the SQL editor.
-- Everything runs in one transaction that ends with ROLLBACK, so no data is left behind
-- (if a check fails, the transaction is aborted and the ROLLBACK still discards it).
-- Expected output: two notices starting with "OK: blocked".

begin;

-- Minimum rows: candidates.message_id is not null, so a message is needed too.
insert into chats (id, title)
values ('00000000-0000-4000-8000-000000000001', 'append-only test');

insert into messages (id, chat_id, role, kind)
values ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'assistant', 'analysis');

insert into candidates (id, chat_id, message_id, candidate_id, colour, engine_colour)
values ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002', 'SYN-MZ-00001', 'RED', 'RED');

insert into candidate_reviews (id, candidate_row_id, decision, user_name)
values ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'pass', 'append-only-test');

-- The "NOT blocked" error is raised outside the inner block so its own handler cannot swallow it.
do $$
declare
  is_blocked boolean := false;
begin
  begin
    update candidate_reviews set comment = 'changed' where id = '00000000-0000-4000-8000-000000000004';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
    is_blocked := true;
    raise notice 'OK: blocked UPDATE (%)', sqlerrm;
  end;
  if not is_blocked then
    raise exception 'NOT blocked: UPDATE on candidate_reviews succeeded';
  end if;
end;
$$;

do $$
declare
  is_blocked boolean := false;
begin
  begin
    delete from candidate_reviews where id = '00000000-0000-4000-8000-000000000004';
  exception when raise_exception then
    if sqlerrm not like '%append-only%' then raise; end if;
    is_blocked := true;
    raise notice 'OK: blocked DELETE (%)', sqlerrm;
  end;
  if not is_blocked then
    raise exception 'NOT blocked: DELETE on candidate_reviews succeeded';
  end if;
end;
$$;

rollback;
