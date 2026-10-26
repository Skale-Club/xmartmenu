-- handle_new_user() as it is in production: pinned search_path and a
-- schema-qualified insert. Production got this outside the migrations, so a
-- fresh database (local, CI) still had the old body, which GoTrue runs with
-- search_path=auth: "relation profiles does not exist" on every new user.
-- Re-applying it in production changes nothing.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name');
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
