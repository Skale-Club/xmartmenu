# Guest sign-in (phone)

Guests sign in with their phone number and a one-time SMS code
(`/[slug]/me/login`, and the private-menu modal). The phone is the identity:
the guest panel lists their orders by matching it to the phone typed at
checkout, so only a verified phone may see them. Google sign-in is for
restaurant staff and owners (`/auth/login`), not for guests.

## Turning it on (Supabase dashboard, one time)

Phone sign-in is **off** in production until an SMS provider is set:

1. Supabase › Authentication › Sign In / Providers › **Phone** → enable.
2. Choose the SMS provider and paste its credentials. Twilio is the simplest
   (Account SID, Auth Token, and a Messaging Service SID or sender number);
   MessageBird, Vonage and Textlocal also work natively.
3. Keep the OTP at 6 digits; 60 s expiry is the current setting
   (`sms_otp_exp`), 300 s is friendlier on slow networks.
4. Optional: Authentication › Rate limits › SMS — cap sends per hour to
   control cost.

No code change or deploy is needed. Until it is on, the guest sees
"Signing in with your phone is not available yet" instead of a provider error.

## Cost note

SMS to Brazil costs roughly US$ 0.04–0.08 per code with Twilio. A cheaper
route is WhatsApp authentication messages through a Supabase "Send SMS" auth
hook; that needs a WhatsApp Business (Meta) account and a small hook route,
to be built when the account exists.
