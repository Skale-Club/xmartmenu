-- Global platform settings (single row)
CREATE TABLE platform_settings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_name              TEXT NOT NULL DEFAULT 'XmartMenu',
  brand_name            TEXT NOT NULL DEFAULT 'XmartMenu',
  default_primary_color TEXT NOT NULL DEFAULT '#000000',
  default_accent_color  TEXT NOT NULL DEFAULT '#FF5722',
  menu_footer_brand     TEXT NOT NULL DEFAULT 'XmartMenu',
  landing               JSONB NOT NULL DEFAULT '{}',
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- Ensure there is only one row.
CREATE UNIQUE INDEX platform_settings_singleton ON platform_settings ((true));

-- Insert English-first landing page defaults.
INSERT INTO platform_settings (landing) VALUES ('{
  "hero": {
    "badge": "Digital menus built for service",
    "heading": "Your restaurant menu",
    "heading_highlight": "built for service",
    "subheading": "Create a clean digital menu, share it with a QR code, and manage ordering workflows without adding friction for your team.",
    "cta_primary": "Get started",
    "cta_secondary": "See how it works"
  },
  "how_it_works": {
    "title": "How it works",
    "subtitle": "A simple workflow for restaurants and service teams",
    "steps": [
      {"step": "01", "icon": "list", "title": "Build your menu", "desc": "Add categories, products, photos, descriptions, prices, and options from the admin dashboard."},
      {"step": "02", "icon": "palette", "title": "Match your brand", "desc": "Set your logo, colors, contact details, and service settings for each restaurant."},
      {"step": "03", "icon": "qr", "title": "Share your QR code", "desc": "Print or display a QR code so customers can browse your live menu from their phones."}
    ]
  },
  "features": {
    "title": "Built for daily restaurant service",
    "subtitle": "The essentials for keeping menus accurate and easy to use",
    "items": [
      {"icon": "link", "title": "Unique restaurant links", "desc": "Each restaurant gets its own public menu URL."},
      {"icon": "cart", "title": "Ordering workflows", "desc": "Enable direct ordering when your team is ready."},
      {"icon": "palette", "title": "Restaurant branding", "desc": "Use your logo, colors, and visual identity."},
      {"icon": "chart", "title": "Scan analytics", "desc": "Track QR code usage over time."},
      {"icon": "search", "title": "Menu search", "desc": "Help customers find items quickly."},
      {"icon": "phone", "title": "Mobile-first browsing", "desc": "Menus open directly in the customer browser."}
    ]
  },
  "pricing": {
    "title": "Simple plans",
    "subtitle": "Start free, scale when you need",
    "plans": [
      {"name": "Free", "price": "$0", "period": "/mo", "desc": "To get started", "features": ["Digital menu", "QR code", "Up to 20 products", "Basic branding"], "cta": "Get started", "highlight": false},
      {"name": "Pro", "price": "$49", "period": "/mo", "desc": "For growing restaurants", "features": ["Everything in Free", "Unlimited products", "Full branding", "Scan analytics", "Priority support"], "cta": "Subscribe to Pro", "highlight": true},
      {"name": "Enterprise", "price": "$149", "period": "/mo", "desc": "For groups and chains", "features": ["Everything in Pro", "Multiple locations", "Custom domain", "Dedicated onboarding", "Guaranteed SLA"], "cta": "Talk to sales", "highlight": false}
    ]
  },
  "cta": {
    "heading": "Ready to modernize your menu?",
    "text": "Set up a digital menu your staff can maintain and your customers can use with confidence.",
    "button": "Get started"
  },
  "footer": {
    "copyright": "XmartMenu. All rights reserved."
  }
}');

-- Trigger updated_at
CREATE TRIGGER platform_settings_updated_at BEFORE UPDATE ON platform_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_settings_public_read" ON platform_settings FOR SELECT USING (true);
CREATE POLICY "platform_settings_superadmin_write" ON platform_settings FOR ALL USING (is_superadmin());
