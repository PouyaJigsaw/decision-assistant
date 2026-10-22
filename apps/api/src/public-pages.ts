export const STORE_SHORT_DESCRIPTION =
  "Screen a LinkedIn profile against a job rubric. Get Contact, Investigate, Save for later, or Skip.";

export const PUBLISHER_EMAIL = "pouya__1__pournasir@hotmail.com";

const STYLES = `
  :root { color-scheme: light; }
  body { font: 16px/1.5 ui-sans-serif, system-ui, sans-serif; max-width: 42rem; margin: 2.5rem auto; padding: 0 1.25rem 4rem; color: #171717; background: #fff; }
  nav { display: flex; gap: 1rem; margin-bottom: 2rem; font-size: 0.95rem; }
  a { color: #171717; }
  h1 { font-size: 1.75rem; letter-spacing: -0.03em; margin: 0 0 0.5rem; }
  h2 { font-size: 1.15rem; margin: 2rem 0 0.6rem; }
  p, li { color: #262626; }
  .lede { color: #525252; margin-top: 0; }
  .copy { white-space: pre-wrap; background: #f5f5f4; border: 1px solid #e7e5e4; padding: 0.9rem 1rem; font: 14px/1.45 ui-sans-serif, system-ui, sans-serif; }
  dt { font-weight: 600; margin-top: 0.85rem; }
  dd { margin: 0.2rem 0 0; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title>
  <style>${STYLES}</style>
</head>
<body>
  <nav>
    <a href="/">Who Fits?</a>
    <a href="/privacy">Privacy</a>
  </nav>
  ${body}
</body>
</html>
`;
}

export function productPage(): string {
  return page(
    "Who Fits?",
    `
  <h1>Who Fits?</h1>
  <p class="lede">${STORE_SHORT_DESCRIPTION}</p>
  <p>
    Who Fits? is a Chrome side panel for recruiters. Paste a job description, review an editable rubric,
    open a LinkedIn profile, and evaluate that tab. TypeSafe Jev answers the rubric. The panel recommends
    Contact, Investigate, Save for later, or Skip. Nothing is messaged to the candidate.
  </p>
  <p>
    Connect ChatGPT plan usage or your own OpenAI API key to draft rubrics without a hosted limit.
    Without a connected model, the hosted service can draft three job roles.
  </p>
  <p>Install from the Chrome Web Store after the listing is published. Privacy policy: <a href="/privacy">/privacy</a>.</p>

  <h2>Chrome Web Store — short description</h2>
  <p>Paste this into the listing (132-character limit):</p>
  <p class="copy">${STORE_SHORT_DESCRIPTION}</p>

  <h2>Chrome Web Store — detailed description</h2>
  <p class="copy">Who Fits? helps a recruiter screen one LinkedIn profile they already have open against a job they pasted.

How it works
1. Create an account in the side panel.
2. Paste a job description. A language model drafts an editable rubric of screening questions.
3. Open a LinkedIn profile in Chrome. Click the toolbar icon, then evaluate the tab.
4. Jev answers each question from the approved text. The panel shows Contact, Investigate, Save for later, or Skip.

What it does not do
- It does not message candidates.
- It does not scrape LinkedIn in the background or walk a search results page.
- It does not require ChatGPT. ChatGPT or an API key is optional, for drafting on your own account.

Data
Job descriptions and evaluation history are stored on the Who Fits? API (https://decision-assistant.fly.dev) for your signed-in account. Profile text is sent to TypeSafe Jev when you confirm Evaluate. If you connect ChatGPT or an OpenAI API key, those requests go from the extension to OpenAI. See the privacy policy: https://decision-assistant.fly.dev/privacy</p>

  <h2>Privacy tab — single purpose</h2>
  <p class="copy">Help a recruiter screen one LinkedIn profile they have open against a job rubric they pasted, and show a Contact, Investigate, Save for later, or Skip recommendation.</p>

  <h2>Privacy tab — permission justifications</h2>
  <dl>
    <dt>sidePanel</dt>
    <dd>Show the recruiter UI next to the LinkedIn tab.</dd>
    <dt>activeTab, scripting, tabs</dt>
    <dd>Read the LinkedIn profile the recruiter has focused, after they choose to capture or evaluate. The extension does not run content scripts on every page load.</dd>
    <dt>storage</dt>
    <dd>Keep the sign-in session, the current extract, and optional ChatGPT credentials on this device.</dd>
    <dt>webNavigation, declarativeNetRequestWithHostAccess</dt>
    <dd>Complete ChatGPT OAuth, including a loopback redirect on 127.0.0.1.</dd>
    <dt>https://decision-assistant.fly.dev/*</dt>
    <dd>Sign in, save roles, and run evaluations against the Who Fits? API.</dd>
    <dt>https://www.linkedin.com/*</dt>
    <dd>Read the open profile document when the recruiter captures the tab.</dd>
    <dt>https://api.openai.com/*, https://auth.openai.com/*, http://127.0.0.1/*</dt>
    <dd>Optional ChatGPT sign-in and OpenAI API key usage. The loopback host is only the OAuth redirect, not a local API.</dd>
  </dl>
`,
  );
}

