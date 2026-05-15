-- Seed dev bypass profiles so tasks.created_by FK resolves in development.
-- These UUIDs match DEV_PROFILE_IDS in lib/auth.ts.
-- Safe to run in production — the ON CONFLICT means it is a no-op if they exist.

INSERT INTO auth.users (
  id,
  email,
  created_at,
  updated_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  aud,
  role,
  encrypted_password,
  email_confirmed_at
)
VALUES
  (
    '00000000-0000-0000-0000-000000000001',
    'dev-operator@krowe.internal',
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    'authenticated',
    'authenticated',
    '',
    now()
  ),
  (
    '00000000-0000-0000-0000-000000000002',
    'dev-builder@krowe.internal',
    now(), now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    false,
    'authenticated',
    'authenticated',
    '',
    now()
  )
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, role, display_name)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'operator', 'Dev Operator'),
  ('00000000-0000-0000-0000-000000000002', 'builder',  'Dev Builder')
ON CONFLICT (id) DO NOTHING;
