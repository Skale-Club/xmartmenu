-- Additive preparation only; no live provider/cutover is enabled here.
ALTER TABLE public.app_identity_bindings ADD COLUMN disabled_at timestamptz;
ALTER TABLE public.app_identity_bindings
  ADD CONSTRAINT app_identity_bindings_session_owner UNIQUE (project_id, subject, user_id);

-- Do not invent provenance for an existing session. Rows without it fail the
-- runtime's inner join and require a fresh sign-in; no identity/account changes.
ALTER TABLE public.app_sessions ADD COLUMN project_id text;
ALTER TABLE public.app_sessions ADD COLUMN subject text;
ALTER TABLE public.app_sessions ADD CONSTRAINT app_sessions_identity_owner
  FOREIGN KEY (project_id, subject, user_id)
  REFERENCES public.app_identity_bindings (project_id, subject, user_id);
ALTER TABLE public.app_sessions ADD CONSTRAINT app_sessions_identity_pair
  CHECK ((project_id IS NULL) = (subject IS NULL));
CREATE INDEX app_sessions_identity ON public.app_sessions(project_id, subject);
