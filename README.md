# QR Invites MVP — Quick Steps

1) Create a Supabase project; copy Project URL + anon key.
2) Run your safe init SQL (tables + RLS + trigger).
3) Create `.env.local` and set env vars; run `npm install && npm run dev`.
4) Sign up at /login; set your role to admin in `profiles`.
5) Use /admin to create events, upload guests, and export QR.
6) Use /checker to scan and check-in guests.
