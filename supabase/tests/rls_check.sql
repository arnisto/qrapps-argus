-- RLS negative check for the hosted project, runnable through the Management API.
-- Always ends by raising ARGUS_RLS_RESULT, which rolls back every row it created.
do $$
declare
  owner_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  cid uuid;
  owner_sees int;
  stranger_sees int;
  stranger_write text := 'allowed';
begin
  insert into auth.users (id, email, aud, role) values
    (owner_id, 'owner-' || owner_id || '@argus.test', 'authenticated', 'authenticated'),
    (stranger_id, 'stranger-' || stranger_id || '@argus.test', 'authenticated', 'authenticated');

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  select id into cid from public.create_company('RLS check ' || left(owner_id::text, 8), 'test', 'TN', null);
  select count(*) into owner_sees from public.companies where id = cid;

  perform set_config('request.jwt.claims', json_build_object('sub', stranger_id, 'role', 'authenticated')::text, true);
  select count(*) into stranger_sees from public.companies where id = cid;
  begin
    insert into public.sources (company_id, kind, external_id, name) values (cid, 'ad_library_query', 'x', 'x');
  exception when insufficient_privilege then
    stranger_write := 'refused';
  end;

  raise exception 'ARGUS_RLS_RESULT %', json_build_object(
    'owner_sees_company', owner_sees = 1,
    'stranger_sees_company', stranger_sees <> 0,
    'stranger_write', stranger_write,
    'pass', owner_sees = 1 and stranger_sees = 0 and stranger_write = 'refused');
end $$;
