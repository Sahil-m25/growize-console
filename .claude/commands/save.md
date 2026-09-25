---
description: Close the session — record what changed and refresh the code graph
---
1. Append one line to `docs/SESSIONS.md`: today's date, what changed, and the decision or test
   case id it serves.
2. If anything structural changed — a new module, a moved function, a new migration — regenerate
   the graph: `graphify update tools/graphify --no-cluster && graphify cluster-only tools/graphify`
   (code only — the 79 documents are deliberately not sent to an LLM; see tools/PLUGINS.md).
3. If a decision was taken this session and is not yet in `docs/decisions/`, write it now.
4. Tell me in three lines what is now different, and what the next session should pick up.
