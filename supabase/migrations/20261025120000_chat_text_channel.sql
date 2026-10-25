-- Each restaurant picks how guests talk to its AI assistant: typed messages,
-- voice notes, or both. audio_enabled already switches voice notes; this
-- adds the switch for typed messages. With both off the chat box is hidden.
--
-- Default true keeps every existing assistant working exactly as before.

alter table public.chat_addon_settings
  add column if not exists text_enabled boolean not null default true;