export function privacyPage(): string {
  return page(
    "Privacy policy — Who Fits?",
    `
  <h1>Privacy policy</h1>
  <p class="lede">Effective 20 October 2026. This policy applies to the Who Fits? Chrome extension and the API at https://decision-assistant.fly.dev.</p>

  <h2>Who we are</h2>
  <p>
    Who Fits? is a recruiter screening tool published by Pouya Pournasir.
    For an account deletion or a privacy question, email
    <a href="mailto:${PUBLISHER_EMAIL}">${PUBLISHER_EMAIL}</a>.
  </p>

  <h2>What we collect</h2>
  <ul>
    <li>Account email and a hashed password, so you can sign in.</li>
    <li>Job descriptions, role titles, companies, and approved rubrics you save.</li>
    <li>Profile text you confirm for Evaluate, plus Jev results, scores, and optional notes.</li>
    <li>A candidate name parsed from that text, used only as a label on your history.</li>
    <li>Usage counts for hosted job-role drafts, and stored Jev cost for a daily spend cap.</li>
  </ul>
  <p>
    The extension stores a session token on this device. If you connect ChatGPT, access tokens stay in Chrome
    storage on this device. If you paste an OpenAI API key, it stays in Chrome session storage on this device.
    Those secrets are not sent to the Who Fits? API.
  </p>

  <h2>What we do not collect</h2>
  <ul>
    <li>We do not read LinkedIn until you capture or evaluate the open tab.</li>
    <li>We do not collect browsing history, passwords from other sites, or payment cards.</li>
    <li>We do not message candidates or post on LinkedIn.</li>
  </ul>

  <h2>How we use it</h2>
  <p>
    We use this data only to run Who Fits?: sign you in, draft and store rubrics, send a confirmed profile to Jev,
    show a recommendation, and enforce hosted draft limits and a daily spend cap.
  </p>

  <h2>Who else sees it</h2>
  <ul>
    <li>TypeSafe Jev receives the rubric questions and the approved profile text when you confirm Evaluate.</li>
    <li>If you have no connected model, a hosted language model receives the job description to draft a rubric. That is the only hosted language-model step.</li>
    <li>If you connect ChatGPT or an OpenAI API key, OpenAI receives draft (and optional comparison) requests from the extension. Those requests do not use the hosted language-model quota.</li>
    <li>The API is hosted on Fly.io in the United States. Data is stored in SQLite on that host.</li>
  </ul>
  <p>We do not sell your data. We do not use it for advertising.</p>

  <h2>Retention and deletion</h2>
  <p>
    Job descriptions and evaluation rows stay until you delete them. The side panel can delete saved roles and
    evaluation history. Hosted draft counts are not restored when you delete roles.
  </p>
  <p>
    Profile text is stored with an evaluation only when you keep extracts, or briefly while an optional comparison
    runs. The default evaluate path does not keep the profile text after the run.
  </p>
  <p>
    Passwords are stored as hashes. To delete an account entirely, email
    <a href="mailto:${PUBLISHER_EMAIL}">${PUBLISHER_EMAIL}</a>.
  </p>

  <h2>Security</h2>
  <p>
    Traffic to the API and to OpenAI uses HTTPS. Session tokens are bearer tokens. An OpenAI API key never leaves
    the browser except toward api.openai.com.
  </p>

  <h2>Children</h2>
  <p>Who Fits? is for professional recruiting. It is not directed at children under 13.</p>

  <h2>Changes</h2>
  <p>If this policy changes, we will update this page and the date above. Continued use after a change means you accept the new policy.</p>
`,
  );
}
