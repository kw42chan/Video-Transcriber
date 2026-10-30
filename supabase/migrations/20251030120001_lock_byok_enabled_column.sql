-- Harden profiles: clients may not self-enable BYOK or rewrite protected columns.
-- byok_enabled is set only via SQL / service_role (see docs/MVP_SETUP.md).

revoke update on table public.profiles from authenticated;

grant update (trial_used, encrypted_byok_keys) on table public.profiles to authenticated;
grant select on table public.profiles to authenticated;
