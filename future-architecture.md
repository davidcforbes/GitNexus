# Future Architecture — LLM Token-Efficiency Playbook

**Status:** living document · **Owner:** davidcforbes · **Last reviewed:** 2026-04-28

> **Purpose.** Reduce Claude Code token spend by 40–60% per task without losing the GitNexus / Serena / beads workflow this repo depends on. This doc captures the principles, the concrete config changes, and the routing rules that keep cost down as plugins, MCP servers, and context-md files inevitably accrete.
>
> Re-read at the start of every "why is my session bill so high?" moment. Run the **Monthly Review** checklist at the bottom.

---

## Why this exists

Burned through a $200/mo Claude Max allotment in days. Audit found three forces compounding:

1. **Per-turn fixed overhead.** ~18 enabled Claude Code plugins, four user-scoped MCP servers, and SessionStart/PreCompact hooks injecting a multi-thousand-token beads block on every cold start. Tool Search defers tool *schemas* but plugin **instructions** and tool **names** still cost tokens every turn.
2. **Maxed output settings.** `alwaysThinkingEnabled: true` + `effortLevel: "high"` burn extended-thinking tokens on every reply.
3. **Informal hygiene.** No /clear-between-tasks, no manual /compact at 60%, no model tiering.

The unique assets to lean on: **GitNexus** (this repo's own code-graph MCP, currently 19,416 nodes / 27,166 edges / 300 execution flows) and **Serena** (LSP-backed symbolic editing MCP, installed via `claude-plugins-official`). Used right, they collapse "Read the whole file → grep for callers → eyeball → edit" into 2–3 small structured calls.

---

## Principles

1. **You can't optimize what you can't see.** Statusline, `/context`, `/cost` first. Always.
2. **Per-turn fixed cost is the highest-leverage lever.** A 5,000-token saving on plugin/MCP load multiplies by every message in every session for years.
3. **Default to less.** Less thinking, less effort, fewer plugins, fewer always-loaded instructions. Opt up explicitly when needed.
4. **Symbolic > textual exploration.** Calling `find_symbol` or `gitnexus_impact` returns 200 tokens of structured info; `Read`-ing a 600-line file returns 6,000 tokens of which 95% is irrelevant.
5. **Subagents for verbosity sinks.** Test runs, log greps, doc fetches — dispatch and consume only the summary.
6. **Edit, don't append.** When Claude is wrong, edit the original message and regenerate. Corrections stack into history forever.
7. **Cache discipline.** Don't mutate CLAUDE.md mid-session. Don't go idle past the cache TTL without /compact-ing first.

---

## Layer 0 — Visibility

| Action | Status | Verify |
|---|---|---|
| Statusline shows model + context % + session $ + cache-hit % | ⚠ verify content of `~/.claude-code/statusline.ps1` | Open a session; confirm all four signals visible |
| `/context` muscle memory | habit | Run before any unfamiliar session |
| `/cost` muscle memory | habit | Run mid-session and at end |
| Anthropic dashboard tab | habit | Keep open while heavy-coding |

**Trigger conditions** (commit to memory):
- New unrelated task → `/clear`
- Context ~60% full → `/compact "preserve: <key facts>"`
- Idle > 3 min before stepping away → `/compact` (the prompt-cache TTL is short and idle reprocessing costs full price)
- After 3–4 compacts → ask for a session summary, `/clear`, paste summary back

---

## Layer 1 — Per-message overhead

> Highest leverage. A 10k-token reduction here saves 10k × every-message-this-session × every-session-this-year.

### 1.1 Plugin / MCP triage

**Always-on (project: GitNexus):** beads, serena, context7, claude-md-management, codex, commit-commands, code-review, typescript-lsp, rust-analyzer-lsp, superpowers, security-guidance.

**Disabled by default; re-enable per-session via `/plugin` when actually needed:** atlassian, deploy-on-aws, frontend-design, feature-dev, pencil.

**Per-project `.mcp.json` instead of user-global:** mcp-atlassian, sharepoint-mcp, chrome-devtools, crawl4ai. Loaded only when working in 4iiz repos / web projects.

Action: edit `~/.claude/settings.json`:

```jsonc
{
  "enabledPlugins": {
    "atlassian@claude-plugins-official": false,
    "deploy-on-aws@claude-plugins-official": false,
    "frontend-design@claude-plugins-official": false,
    "feature-dev@claude-plugins-official": false
    // (others left as currently configured)
  },
  "mcpServers": {
    // remove mcp-atlassian, sharepoint-mcp, chrome-devtools, crawl4ai
    // re-create them in per-project .mcp.json files
  }
}
```

Per-project `.mcp.json` template (e.g. `C:\dev\<work-repo>\.mcp.json`):

```json
{
  "mcpServers": {
    "mcp-atlassian": { "command": "uv", "args": ["run", "mcp-atlassian"], "cwd": "C:/dev/mcp-atlassian", "env": { "...": "..." } }
  }
}
```

### 1.2 Slim the always-loaded instruction surface

- Project `CLAUDE.md` should be a ≤ 80-line pointer to `AGENTS.md` and this doc — strip duplicated beads quick-reference (already in the SessionStart hook) and the GitNexus rules (move into AGENTS.md `gitnexus:start` block).
- `AGENTS.md` stays around 200 lines but absorbs the GitNexus Always/Never rules and the routing matrix below — single source of truth.
- Global `~/.claude/CLAUDE.md` stays minimal (currently 29 lines — leave it).

### 1.3 Audit the `bd prime` hook

The SessionStart + PreCompact hook injects a multi-thousand-token beads cheatsheet. Confirm in `bd` source whether `bd prime` has a quiet/anchor mode; if not, file a `bd` issue requesting one and add a wrapper that emits a one-line context anchor + a `/bd-help` slash command for the full reference.

---

## Layer 2 — Output verbosity

### 2.1 Default thinking and effort

| Setting | New default | Opt-up to |
|---|---|---|
| `alwaysThinkingEnabled` | `false` | `/think` per-turn for hard problems |
| `effortLevel` | `"medium"` | `"high"` for architecture / large refactors |

### 2.2 The `caveman-coding` skill

Install at `~/.claude/skills/caveman-coding/SKILL.md`:

```markdown
---
name: caveman-coding
description: Use during routine coding tasks (file edits, small fixes, symbol lookups) to enforce concise replies. Skip during planning, design discussions, refactor brainstorming, or when the user explicitly asks for explanation.
---

- Reply in ≤2 sentences unless the user asks for more.
- Code first, no preamble. No "Certainly!", "Great question!", "Here's what I'll do".
- One sentence of pre-tool intent is fine; no tool-call narration beyond that.
- No trailing summary of work just performed — the diff is visible.
- For multi-step tasks, one line per step. No headers, no bullet hierarchies.
- This skill applies to routine work; the user can disable it for any session by saying so.
```

Rationale: published Caveman benchmarks ([Guzik 2026](https://medium.com/@KubaGuzik/i-benchmarked-the-viral-caveman-prompt-to-save-llm-tokens-then-my-6-line-version-beat-it-d8e565f95e15)) show ~14–21% end-to-end session savings; the trick lands on output, not reasoning quality.

### 2.3 Default model tiering

| Task shape | Default model | Why |
|---|---|---|
| Routine file edits, lookups, formatting, small fixes | **Haiku 4.5** | ~80% of subtasks; cheapest |
| Real coding work, debugging, refactors | **Sonnet 4.6** | sweet spot |
| Architecture, large multi-file design, tricky reasoning | **Opus 4.6/4.7** | reserve |
| Subagent dispatch (research, exploration, log grepping) | **Haiku 4.5** | each fresh subagent reload-tax is high |

Switch via `/model` or per-agent `model` parameter. Watch the statusline for model name to confirm.

---

## Layer 3 — Conversation length

The "context tax": Claude re-reads full history every turn. 1 message = 1×, 30 messages = ~30×.

| Habit | When to do it |
|---|---|
| `/clear` | Switching tasks |
| `/compact "preserve: X, Y"` | At ~60% capacity (not 95% auto-trigger) |
| Edit-and-regenerate | Whenever Claude went down a wrong path |
| Batch sub-asks into one message | "Summarize, extract issues, suggest a fix" — not three messages |
| Plan Mode | Any task expected to take > 5 turns |
| 95%-confidence rule | Pasted into AGENTS.md verbatim — Claude must reach 95% confidence before editing |

Rule of thumb: **five messages of planning saves forty messages of rebuilding.**

---

## Layer 4 — Code-exploration routing

> This is the GitNexus + Serena + context7 payoff. Embed the matrix below in `AGENTS.md` `gitnexus:start` block so it governs both Claude Code and Cursor.

### Routing matrix

| Question | Use this — not Read/Grep |
|---|---|
| "What does symbol X look like?" | `serena:get_symbols_overview` (file outline) → `serena:find_symbol` (body) |
| "Who calls X?" | `serena:find_referencing_symbols` (single-symbol) **or** `gitnexus_context({name: X})` (full graph) |
| "What breaks if I change X?" | `gitnexus_impact({target: X, direction: "upstream"})` — **mandatory** before edits |
| "How does feature Y work end-to-end?" | `gitnexus_query({query: Y})` — ranked execution flows |
| "Rename X across the repo" | `serena:rename_symbol` (semantic) **or** `gitnexus_rename` (graph-aware). Never find-replace. |
| "Edit body of function X" | `serena:replace_symbol_body` — anchors on the symbol, not line numbers |
| "Insert before/after a symbol" | `serena:insert_before_symbol` / `insert_after_symbol` |
| "Find AST shape Z across repo" | `serena:search_for_pattern` (regex). Future: ast-grep MCP for true structural search. |
| "Pre-commit safety check" | `gitnexus_detect_changes()` — **mandatory** per Always-Do |
| "Look up library API / config" | `context7` `resolve-library-id` + `query-docs` — never `npm view` or doc-spelunking |
| "Read process / execution flow" | `gitnexus://repo/GitNexus/process/{name}` resource |
| "Codebase overview" | `gitnexus://repo/GitNexus/context` resource |

### Subagent strategy for verbose ops

Dispatch to subagents (Haiku 4.5) when the operation will produce > ~2k tokens of output the parent doesn't need verbatim:

- Test runs (`vitest`, `pytest`, `playwright`)
- Log scraping / grep across many files
- Multi-file research ("how does auth work across these 30 files")
- Doc fetches via WebFetch / context7 over many libraries

Pair with the `caveman-coding` skill so the subagent's report back is itself terse. Use `superpowers:dispatching-parallel-agents` for 2+ independent dispatches.

---

## Layer 5 — Persistent memory via Hindsight

> The lever that makes Layer 3 `/clear` discipline actually viable. Today you hesitate to /clear because you'll lose conversational state. With persistent memory, the durable bits survive in a memory bank and recall on the next prompt — so /clear becomes free.

### What it is

[Hindsight](https://github.com/vectorize-io/hindsight) is a standalone agent-memory service (Docker + embedded Postgres on `:8888`) that stores experiences, world facts, and synthesized mental models. Three primitives: `retain`, `recall` (vector + BM25 + graph + temporal IR with cross-encoder rerank), `reflect` (LLM-driven synthesis). Reports SOTA on LongMemEval (83–91%).

### Two integration paths — pick one, never both

| Path | How memory enters context | Cost shape | Verdict |
|---|---|---|---|
| **Hook plugin** (`UserPromptSubmit` → recall, `Stop` → retain) | Injected as `additionalContext` on each user prompt | +~512–1024 tokens/turn input; +1 internal LLM call on retain | **Recommended** |
| **MCP server** (`claude mcp add … http://localhost:8888/mcp/`) | 26–29 MCP tools Claude *decides* to call | +5–15k tokens of tool defs in cached prefix | Skip — too wide a surface |

### Cache-hit impact

`additionalContext` injection lands at the user-turn boundary, *after* the cached prefix. Doesn't bust prefix cache. The 1024 tokens of recalled memory are paid as fresh input each turn; cache reads on instructions/tool-defs/prior-assistant-turns still hit at 0.1×. **Net: cache-neutral directly; cache-positive indirectly** because aggressive `/clear` becomes safe → smaller per-turn history reload → cleaner cache locality.

### Configuration guardrails

```bash
# Local Hindsight server — cheap retain LLM, NOT Claude (don't double-bill)
docker run --rm -d --pull always -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=ollama \
  -e HINDSIGHT_API_LLM_MODEL=llama3.2:3b \
  -v $HOME/.hindsight-docker:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest

# Claude Code hook plugin — install per the integration docs
# https://hindsight.vectorize.io/sdks/integrations/claude-code
```

Plugin settings:
- `recallMaxTokens: 512` — start tight; raise to 1024 only if recall is visibly trimming meaningful results
- `recallBudget: low` — for latency
- Retain LLM provider: **never `claude-code`** (that doubles your bill); use `ollama` locally or `openai` with `gpt-5-mini`

### Memory consolidation — one source of truth

Today three overlapping systems compete:

| System | Scope | Recall | Disposition |
|---|---|---|---|
| CLAUDE.md auto-memory (`~/.claude/projects/.../memory/MEMORY.md`) | Project | Static load every turn | **Retire.** Migrate entries into Hindsight bank. |
| `bd remember` / `bd memories` | Project (beads) | Manual `bd memories <kw>` | **Retire for memories.** Keep `bd` for issue tracking. Migrate `bd memories` content into Hindsight. |
| Serena `write_memory` / `read_memory` | Project | Manual symbolic | **Keep, narrowed.** Use only for repo-scoped agent-internal notes (codebase conventions, file-layout cheats). |
| **Hindsight (new)** | Banks (per-project or cross-project) | Auto-injected per prompt + on-demand recall/reflect | **Primary store** for personal preferences, project decisions, cross-session learnings. |

### Routing matrix delta

Add to Layer 4 routing matrix:

| Question | Use this |
|---|---|
| "Recall a past preference / decision / correction" | Auto-injected by hook; if missing, ask Claude to issue `recall("…")` to Hindsight |
| "Save a durable insight" | Auto-retained on `Stop`; for explicit saves, `retain(content, tags)` |
| "What does Claude believe about project X right now?" | `reflect("…")` — runs synthesis over the bank |

### Risks

- **Recall noise.** Watch `/context` for the first week. If marginal memories crowd the prompt, lower `recallMaxTokens` or tighten the bank's metadata filters.
- **Hook latency.** 12-s timeout on `UserPromptSubmit`. Usually <500ms; tail latency can stall a prompt.
- **Retain LLM bill.** If misconfigured to use Claude itself (`claude-code` provider), every assistant turn triggers a second LLM call billed to you. Audit.
- **Migration discipline.** Half-migrating CLAUDE.md auto-memory + bd-remember leaves you with two systems telling Claude conflicting things. Cut over decisively, then delete the old indexes.

### Expected contribution

Direct token savings: ~5–15%. Indirect savings via unlocked `/clear` discipline (article fix #1): ~15–25%. The bigger headline wins still come from Layer 1 (plugin/MCP prune) and Layer 2 (thinking off + caveman skill).

---

## Hygiene playbook (the daily routine)

```
Start of session
  ├── Check statusline (model? cache hit? % used?)
  └── /context, /cost (baseline)

Per task
  ├── If new task: /clear
  ├── If task > 5 turns expected: /plan
  └── If editing: gitnexus_impact first; serena:replace_symbol_body for the edit

At ~60% context
  └── /compact "preserve: <key facts>"

Stepping away
  └── /compact (avoid cache decay)

End of session
  ├── gitnexus_detect_changes
  ├── /cost (record)
  └── git commit + push (per CLAUDE.md Session Completion)
```

---

## Implementation checklist

Sequenced, reversible, independent.

- [ ] **Step 1 — this doc.** Created at `C:\dev\GitNexus\future-architecture.md`. ✅
- [ ] **Step 2 — settings.json.** `alwaysThinkingEnabled: false`, `effortLevel: "medium"`, prune `enabledPlugins`, move atlassian/sharepoint/chrome-devtools/crawl4ai out of user-scope `mcpServers`.
- [ ] **Step 3 — caveman-coding skill.** Create `~/.claude/skills/caveman-coding/SKILL.md`.
- [ ] **Step 4 — trim CLAUDE.md.** Project-level only. Drop beads quick-reference and GitNexus Always/Never rules; replace with pointer to AGENTS.md and this doc. Target ≤ 80 lines.
- [ ] **Step 5 — augment AGENTS.md.** Add the routing matrix into `gitnexus:start` block; add the 95%-confidence rule verbatim. Target ≤ 200 lines.
- [ ] **Step 6 — statusline audit.** Read `~/.claude-code/statusline.ps1`; ensure model + context % + session $ + cache-hit % all visible. Edit only if missing data.
- [ ] **Step 7 — `bd prime` hook investigation.** File a beads issue if its output can be slimmed; meanwhile add a wrapper that emits a one-line anchor.
- [ ] **Step 8 — fresh-session baseline.** New session, no input → `/context` → record overhead. This is the "before" number for verification.
- [ ] **Step 9 — Hindsight install.** Run the Docker container with a cheap retain LLM (ollama or `gpt-5-mini` — never `claude-code`). Install the hook plugin (not the MCP path). Set `recallMaxTokens: 512`, `recallBudget: low`.
- [ ] **Step 10 — memory consolidation.** Migrate `bd memories` and `~/.claude/projects/.../memory/MEMORY.md` entries into a Hindsight bank. Stop using both for new memories. Narrow Serena's memory to repo-internal-only notes.
- [ ] **Step 11 — `/clear` adoption.** With persistent memory in place, switch to per-task `/clear` discipline (article fix #1). Watch `/context` for a week to confirm recall isn't injecting noise.

---

## Verification

| Check | How | Target |
|---|---|---|
| Per-task token reduction | Pick a representative beads-flagged bug fix; record `/cost` start/mid/end. Repeat same task type 1 week post-changes. | 40–60% reduction |
| Cold-session overhead | Fresh session, no message → `/context` → MCP/instruction overhead. | < 30k tokens (vs current likely > 60k) |
| Cache-hit rate | Check via dashboard / statusline | > 50% on long sessions |
| Beads close-rate per session | `bd stats` weekly | up vs baseline |
| Plugin/MCP creep | Monthly review checklist below | does not regress |

End-to-end smoke test:
1. `cd C:\dev\GitNexus && npx gitnexus analyze` after CLAUDE.md/AGENTS.md edits — refresh the index.
2. New session → `/context` → confirm reduced overhead.
3. Trigger a one-symbol rename → verify `serena:rename_symbol` is what gets called, not Edit + replace_all.

---

## Monthly review checklist

Run on the 1st of each month. Drift is the failure mode here.

- [ ] `cat ~/.claude/settings.json | jq .enabledPlugins` — anything new? Justify or disable.
- [ ] `cat ~/.claude/settings.json | jq .mcpServers` — anything migrated back to user scope?
- [ ] `wc -l C:\dev\GitNexus\CLAUDE.md C:\dev\GitNexus\AGENTS.md` — over budget? Trim.
- [ ] `alwaysThinkingEnabled` and `effortLevel` — drifted back up?
- [ ] Prompt-cache TTL changes (Anthropic has nerfed it before — cf. xda-developers Apr 2026). Adjust idle-handling rules if shortened.
- [ ] New token-saving techniques in the wild — new caveman variants, new Anthropic features (extended Tool Search, etc.). Add to this doc; update changelog.
- [ ] One-week token spend vs target — if up, audit which sessions overran and why.

---

## Open risks

- **Disabled plugins are not free of friction.** Re-enabling per-session has a workflow cost. If it gets clunky, fall back to a simple `enable-work-mcps.ps1` script that toggles the work MCP set.
- **Caveman-style outputs hide useful explanation.** The skill description carves out planning/design/explanation modes — but if onboarding a teammate or learning a new area, disable explicitly.
- **`alwaysThinkingEnabled: false` will surprise on the first hard task.** Remember to flip on `/think` for those — the lever is there, the default is just lower.
- **GitNexus index staleness.** `gitnexus analyze` after any CLAUDE.md/AGENTS.md edit; the Always-Do rules in this repo's CLAUDE.md already cover this.
- **1M-context economics.** Long context is now standard-priced for Opus/Sonnet, but per-token cost still scales linearly — hygiene still pays.

---

## Sources

Primary:
- Mistry, R. *I Wasted 98.5% of My Claude Tokens — Here Are 10 Fixes That Actually Work.* AI in Plain English, Apr 2026.
- JuliusBrussee/caveman (GitHub) and Guzik, K. *I Benchmarked the Viral Caveman Prompt …* Medium, 2026.

Anthropic primary docs (load on demand, do not cache here):
- Agent Skills overview · Best Practices for Claude Code · Sub-agents docs · Tool Search Tool / advanced tool use · Prompt caching · Session management & 1M context.

MCP comparators:
- oraios/serena (LSP-backed symbolic editing).
- GitNexus AGENTS.md `gitnexus:start` block (canonical for this repo).
- HumanLayer "Writing a good CLAUDE.md".
- MindStudio / Maxim / xda-developers — MCP token-overhead measurements and cache-TTL changes.

---

## Changelog

| Date | Change |
|---|---|
| 2026-04-28 | 0.1.0 — initial draft from /plan output, mighty-fluttering-fern.md |
| 2026-04-28 | 0.2.0 — added Layer 5 (Hindsight persistent memory) + steps 9–11 + memory-consolidation table |
