# End-to-end scenarios

Four opt-in Playwright journeys against the local API and the unpacked extension in your current Chrome. They are not part of `pnpm test`. Drafting a rubric and evaluating a profile use whatever `PROVIDERS` is set to in `apps/api/.env`.

## Setup

1. Start the API:

   ```bash
   pnpm --filter @decision-assistant/api start
   ```

   It seeds the account from `apps/api/.env`.

2. Build the extension against that local API:

   ```bash
   pnpm --filter @decision-assistant/extension build:local
   ```

   Output: `apps/extension/unpacked/chrome-mv3`.

3. Quit Chrome completely. Chrome 154 will not expose DevTools on the default profile, so relaunch with a separate user-data directory (a copy of your profile keeps the LinkedIn session) and remote debugging:

   ```bash
   /Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
     --user-data-dir="$PWD/.chrome-e2e-profile" \
     --remote-debugging-port=9222 \
     --remote-allow-origins='*'
   ```

   `--load-extension` is ignored on this Chrome. The Playwright fixture loads `apps/extension/unpacked/chrome-mv3` through `Extensions.loadUnpacked` when it attaches. Open a signed-in `linkedin.com/in/` tab and leave it open. A fresh Playwright browser would not have that LinkedIn session.

4. Run the scenarios:

   ```bash
   pnpm test:e2e
   ```

   Credentials come from `ACCOUNT_EMAIL` and `ACCOUNT_PASSWORD` (the same values as `apps/api/.env`). They are not written into the tests. Override the debugging URL with `CHROME_CDP_URL` if it is not `http://127.0.0.1:9222`.

The four files run in order: sign-in, rubric, LinkedIn capture, evaluate. Session, approved rubric, and captured profile carry forward in Chrome storage.
