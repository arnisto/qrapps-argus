#!/usr/bin/env python3
"""Argus code-review hook — advisory AST checks on Python files.

Runs after Edit/Write tool calls (via a PostToolUse hook in
.claude/settings.local.json). Flags common smells that hand-written editors
keep adding:

  · long_elif_chain  — `if … elif … elif …` with more than MAX_ELIF branches
                       (use a dispatch table / dict of handlers)
  · long_function    — a function whose body spans more than MAX_LINES lines
  · deep_nesting     — a statement whose `if/for/while/with/try` nesting
                       depth exceeds MAX_NEST
  · syntax_error     — file no longer parses (loud)

This script always exits 0. It is advisory only; never blocks a tool call.
Output goes to stderr so the harness can surface it as additionalContext.

Usage:
    python3 argus_code_review.py <file.py> [<file2.py> ...]

Reads file paths from argv; ignores anything that isn't a .py file. Anything
under /tmp/, .venv/, node_modules/, .git/, console/ is skipped (generated
or third-party).
"""

from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

MAX_ELIF = 6     # chain length, inclusive of the first `if`
MAX_LINES = 120  # function body length
MAX_NEST = 5     # if/for/while/with/try nesting depth

SKIP_PARTS = {".git", ".venv", "node_modules", "__pycache__", "console"}


def _skip(path: Path) -> bool:
    parts = set(path.parts)
    if parts & SKIP_PARTS:
        return True
    s = str(path)
    return s.startswith("/tmp/") or s.startswith("/var/")


def _chain_len(node: ast.If) -> int:
    n = 1
    cur = node
    while len(cur.orelse) == 1 and isinstance(cur.orelse[0], ast.If):
        n += 1
        cur = cur.orelse[0]
    return n


class _NestVisitor(ast.NodeVisitor):
    """Tracks max nesting depth of compound statements within a function."""

    def __init__(self) -> None:
        self.depth = 0
        self.max = 0

    def _enter(self, node):
        self.depth += 1
        self.max = max(self.max, self.depth)
        self.generic_visit(node)
        self.depth -= 1

    visit_If = _enter
    visit_For = _enter
    visit_AsyncFor = _enter
    visit_While = _enter
    visit_With = _enter
    visit_AsyncWith = _enter
    visit_Try = _enter


def review_file(path: Path) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    try:
        src = path.read_text()
    except OSError:
        return findings
    try:
        tree = ast.parse(src, filename=str(path))
    except SyntaxError as e:
        findings.append(("syntax_error", e.lineno or 1,
                         f"{path.name} no longer parses: {e.msg}"))
        return findings

    seen_chain_lines: set[int] = set()

    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            end = node.end_lineno or node.lineno
            lines = end - node.lineno + 1
            if lines > MAX_LINES:
                findings.append(("long_function", node.lineno,
                                 f"`{node.name}` is {lines} lines "
                                 f"(soft limit {MAX_LINES}) — split it"))
            visitor = _NestVisitor()
            for stmt in node.body:
                visitor.visit(stmt)
            if visitor.max > MAX_NEST:
                findings.append(("deep_nesting", node.lineno,
                                 f"`{node.name}` nests {visitor.max} deep "
                                 f"(limit {MAX_NEST}) — extract helpers"))
        if isinstance(node, ast.If):
            # Only report the head of a chain; skip intermediate If nodes.
            if node.lineno in seen_chain_lines:
                continue
            n = _chain_len(node)
            if n > MAX_ELIF:
                findings.append(("long_elif_chain", node.lineno,
                                 f"chain of {n} if/elif branches "
                                 f"(limit {MAX_ELIF}) — use a dispatch "
                                 f"table / dict-of-handlers"))
                # mark every link of the chain as seen
                cur = node
                while len(cur.orelse) == 1 and isinstance(cur.orelse[0], ast.If):
                    cur = cur.orelse[0]
                    seen_chain_lines.add(cur.lineno)
    return findings


def main() -> int:
    paths = [Path(a) for a in sys.argv[1:] if a.endswith(".py")]
    if not paths:
        return 0
    any_findings = False
    for p in paths:
        if not p.is_file() or _skip(p):
            continue
        smells = review_file(p)
        if not smells:
            continue
        any_findings = True
        print(f"🔍 argus_code_review · {p}:", file=sys.stderr)
        for kind, line, msg in smells:
            print(f"  · {p}:{line}  [{kind}]  {msg}", file=sys.stderr)
    if any_findings:
        print(f"  (advisory — soft limits: MAX_ELIF={MAX_ELIF}, "
              f"MAX_LINES={MAX_LINES}, MAX_NEST={MAX_NEST})",
              file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
