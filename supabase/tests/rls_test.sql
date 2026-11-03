-- RLS negative control: a second user cannot see, or write into, another user's company.
-- Run: supabase test db   (needs the local Supabase stack, or psql against a rehearsal database).
begin;
create extension if not exists pgtap;
select plan(6);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'owner@argus.test'),
  ('00000000-0000-0000-0000-00000000000b', 'stranger@argus.test');

-- Owner creates Lovixa.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000a","role":"authenticated"}';
select lives_ok($$ select public.create_company('Lovixa', 'group planning app', 'TN', 'Tunis') $$, 'owner creates a company');
select is((select count(*)::int from public.companies), 1, 'owner sees their company');
select is((select slug from public.companies), 'lovixa', 'slug derived from the name');

-- Remember the id as the superuser, then switch to the stranger.
reset role;
select set_config('argus.test_company', (select id::text from public.companies where slug = 'lovixa'), true);
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-00000000000b","role":"authenticated"}';

select is((select count(*)::int from public.companies), 0, 'stranger sees no company');
select is((select count(*)::int from public.company_members), 0, 'stranger sees no membership');
select throws_ok(
  $$ insert into public.sources (company_id, kind, external_id, name)
     values (current_setting('argus.test_company')::uuid, 'ad_library_query', 'padel', 'padel') $$,
  '42501', null, 'stranger cannot write a source into Lovixa');

select * from finish();
rollback;
