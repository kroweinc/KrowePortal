-- Education on the builder profile: a single entry — school (university or
-- high school), major / field of study, and a freeform year label
-- ("Class of 2027", "Senior", "2020 – 2024"). Lives on builder_profiles
-- like the other basics; covered by the existing owner-only RLS policy.
alter table builder_profiles
  add column if not exists education_school text,
  add column if not exists education_major  text,
  add column if not exists education_year   text;
