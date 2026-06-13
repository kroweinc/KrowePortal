-- Company website host for experience entries (e.g. "patelgaines.com"),
-- captured when the builder picks a company from the autocomplete in the
-- Experience form. Replaces the old guess-the-domain-from-the-name approach
-- so BrandLogo only renders logos for verified hosts; entries without a
-- domain (free-typed or imported from a resume) fall back to initials.
alter table builder_profile_experience
  add column if not exists company_domain text;
