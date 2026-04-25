# Guardrails — GitNexus

Rules for **human contributors** and **AI agents**. Complements `AGENTS.md` (workflows) and `CONTRIBUTING.md` (PR process).

## Scope (least privilege)

- **Read:** Source, tests, docs, public config as needed.
- **Write:** Only files required for the fix or feature; no unrelated formatting or refactors.
- **Execute:** Tests, typecheck, documented CLI commands. No destructive commands on user data without approval.
- **Off-limits:** Other people's machines, production deployments you don't own, credentials you lack permission to use.

Maintainer may widen scope per task.

---

## Non-negotiables

1. **Never commit secrets** — API keys, tokens, real `.env` values, private URLs, session cookies. Use `.env.example` with placeholders.
2. **Never rename with find-and-replace** in GitNexus-indexed projects — use `rename` MCP tool with `dry_run: true` first, review `graph` vs `text_search` edits. No separate `gitnexus rename` CLI exists.
3. **Run impact analysis before editing shared symbols** — `impact` (upstream) for functions/classes/methods others call. Do not ignore HIGH/CRITICAL without maintainer sign-off.
4. **Run `detect_changes` before commit** — confirm diffs map to expected symbols/processes when the graph is available.
5. **Preserve embeddings** — plain `npx gitnexus analyze` now preserves any embeddings recorded in `.gitnexus/meta.json` (the previous behavior wiped them). Use `--embeddings` to also generate vectors for new/changed nodes; use `--drop-embeddings` only when an explicit wipe is intended (e.g., model swap).

---

## Signs (recurring failure patterns)

Format: **Trigger → Instruction → Reason**. Append new Signs when the same mistake repeats.

### Stale graph after edits

- **Trigger:** MCP warns index is behind `HEAD`, or search doesn't match latest commit.
- **Do:** `npx gitnexus analyze` (plus `--embeddings` if used).
- **Why:** Tools query LadybugDB from last analyze; git changes are invisible until re-indexed.

### Embeddings vanished after analyze

- **Trigger:** Semantic search quality drops; `stats.embeddings` in `meta.json` is 0 after refresh.
- **Do:** Re-run `npx gitnexus analyze --embeddings` to regenerate. Check the analyze log for a `Warning: could not load cached embeddings` line — if present, the cache restore failed (corrupt DB / schema mismatch) and the rebuild had nothing to preserve. If you intentionally passed `--drop-embeddings`, this is expected.
- **Why:** Plain `analyze` preserves prior vectors by re-inserting them after the rebuild; the only ways to end up at zero are an explicit `--drop-embeddings`, a cache-load failure (now logged), or a model/dimension change that invalidates the cache.

### MCP lists no repos

- **Trigger:** MCP stderr says no indexed repos.
- **Do:** `npx gitnexus analyze` in the target repo; verify `npx gitnexus list` shows it.
- **Why:** MCP discovers repos via `~/.gitnexus/registry.json`, populated by analyze.

### Wrong repo in multi-repo setups

- **Trigger:** Query/impact results belong to another project.
- **Do:** Call `list_repos`, then pass `repo` on subsequent tools.
- **Why:** Default target is ambiguous when multiple repos are registered.

### LadybugDB lock / "database busy"

- **Trigger:** Errors opening `.gitnexus/lbug` while MCP and analyze both run.
- **Do:** Stop overlapping processes (one writer at a time). Retry analyze or restart MCP.
- **Why:** Embedded DB expects single-process ownership.

---

## Publishing & supply chain

- **npm:** Do not publish from unreviewed automation. Bump version intentionally; tag releases to match `package.json`.
- **Dependencies:** Minimal, auditable `package.json` changes; run tests and CI after lockfile updates.
- **License:** PolyForm Noncommercial 1.0.0 — do not relicense without maintainer approval.

---

## Escalation

Stop and ask a **human maintainer** when:

- Impact analysis shows HIGH/CRITICAL risk and the task still requires the change.
- You need to alter CI, release, or security-sensitive config.
- Requirements conflict (e.g. "speed up analyze" vs "must keep all embeddings on huge repo").
- You are unsure whether data loss is acceptable (`clean`, forced migrations, schema changes).

---

## Safety knobs (environment variables)

The hardening sweep added a number of opt-in / opt-out env vars for operators of `gitnexus serve`, the MCP server, the indexer, and the eval harness. All are off / generous-default by default — set them only when you have a reason.

| Variable | Default | Purpose | Set when |
|----------|---------|---------|----------|
| `GITNEXUS_ALLOW_LAN_ORIGINS` | unset | When `1`, CORS accepts RFC 1918 LAN origins (HTTPS still required). | Intentional intranet deployment of `gitnexus serve` behind a TLS-terminating proxy. |
| `GITNEXUS_API_QUERY_MAX_ROWS` | `1000` | Cap on `POST /api/query` row materialisation. | Trusted internal callers that need bigger result sets. |
| `GITNEXUS_QUERY_TIMEOUT_MS` | `30000` | Wall-clock timeout on the singleton `lbug-adapter.executeQuery`. | Long-running internal analysis queries. |
| `GITNEXUS_CHUNK_WALL_TIMEOUT_MS` | `1800000` (30 min) | Per-chunk wall-clock ceiling in the ingestion worker pool. | Indexing very large repos (raise to keep workers alive longer). |
| `GITNEXUS_MCP_MAX_SESSIONS` | `64` | Cap on concurrent MCP HTTP sessions before new initialize POSTs get 503. | Multi-tenant deployments serving many editors. |
| `GITNEXUS_LBUG_STRICT_PATH` | unset | When `1`, refuse to open lbug DBs whose `dbPath` traverses a symlink (defense-in-depth against `INSTALL VECTOR` extension-load bypass). | Hardened deployments that don't legitimately use symlinked HOME / `.gitnexus` dirs. |
| `GITNEXUS_EMBEDDER_REVISION` | unset | HF Hub commit to pin the embedding model to. | Air-gapped or supply-chain-conscious deployments. |
| `GITNEXUS_PIN_VERSION` | auto-detect | Eval-harness override for `npm install -g gitnexus@<version>`. | Reproducible eval runs against a non-default gitnexus build. |

See `CHANGELOG.md` § "Security & stability hardening sweep" for the issue-by-issue rationale behind each knob.

---

## Related docs

- [ARCHITECTURE.md](ARCHITECTURE.md) — components and data flow
- [RUNBOOK.md](RUNBOOK.md) — commands for recovery
- [CONTRIBUTING.md](CONTRIBUTING.md) — PR and commit expectations
- [CHANGELOG.md](CHANGELOG.md) — full history of changes
