\# QA Checklist



\## Before Saying Done

\- Read CLAUDE.md

\- Check PROJECT\_STATUS.md

\- Identify affected files

\- Make small safe changes only

\- Do not touch .env

\- Do not expose API keys



\## Build Check

\- Run npm run build if available

\- Run npx tsc --noEmit if available

\- Fix build errors before pushing



\## UI Check

\- Check desktop layout

\- Check mobile layout

\- Check spacing

\- Check buttons and links

\- Check forms if affected



\## Final Summary

Before finishing, explain:

\- What was changed

\- Which files were edited

\- What was tested

\- What still needs manual checking

