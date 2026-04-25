# Changelog

All notable changes to GitNexus will be documented in this file.

## [Unreleased]

### Security & stability hardening sweep (2026-04-25 — fork branch `fix/code-review-2026-04-25`)

Closed 77 review-flagged findings across the MCP server, HTTP API, CLI, indexer, web UI, eval harness, Docker images, and Kubernetes policy. Highlights:

**Security**
- Cypher escape ordering — `escapeCypherStringContent` helper escapes `\\` before `'` (prevents string-literal escape via Windows path or crafted symbol name; closes deleteNodesForFile + fallbackRelationshipInserts).
- Mutating `CALL` block — `pool-adapter.isWriteQuery` now rejects `CALL CREATE_FTS_INDEX` / `DROP_FTS_INDEX` / `CREATE_VECTOR_INDEX` / etc. on top of existing keyword block.
- `/api/query` row cap — streams via `streamQuery` and stops at `GITNEXUS_API_QUERY_MAX_ROWS` (default 1000); returns `truncated: true` flag. Closes the unbounded-result OOM path.
- CORS LAN default-deny — RFC 1918 origins now rejected by default; opt back in with `GITNEXUS_ALLOW_LAN_ORIGINS=1` and HTTPS required.
- `/api/analyze` Windows path validation — rejects UNC, DOS device-namespace (`\\?\`, `\\.\`), and NUL-byte paths.
- MCP session cap + ID validation — `mcp-session-id` header shape-checked; new sessions refused at `GITNEXUS_MCP_MAX_SESSIONS` (default 64). Prevents session-map flood OOM.
- Git-clone SSRF guard runs on `git pull` re-clone path too; `extractRepoName` validates against strict allowlist (rejects `..`, URL-encoded separators, NUL bytes, Windows reserved names).
- LLM API-key redactor — bearer / `sk-*` / `x-api-key` patterns stripped from error messages before they surface in CLI / CI logs.
- Wiki LLM prompt-injection mitigation — system-prompt "treat source as DATA" rule + `BEGIN_SOURCE_CODE` / `END_SOURCE_CODE` fences around interpolated source.
- Embedder model revision pinning via `GITNEXUS_EMBEDDER_REVISION` (HF Hub commit).
- Web UI: DOMPurify hardening (`FORBID_TAGS` + `FORBID_ATTR` for SVG `foreignObject` content); Vite dev `fs.allow` narrowed from `['..']` to specific paths; bridge-mode backend URL validated against localhost allowlist; sessionStorage migration order fixed; MiniMax provider switched to `ChatOpenAI` against the OpenAI-compatible endpoint.
- Eval harness: `tool_registry.py` payload builders use `jq -n --arg`; `gitnexus_docker.py` `shlex.quote`s container-derived paths; NodeSource installer uses signed-by apt repo with GPG fingerprint verification (replaces `curl | bash`); `_install_gitnexus` pins to the package version via `GITNEXUS_PIN_VERSION`.
- ClusterImagePolicy accepts both stable (`docker.yml@refs/tags/v*`) and RC (`docker.yml@refs/heads/main`) signing identities; image globs tightened to exact basename + `:*`/`@*` suffix.
- `softprops/action-gh-release` SHA pin comment corrected from `# v2` to `# v3.0.0` (the SHA was already on tag v3.0.0).
- `claude.yml` / `claude-code-review.yml`: removed `allowed_non_write_users: '*'` so the action's internal gate matches the outer `if:` guard.

**Stability**
- Atomic `registry.json` + `.gitignore` writes (temp + rename, EPERM/EBUSY retry on Windows); in-process mutation lock prevents lost-update races between concurrent `analyze` calls.
- `listRegisteredRepos({validate})` is read-only by default (no auto-prune side effect on `gitnexus list`); explicit `pruneStaleRegistryEntries()` for callers that want it.
- Worker-pool wall-clock ceiling per chunk (default 30 min, override `GITNEXUS_CHUNK_WALL_TIMEOUT_MS`); single sub-batch can no longer reset its way to running indefinitely.
- Singleton `lbug-adapter.executeQuery` wraps queries in `withTimeout` (default 30 s, override `GITNEXUS_QUERY_TIMEOUT_MS`).
- Optional symlink-strict path check on lbug open (`GITNEXUS_LBUG_STRICT_PATH=1`).
- Filesystem-walker logs unexpected (non-ENOENT/EISDIR/EPERM/EACCES) read failures; sequential parser-crash path now logs in parity with the worker path.
- `analyze` SIGINT handler restores `console.*` before `closeLbug()`; `setup.ts` skips symlinks during recursive copy.
- Dockerfile.cli adds `tini` as PID 1 — SIGTERM forwarded to node + native children, protects KuzuDB from corruption on `docker stop`.
- `c3Linearize` always allocates a fresh `visiting` set per top-level call (defensive).
- Web UI: `GraphStateProvider` cleans up on unmount; `useBackend` auto-probe gated to localhost origins; `fetchOpenRouterModels` honours user `baseUrl` and uses `AbortSignal.timeout(10s)`; Mermaid init centralized so per-component spacing wins per render.

**Code quality**
- Vue template-component branch hoisted from shared `call-processor.ts` + `parse-worker.ts` to a new `LanguageProvider.auxiliaryCallNamesFromSource` hook implemented in `vue.ts`.
- TS/JS/Rust/C/C++ language branches in shared `import-resolvers/standard.ts` hoisted to a `per-language-behavior.ts` registry; shared resolver dispatches via `getImportBehavior(language)`.
- Confidence-scale unification: scope-resolution CALLS edges now use `TIER_CONFIDENCE['same-file']` (0.95) / `['import-scoped']` (0.9) instead of a flat 0.85 magic number.
- Test infrastructure: `gitnexus-web/test/setup.ts` installs an in-memory Storage shim so the Node v25 built-in `localStorage` global doesn't shadow jsdom's Storage and break the suite.

### Changed
- Migrated from KuzuDB to LadybugDB v0.15 (`@ladybugdb/core`, `@ladybugdb/wasm-core`)
- Renamed all internal paths from `kuzu` to `lbug` (storage: `.gitnexus/kuzu` → `.gitnexus/lbug`)
- Added automatic cleanup of stale KuzuDB index files
- LadybugDB v0.15 requires explicit VECTOR extension loading for semantic search

## [1.5.3] - 2026-04-01

### Added

- **TypeScript/JavaScript MethodExtractor config** — shared extraction config covering abstract methods, visibility modifiers, async/override keywords, decorators, rest/optional/destructured parameters, and return types (#588) — @compound-ai

### Fixed

- **Azure OpenAI compatibility** — use `max_completion_tokens` instead of deprecated `max_tokens` (newer models reject `max_tokens`); skip `temperature` for Azure provider (some models reject non-default values) (#618)
- **Simplified Azure interactive setup** — 3 prompts (endpoint, deployment, key) instead of 7 (#618)
- **Wiki HTML viewer script injection** — escape `</script>` in embedded JSON so LLM-generated markdown no longer breaks the viewer (#618)
- Ensure import rewrites survive npm publish lifecycle

## [1.4.0] - 2026-03-13

### Added

- **Language-aware symbol resolution engine** with 3-tier resolver: exact FQN → scope-walk → guarded fuzzy fallback that refuses ambiguous matches (#238) — @magyargergo
- **Method Resolution Order (MRO)** with 5 language-specific strategies: C++ leftmost-base, C#/Java class-over-interface, Python C3 linearization, Rust qualified syntax, default BFS (#238) — @magyargergo
- **Constructor & struct literal resolution** across all languages — `new Foo()`, `User{...}`, C# primary constructors, target-typed new (#238) — @magyargergo
- **Receiver-constrained resolution** using per-file TypeEnv — disambiguates `user.save()` vs `repo.save()` via `ownerId` matching (#238) — @magyargergo
- **Heritage & ownership edges** — HAS_METHOD, OVERRIDES, Go struct embedding, Swift extension heritage, method signatures (`parameterCount`, `returnType`) (#238) — @magyargergo
- **Language-specific resolver directory** (`resolvers/`) — extracted JVM, Go, C#, PHP, Rust resolvers from monolithic import-processor (#238) — @magyargergo
- **Type extractor directory** (`type-extractors/`) — per-language type binding extraction with `Record<SupportedLanguages, Handler>` + `satisfies` dispatch (#238) — @magyargergo
- **Export detection dispatch table** — compile-time exhaustive `Record` + `satisfies` pattern replacing switch/if chains (#238) — @magyargergo
- **Language config module** (`language-config.ts`) — centralized tsconfig, go.mod, composer.json, .csproj, Swift package config loaders (#238) — @magyargergo
- **Optional skill generation** via `npx gitnexus analyze --skills` — generates AI agent skills from KuzuDB knowledge graph (#171) — @zander-raycraft
- **First-class C# support** — sibling-based modifier scanning, record/delegate/property/field/event declaration types (#163, #170, #178 via #237) — @Alice523, @benny-yamagata, @jnMetaCode
- **C/C++ support fixes** — `.h` → C++ mapping, static-linkage export detection, qualified/parenthesized declarators, 48 entry point patterns (#163, #227 via #237) — @Alice523, @bitgineer
- **Rust support fixes** — sibling-based `visibility_modifier` scanning for `pub` detection (#227 via #237) — @bitgineer
- **Adaptive tree-sitter buffer sizing** — `Math.min(Math.max(contentLength * 2, 512KB), 32MB)` (#216 via #237) — @JasonOA888
- **Call expression matching** in tree-sitter queries (#234 via #237) — @ex-nihilo-jg
- **DeepSeek model configurations** (#217) — @JasonOA888
- 282+ new unit tests, 178 integration resolver tests across 9 languages, 53 test files, 1146 total tests passing

### Fixed

- Skip unavailable native Swift parsers in sequential ingestion (#188) — @Gujiassh
- Heritage heuristic language-gated — no longer applies class/interface rules to wrong languages (#238) — @magyargergo
- C# `base_list` distinguishes EXTENDS vs IMPLEMENTS via symbol table + `I[A-Z]` heuristic (#238) — @magyargergo
- Go `qualified_type` (`models.User`) correctly unwrapped in TypeEnv (#238) — @magyargergo
- Global tier no longer blocks resolution when kind/arity filtering can narrow to 1 candidate (#238) — @magyargergo

### Changed

- `import-processor.ts` reduced from 1412 → 711 lines (50% reduction) via resolver and config extraction (#238) — @magyargergo
- `type-env.ts` reduced from 635 → ~125 lines via type-extractor extraction (#238) — @magyargergo
- CI/CD workflows hardened with security fixes and fork PR support (#222, #225) — @magyargergo

## [1.3.11] - 2026-03-08

### Security

- Fix FTS Cypher injection by escaping backslashes in search queries (#209) — @magyargergo

### Added

- Auto-reindex hook that runs `gitnexus analyze` after commits and merges, with automatic embeddings preservation (#205) — @L1nusB
- 968 integration tests (up from ~840) covering unhappy paths across search, enrichment, CLI, pipeline, worker pool, and KuzuDB (#209) — @magyargergo
- Coverage auto-ratcheting so thresholds bump automatically on CI (#209) — @magyargergo
- Rich CI PR report with coverage bars, test counts, and threshold tracking (#209) — @magyargergo
- Modular CI workflow architecture with separate unit-test, integration-test, and orchestrator jobs (#209) — @magyargergo

### Fixed

- KuzuDB native addon crashes on Linux/macOS by running integration tests in isolated vitest processes with `--pool=forks` (#209) — @magyargergo
- Worker pool `MODULE_NOT_FOUND` crash when script path is invalid (#209) — @magyargergo

### Changed

- Added macOS to the cross-platform CI test matrix (#208) — @magyargergo

## [1.3.10] - 2026-03-07

### Security

- **MCP transport buffer cap**: Added 10 MB `MAX_BUFFER_SIZE` limit to prevent out-of-memory attacks via oversized `Content-Length` headers or unbounded newline-delimited input
- **Content-Length validation**: Reject `Content-Length` values exceeding the buffer cap before allocating memory
- **Stack overflow prevention**: Replaced recursive `readNewlineMessage` with iterative loop to prevent stack overflow from consecutive empty lines
- **Ambiguous prefix hardening**: Tightened `looksLikeContentLength` to require 14+ bytes before matching, preventing false framing detection on short input
- **Closed transport guard**: `send()` now rejects with a clear error when called after `close()`, with proper write-error propagation

### Added

- **Dual-framing MCP transport** (`CompatibleStdioServerTransport`): Auto-detects Content-Length (Codex/OpenCode) and newline-delimited JSON (Cursor/Claude Code) framing on the first message, responds in the same format (#207)
- **Lazy CLI module loading**: All CLI subcommands now use `createLazyAction()` to defer heavy imports (tree-sitter, ONNX, KuzuDB) until invocation, significantly improving `gitnexus mcp` startup time (#207)
- **Type-safe lazy actions**: `createLazyAction` uses constrained generics to validate export names against module types at compile time
- **Regression test suite**: 13 unit tests covering transport framing, security hardening, buffer limits, and lazy action loading

### Fixed

- **CALLS edge sourceId alignment**: `findEnclosingFunctionId` now generates IDs with `:startLine` suffix matching node creation format, fixing process detector finding 0 entry points (#194)
- **LRU cache zero maxSize crash**: Guard `createASTCache` against `maxSize=0` when repos have no parseable files (#144)

### Changed

- Transport constructor accepts `NodeJS.ReadableStream` / `NodeJS.WritableStream` (widened from concrete `ReadStream`/`WriteStream`)
- `processReadBuffer` simplified to break on first error instead of stale-buffer retry loop

## [1.3.9] - 2026-03-06

### Fixed

- Aligned CALLS edge sourceId with node ID format in parse worker (#194)

## [1.3.8] - 2026-03-05

### Fixed

- Force-exit after analyze to prevent KuzuDB native cleanup hang (#192)
