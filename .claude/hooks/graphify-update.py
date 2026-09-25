#!/usr/bin/env python3
"""PostToolUse hook: after a code edit, incrementally rebuild the graphify
knowledge graph and log the run. Wired in .claude/settings.json against
Edit|Write|MultiEdit. Never blocks the tool call (always exits 0) — this is
maintenance, not validation. See tools/PLUGINS.md and tools/README.md.
"""
import datetime
import json
import os
import shutil
import subprocess
import sys

CODE_EXT = {
    ".ts", ".tsx", ".js", ".jsx", ".py", ".go", ".rs", ".java", ".rb", ".php",
    ".c", ".cpp", ".cs", ".kt", ".swift", ".scala", ".lua", ".sh", ".json",
}


def main() -> int:
    try:
        data = json.load(sys.stdin)
    except Exception:
        return 0

    file_path = data.get("tool_input", {}).get("file_path", "") or ""
    ext = os.path.splitext(file_path)[1].lower()
    if ext not in CODE_EXT:
        return 0  # docs/html/etc. don't change the AST graph — skip quietly

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    log_path = os.path.join(project_dir, "tools", "graphify", "graphify-out", "auto-update.log")
    os.makedirs(os.path.dirname(log_path), exist_ok=True)
    ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

    graphify = shutil.which("graphify")
    with open(log_path, "a", encoding="utf-8") as log:
        if not graphify:
            log.write(f"{ts}  SKIPPED (graphify not on PATH)  file={file_path}\n")
            return 0
        try:
            result = subprocess.run(
                # target tools/graphify, not "." — graphify writes to <target>/graphify-out,
                # and the graph the docs point at lives at tools/graphify/graphify-out/graph.json
                [graphify, "update", "tools/graphify", "--no-cluster"],
                cwd=project_dir, capture_output=True, text=True, timeout=120,
            )
            status = "OK" if result.returncode == 0 else "FAILED"
            lines = [l.strip() for l in (result.stdout + result.stderr).splitlines() if l.strip()]
            # the useful line is the rebuild status, not the trailing API-key tip
            counts = [l for l in lines if "nodes" in l and "edges" in l]
            progress = [l for l in lines if l.startswith("[graphify")]
            tail = (counts or progress or lines or [""])[-1]
            log.write(f"{ts}  {status}  file={file_path}  {tail}\n")
        except Exception as e:
            log.write(f"{ts}  ERROR  file={file_path}  {e}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
