-- Apply with oversight; lets the Intel app read Vault secrets via service-role RPC.
-- Not applied by the build agent.
--
-- Creates: public.intel_get_secret(p_name text) RETURNS text
-- Security: SECURITY DEFINER; access restricted to service_role only.
-- Reads from: vault.decrypted_secrets (Supabase Vault extension).
--
-- Prerequisites:
--   1. Supabase Vault extension must be enabled on the project.
--   2. Secrets must be stored in the Vault with exact names:
--        BRIGHTDATA_API_KEY, DATAFORSEO_LOGIN, DATAFORSEO_API_KEY
--   3. Run with a role that has CREATE FUNCTION in the public schema.

CREATE OR REPLACE FUNCTION public.intel_get_secret(p_name text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT decrypted_secret
  FROM   vault.decrypted_secrets
  WHERE  name = p_name
  LIMIT  1;
$$;

-- Lock down access: revoke from all principals, then grant only to service_role
REVOKE ALL ON FUNCTION public.intel_get_secret(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.intel_get_secret(text) FROM anon;
REVOKE ALL ON FUNCTION public.intel_get_secret(text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.intel_get_secret(text) TO service_role;
