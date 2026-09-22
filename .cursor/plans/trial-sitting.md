# Trial sitting

Operator steps for one recruiter, one rubric, three profiles.

1. Build `VITE_API_ORIGIN=https://decision-assistant.fly.dev pnpm --filter @decision-assistant/extension zip`.
2. Upload the zip to the Chrome Web Store as **Unlisted**. Publish. Send the recruiter the install URL. Do not send an unpacked folder.
3. Confirm `EVALUATIONS_ENABLED=true` and `DAILY_SPEND_CAP_USD=5`.
4. The recruiter signs in with the one account.
5. They paste one job description, draft a rubric, delete any omitted protected line they do not want, and approve version 1. This draft does not reduce uses remaining.
6. Profile A, comparison toggle on: a profile that should Contact or Save for later. They remove any section they do not want evaluated, then confirm Evaluate. The result shows an action, `Jev does not return text.`, an LLM excerpt or `No evidence found.`, both meters, and `Uses remaining: 2 of 3`.
7. Profile B: a profile missing a required qualification. Expect Investigate and `Uses remaining: 1 of 3`.
8. Profile C: a confident mismatch or a confident disqualifier. Expect Skip and `Uses remaining: 0 of 3`.
9. A fourth confirm shows `This trial covered three profiles. Evaluate is closed.`
10. If you need to stop mid-sitting, `fly secrets set EVALUATIONS_ENABLED=false` and `fly apps restart decision-assistant`. The next evaluate returns an error and does not call Jev.
