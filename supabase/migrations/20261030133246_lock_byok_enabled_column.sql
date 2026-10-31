-- Clients must not flip byok_enabled; only service_role / SQL console
revoke update on table public.profiles from authenticated;
grant update (trial_used, encrypted_byok_keys) on table public.profiles to authenticated;
grant select on table public.profiles to authenticated;
;
