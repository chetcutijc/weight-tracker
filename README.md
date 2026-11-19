# Weight Tracker

Weight trend, meal-photo calorie logging and Garmin health metrics, on GitHub Pages and Supabase (in the wishlist project, with every database object prefixed `wt_`).

## What's already done
- Edge Function `analyze-meal` is deployed to the wishlist project. It requires a signed-in user.

## Setup (in order)
1. **Database.** Run `supabase/migration.sql` in the wishlist project's SQL editor (or ask Claude to apply it once the database responds). It creates owner-only tables and a private `wt-meal-photos` bucket.
2. **API key.** Go to Supabase → Edge Functions → Secrets and add:
   - `ANTHROPIC_API_KEY`: your key from console.anthropic.com
   - `ALLOWED_EMAILS`: your email, so nobody else can use your AI credits
3. **Frontend.** Create a new GitHub repo (e.g. `weight-tracker`), add `index.html`, and enable Pages.
4. **Account.** Open the site, tap *Create account*, confirm the email, then sign in.
   Then turn off new sign-ups in Supabase → Authentication → Sign In / Providers → "Allow new users to sign up".
   Note: this also stops new sign-ups to wishlist, which is fine if you're its only user.
5. **Garmin.** Handled inside the TRI repo (`scripts/push_health.py`), which needs the secrets `WT_SUPABASE_SERVICE_ROLE_KEY` and `WT_USER_ID`.

## Notes
- Photos are shrunk to 1280 px JPEG (about 200 KB) before upload.
- The Trends tab compares the deficit your **logs** imply with the deficit your **scale** implies. A persistent gap usually means the meal estimates are off.
- Default AI model: `claude-sonnet-5-5`. To switch to a cheaper model, set the `MEAL_MODEL` secret.
