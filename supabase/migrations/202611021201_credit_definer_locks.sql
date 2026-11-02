begin;

alter function public.ensure_credit_account(uuid) set search_path = '';
alter function public.credit_available_seconds(uuid) set search_path = '';
alter function public._debit_pools(uuid, numeric) set search_path = '';
alter function public.grant_monthly_credits(uuid, numeric, text, jsonb) set search_path = '';
alter function public.grant_topup_credits(uuid, numeric, text, jsonb) set search_path = '';
alter function public.reserve_job_credits(uuid, numeric) set search_path = '';
alter function public.finalize_job_credits(uuid, numeric) set search_path = '';
alter function public.release_job_credits(uuid) set search_path = '';

commit;
