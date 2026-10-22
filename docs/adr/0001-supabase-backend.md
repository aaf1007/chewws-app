# Supabase as the backend

We use Supabase (Postgres, auth, realtime, storage) with Sign in with Apple and Google. Shared lists need live sync between phones, and the app is meant to go public later, so we wanted a plain SQL database we can query, migrate and move off if needed. Firebase and Convex were the alternatives; both lock the data model into a proprietary store.
