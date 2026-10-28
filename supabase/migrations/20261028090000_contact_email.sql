-- Public contact email of a restaurant, shown in the "Connect" block at the end
-- of the menu and as the address of the contact page (/[slug]/contact).
-- NULL = no email: neither the line nor the page appears.

ALTER TABLE public.tenant_settings ADD COLUMN IF NOT EXISTS contact_email TEXT;
