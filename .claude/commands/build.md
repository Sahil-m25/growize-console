---
description: Keep building — run autopilot rounds back to back in this session
argument-hint: "[max rounds, default 5]"
---
Run autopilot rounds for QUEUE=console one after another, up to $ARGUMENTS rounds (default 5).

Before the first round read CLAUDE.md, autopilot/AUTOPILOT.md and tools/PLUGINS.md once. For each round:
1. `node autopilot/next.mjs console --check` — exit 3 (STOP file) or 1 (nothing left): stop. Exit 2 (only people's items left): stop and say what BLOCKED.md needs.
2. Do the round exactly as AUTOPILOT.md "The round" says (packet from `node autopilot/next.mjs console`, build, `npm run dev:local` kept running in the background between rounds, reticle, `node autopilot/test-story.mjs console <STORY>`, commit, `node autopilot/done.mjs …`).
3. Print one line: `<STORY> [<phase>] → <done|review|waiting|none> · <what changed>`. The Slack tracker refreshes itself from done.mjs.
4. Before the next round, drop the previous story's details from your working memory: re-read only the new packet. If the conversation is getting long, say so and suggest `/compact`.

Never wait for a person, never edit a test's expected facts, never push or deploy, never print the TypeSafe key.
