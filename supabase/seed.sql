-- Dev-only users for local Supabase. "Sign in as test user (dev)" signs in as dev@example.com /
-- password123. The others (same password) are there for the e2e flows to have someone to be Friends
-- with (ticket 11); scripts/e2e-db.mjs acts as them. Each has a username, so no flow meets the
-- "Choose a username" screen unless it clears one first.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  u.id,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('password123', extensions.gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}',
  '{}',
  now(),
  now(),
  '', '', '', ''
from (values
  ('d0d0d0d0-0000-4000-8000-000000000001'::uuid, 'dev@example.com'),
  ('d0d0d0d0-0000-4000-8000-000000000002'::uuid, 'sam@example.com'),
  ('d0d0d0d0-0000-4000-8000-000000000003'::uuid, 'alex@example.com')
) as u (id, email);

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  gen_random_uuid(),
  u.id,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email',
  now(),
  now(),
  now()
from auth.users u
where u.id in (
  'd0d0d0d0-0000-4000-8000-000000000001',
  'd0d0d0d0-0000-4000-8000-000000000002',
  'd0d0d0d0-0000-4000-8000-000000000003'
);

-- The sign-up trigger made their Profiles; these are their usernames.
update public.profiles p set username = u.username
from (values
  ('d0d0d0d0-0000-4000-8000-000000000001'::uuid, 'dev'),
  ('d0d0d0d0-0000-4000-8000-000000000002'::uuid, 'sam'),
  ('d0d0d0d0-0000-4000-8000-000000000003'::uuid, 'alex_cooks')
) as u (id, username)
where p.id = u.id;
