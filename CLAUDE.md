<!-- version: 1.4.0 -->
<!--
  Metadata: version, last reviewed, scope, model policy, reference docs, changelog.
  Last updated: 2026-04-25
-->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Last reviewed: 2026-04-25

**Project:** GitNexus · **Environment:** dev · **Maintainer:** repository maintainers (see GitHub)

> **Read [AGENTS.md](AGENTS.md) at session start.** It is the canonical source for scope, packages, validation commands, gotchas, and the embedded GitNexus MCP rules (`<!-- gitnexus:start --> … <!-- gitnexus:end -->`). This file only adds Claude Code–specific deltas.

## Scope

See the **Scope** table in [AGENTS.md](AGENTS.md) for read/write/execute/off-limits boundaries. Cursor-specific workflow notes also live only in AGENTS.md.

## Common commands (cwd matters)

```bash
# CLI / Core
cd gitnexus && npm test                    # full vitest suite (~2000 tests)
cd gitnexus && npm run test:unit           # unit only
cd gitnexus && npx tsc --noEmit            # typecheck

# Web UI
cd gitnexus-web && npm test                # vitest (~200 tests)
cd gitnexus-web && npm run test:e2e        # Playwright (needs `gitnexus serve` + `npm run dev`)
cd gitnexus-web && npx tsc -b --noEmit     # typecheck

# Dev servers
cd gitnexus && npm run dev                 # CLI tsx watch
cd gitnexus-web && npm run dev             # Vite, port 5173
npx gitnexus serve                         # HTTP API, port 4747
```

Single test: `cd gitnexus && npx vitest run path/to/file.test.ts -t "test name"`. Pre-commit (`.husky/pre-commit`) only runs prettier + typecheck on staged packages — full test suites are CI only. There is no `npm run lint` script; use `npx eslint .`.

## Model Configuration

- **Primary:** Pin per **Claude Code** / Anthropic org policy (explicit model id). Do not rely on an unversioned `latest` alias for governed workflows.
- **Fallback:** As configured in Claude Code (organization default or user override).
- **Notes:** The GitNexus CLI analyzer does not call an LLM.

## Execution Sequence (complex tasks)

Same discipline as [AGENTS.md](AGENTS.md): before large multi-step work, state which **AGENTS.md** / **GUARDRAILS.md** rules apply, current **Scope**, and planned validation commands (`npm test`, `tsc`, etc.). When pausing, summarize progress in the chat or a **local** scratch file (do not add `HANDOFF.md` to the repo), then `/clear` and resume with that summary.

## Claude Code hooks

`gitnexus analyze` (or `gitnexus setup`) installs the standard hook pair:

- **PreToolUse** — enriches `Grep`/`Glob` calls with graph context from the GitNexus MCP server.
- **PostToolUse** — auto-runs `npx gitnexus analyze` after `git commit` and `git merge` to keep the index fresh.

If you add a project hook, prefer **PreToolUse** for hard gates (e.g. typecheck before `git commit`); use the per-package commands above so the cwd is correct.

## Context budget

If always-on instructions grow, load deep conventions via conditional reads (e.g. *“When writing new code, read STANDARDS.md”*) instead of pasting long blocks here. In Cursor, prefer `.cursor/index.mdc` plus optional `.cursor/rules/*.mdc` globs (see [AGENTS.md](AGENTS.md) § Context budget).

## Reference Documentation

- **This repository:** [AGENTS.md](AGENTS.md) (Cursor + monorepo notes), [ARCHITECTURE.md](ARCHITECTURE.md), [CONTRIBUTING.md](CONTRIBUTING.md), [GUARDRAILS.md](GUARDRAILS.md).
- **Call-resolution DAG:** See ARCHITECTURE.md § Call-Resolution DAG. Shared pipeline code in `gitnexus/src/core/ingestion/` must not name languages — use `LanguageProvider` hooks instead (see AGENTS.md).
- **GitNexus:** `.claude/skills/gitnexus/`; MCP and indexed-repo rules live only in [AGENTS.md](AGENTS.md) (`gitnexus:start` … `gitnexus:end`). See **GitNexus rules** below.

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-04-25 | 1.4.0 | Added /init header, AGENTS.md read-at-start directive, inline common commands, hook details. |
| 2026-04-13 | 1.3.0 | Updated GitNexus index stats after DAG refactor. |
| 2026-03-24 | 1.2.0 | Removed duplicated gitnexus:start block and scope table; replaced with pointers to AGENTS.md. |
| 2026-03-23 | 1.1.0 | Updated agent instructions to match AGENTS.md. |
| 2026-03-22 | 1.0.0 | Added structured header and changelog. |

---

## GitNexus rules

See the `<!-- gitnexus:start --> … <!-- gitnexus:end -->` block in **[AGENTS.md](AGENTS.md)** for the canonical MCP tools, impact analysis rules, and index instructions.


<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:3216161c -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
