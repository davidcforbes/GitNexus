"""
GitNexus Docker Environment for SWE-bench Evaluation

Extends mini-swe-agent's Docker environment to:
1. Install GitNexus (Node.js + npm + gitnexus package)
2. Run `gitnexus analyze` on the repository
3. Start the eval-server daemon (persistent HTTP server with warm KuzuDB)
4. Install standalone tool scripts in /usr/local/bin/ (works with subprocess.run)
5. Cache indexes per (repo, base_commit) to avoid re-indexing

IMPORTANT: mini-swe-agent runs every command with subprocess.run in a fresh subshell.
This means .bashrc is NOT sourced, exported functions are NOT available, and env vars
don't persist. The tool scripts must be standalone executables in $PATH.

Architecture:
  Agent bash cmd → /usr/local/bin/gitnexus-query → curl localhost:4848/tool/query → eval-server → KuzuDB
  Fallback: → npx gitnexus query (cold start, slower)

Tool call latency: ~50-100ms via eval-server, ~5-10s via CLI fallback.
"""

import hashlib
import json
import logging
import os
import re
import shlex
import shutil
import time
from pathlib import Path

from constants import (
    EVAL_SERVER_HEALTH_INTERVAL_SECONDS,
    EVAL_SERVER_HEALTH_RETRIES,
    EVAL_SERVER_HEALTH_TIMEOUT_SECONDS,
)
from minisweagent.environments.docker import DockerEnvironment
from tool_registry import TOOL_SPECS, ToolScriptSpec
from utils.errors import is_debug_enabled, log_safe_exception

logger = logging.getLogger("gitnexus_docker")

DEFAULT_CACHE_DIR = Path.home() / ".gitnexus-eval-cache"
EVAL_SERVER_PORT = 4848

# Allow only short kebab-case identifiers as binary names installed under
# /usr/local/bin. Catches accidental path separators, shell metacharacters,
# and absurd lengths. (GitNexus-s81)
_BIN_NAME_RE = re.compile(r"^[a-z][a-z0-9-]{1,32}$")


def _read_gitnexus_pinned_version() -> str | None:
    """Read the gitnexus version this eval harness was developed against
    from the sibling gitnexus/package.json. Returns None if the file
    can't be located or parsed — install_gitnexus then falls back to
    `latest`. (GitNexus-uwk)

    Lookups, in order:
      1. GITNEXUS_PIN_VERSION env var (operator override)
      2. <repo-root>/gitnexus/package.json (monorepo dev / docker build)
    """
    env = os.environ.get("GITNEXUS_PIN_VERSION")
    if env:
        return env.strip()
    # Walk up from this file looking for a sibling gitnexus/package.json.
    here = Path(__file__).resolve()
    for parent in here.parents:
        candidate = parent / "gitnexus" / "package.json"
        if candidate.is_file():
            try:
                data = json.loads(candidate.read_text(encoding="utf-8"))
                ver = data.get("version")
                if isinstance(ver, str) and ver.strip():
                    return ver.strip()
            except (OSError, json.JSONDecodeError):
                return None
    return None


_GITNEXUS_PINNED_VERSION: str | None = _read_gitnexus_pinned_version()


class GitNexusDockerEnvironment(DockerEnvironment):
    """
    Docker environment with GitNexus pre-installed, indexed, and eval-server running.

    Setup flow:
    1. Start Docker container (base SWE-bench image)
    2. Install Node.js + gitnexus inside the container
    3. Run `gitnexus analyze` (or restore from cache)
    4. Start `gitnexus eval-server` daemon (keeps KuzuDB warm)
    5. Install standalone tool scripts in /usr/local/bin/
    6. Agent runs with near-instant GitNexus tool calls
    """

    def __init__(
        self,
        *,
        enable_gitnexus: bool = True,
        cache_dir: str | Path | None = None,
        skip_embeddings: bool = True,
        gitnexus_timeout: int = 120,
        eval_server_port: int = EVAL_SERVER_PORT,
        **kwargs,
    ):
        super().__init__(**kwargs)
        self.enable_gitnexus = enable_gitnexus
        self.cache_dir = Path(cache_dir) if cache_dir else DEFAULT_CACHE_DIR
        self.skip_embeddings = skip_embeddings
        self.gitnexus_timeout = gitnexus_timeout
        self.eval_server_port = eval_server_port
        self.index_time: float = 0.0
        self._gitnexus_ready = False

    def start(self) -> dict:
        """Start the container and set up GitNexus."""
        result = super().start()

        if self.enable_gitnexus:
            try:
                self._setup_gitnexus()
            except Exception as e:
                log_safe_exception(
                    logger,
                    "GitNexus setup failed, continuing without it",
                    e,
                    include_debug=is_debug_enabled(),
                    level="warning",
                )
                self._gitnexus_ready = False

        return result

    def _setup_gitnexus(self):
        """Install and configure GitNexus in the container."""
        start = time.time()

        self._ensure_nodejs()
        self._install_gitnexus()
        self._index_repository()
        self._start_eval_server()
        self._install_tools()

        self.index_time = time.time() - start
        self._gitnexus_ready = True
        logger.info(f"GitNexus setup completed in {self.index_time:.1f}s")

    def _ensure_nodejs(self):
        """Ensure Node.js >= 18 is available in the container."""
        check = self.execute({"command": "node --version 2>/dev/null || echo 'NOT_FOUND'"})
        output = check.get("output", "").strip()

        if "NOT_FOUND" in output:
            logger.info("Installing Node.js in container...")
            # GitNexus-fi8: install Node from the official NodeSource apt
            # repo using a pre-imported armored GPG key, instead of piping
            # `setup_20.x` through bash. The previous shape (`curl ... |
            # bash -`) has no integrity check — a compromised CDN response
            # OR an attacker who has MITM'd the container's HTTPS would
            # have run arbitrary root-level code inside the eval container,
            # which then has docker-socket access in some configs.
            install_cmds = [
                "apt-get update -qq",
                # jq required by tool_registry.py payload builders (GitNexus-5c1).
                # gnupg required to import the NodeSource signing key.
                "apt-get install -y -qq curl ca-certificates jq gnupg",
                # Import NodeSource's signing key from keyserver into a
                # dedicated keyring (avoids mutating /etc/apt/trusted.gpg).
                "install -m 0755 -d /etc/apt/keyrings",
                # NodeSource's well-known signing key. After download we
                # verify the fingerprint matches the published value before
                # trusting it for apt — this catches a swapped-key MITM /
                # CDN compromise that would otherwise be invisible.
                # (Fingerprint published at:
                #  https://github.com/nodesource/distributions#installation-instructions)
                "curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key "
                    "-o /tmp/nodesource.asc",
                # Expected fingerprint (no spaces). If NodeSource rotates
                # their signing key, this string must be updated and the
                # new fingerprint reverified out-of-band.
                'EXPECTED_FP="9FD3B784BC1C6FC31A8A0A1C1655A0AB68576280" && '
                    "GOT_FP=$(gpg --show-keys --with-fingerprint --with-colons "
                    "/tmp/nodesource.asc | awk -F: '/^fpr:/{print $10; exit}') && "
                    'if [ "$GOT_FP" != "$EXPECTED_FP" ]; then '
                    '  echo "NodeSource GPG key fingerprint mismatch: got $GOT_FP, '
                    'expected $EXPECTED_FP" >&2; exit 1; fi',
                "gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg /tmp/nodesource.asc",
                "rm -f /tmp/nodesource.asc",
                # Pin the apt source to Node 20.x (matches the previous setup_20.x
                # behaviour) using the imported keyring for verification.
                'echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] '
                    'https://deb.nodesource.com/node_20.x nodistro main" '
                    "> /etc/apt/sources.list.d/nodesource.list",
                "apt-get update -qq",
                "apt-get install -y -qq nodejs",
            ]
            for cmd in install_cmds:
                result = self.execute({"command": cmd, "timeout": 60})
                if result.get("returncode", 1) != 0:
                    raise RuntimeError(f"Failed to install Node.js: {result.get('output', '')}")
        else:
            logger.info(f"Node.js already available: {output}")
            # Even when Node is preinstalled, ensure jq is present for the
            # tool_registry.py payload builders (GitNexus-5c1).
            jq_check = self.execute({"command": "jq --version 2>/dev/null || echo 'NOT_FOUND'"})
            if "NOT_FOUND" in jq_check.get("output", ""):
                logger.info("Installing jq in container (required by gitnexus-* tool wrappers)...")
                self.execute({"command": "apt-get update -qq && apt-get install -y -qq jq", "timeout": 60})

    def _install_gitnexus(self):
        """Install the gitnexus npm package globally.

        Pins to the version declared in gitnexus/package.json so eval
        runs are reproducible — `npm install -g gitnexus` (no version)
        would resolve `latest` at container-start time, meaning the
        same eval suite re-run a week later could silently swap in a
        different code base. (GitNexus-uwk)

        The version is read at harness import time (see
        `_GITNEXUS_PINNED_VERSION` near the top of this module). If we
        can't determine it, fall back to `latest` rather than failing
        — losing reproducibility is preferable to losing the ability
        to run.
        """
        check = self.execute({"command": "npx gitnexus --version 2>/dev/null || echo 'NOT_FOUND'"})
        if "NOT_FOUND" in check.get("output", ""):
            target = (
                f"gitnexus@{_GITNEXUS_PINNED_VERSION}"
                if _GITNEXUS_PINNED_VERSION
                else "gitnexus"
            )
            logger.info(f"Installing {target}...")
            result = self.execute({
                "command": f"npm install -g {target}",
                "timeout": 60,
            })
            if result.get("returncode", 1) != 0:
                raise RuntimeError(f"Failed to install gitnexus: {result.get('output', '')}")

    def _index_repository(self):
        """Run gitnexus analyze on the repo, using cache if available."""
        repo_info = self._get_repo_info()
        cache_key = self._make_cache_key(repo_info)
        cache_path = self.cache_dir / cache_key

        if cache_path.exists():
            logger.info(f"Restoring GitNexus index from cache: {cache_key}")
            self._restore_cache(cache_path)
            return

        logger.info("Running gitnexus analyze...")
        skip_flag = "--skip-embeddings" if self.skip_embeddings else ""
        result = self.execute({
            "command": f"cd /testbed && npx gitnexus analyze . {skip_flag} 2>&1",
            "timeout": self.gitnexus_timeout,
        })

        if result.get("returncode", 1) != 0:
            output = result.get("output", "")
            if "error" in output.lower() and "indexed" not in output.lower():
                raise RuntimeError(f"gitnexus analyze failed: {output[-500:]}")

        self._save_cache(cache_path, repo_info)

    def _start_eval_server(self):
        """Start the GitNexus eval-server daemon in the background."""
        logger.info(f"Starting eval-server on port {self.eval_server_port}...")

        self.execute({
            "command": (
                f"nohup npx gitnexus eval-server --port {self.eval_server_port} "
                f"--idle-timeout 600 "
                f"> /tmp/gitnexus-eval-server.log 2>&1 &"
            ),
            "timeout": 5,
        })

        # Wait for the server to be ready (up to ~15s for KuzuDB init)
        for i in range(EVAL_SERVER_HEALTH_RETRIES):
            time.sleep(EVAL_SERVER_HEALTH_INTERVAL_SECONDS)
            health = self.execute({
                "command": f"curl -sf http://127.0.0.1:{self.eval_server_port}/health 2>/dev/null || echo 'NOT_READY'",
                "timeout": EVAL_SERVER_HEALTH_TIMEOUT_SECONDS,
            })
            output = health.get("output", "").strip()
            if "NOT_READY" not in output and "ok" in output:
                logger.info(
                    f"Eval-server ready after {(i + 1) * EVAL_SERVER_HEALTH_INTERVAL_SECONDS:.1f}s"
                )
                return

        log_output = self.execute({
            "command": "cat /tmp/gitnexus-eval-server.log 2>/dev/null | tail -20",
        })
        logger.warning(
            f"Eval-server didn't become ready in "
            f"{EVAL_SERVER_HEALTH_RETRIES * EVAL_SERVER_HEALTH_INTERVAL_SECONDS:.1f}s. "
            f"Tools will fall back to direct CLI.\n"
            f"Server log: {log_output.get('output', 'N/A')}"
        )

    @staticmethod
    def _render_tool_script(spec: ToolScriptSpec, port: str) -> str:
        """
        Render a standalone bash script for a GitNexus tool.

        Scripts call the eval-server fast path when an endpoint is present,
        and fall back to the CLI otherwise.
        """
        lines = ["#!/bin/bash"]

        if spec.endpoint:
            lines.append(f'PORT="${{GITNEXUS_EVAL_PORT:-{port}}}"')

        if spec.header:
            lines.append(spec.header.strip())

        if spec.payload_builder:
            lines.append(spec.payload_builder.strip())

        if spec.endpoint:
            lines.append(
                f'result=$(curl -sf -X POST "http://127.0.0.1:${{PORT}}{spec.endpoint}" '
                '-H "Content-Type: application/json" -d "$payload" 2>/dev/null)'
            )
            lines.append('if [ $? -eq 0 ] && [ -n "$result" ]; then echo "$result"; exit 0; fi')

        lines.append(spec.fallback.strip())
        return "\n".join(lines)

    def _install_tools(self):
        """
        Install standalone GitNexus tool scripts in /usr/local/bin/.

        Each script is a self-contained bash script that:
        1. Calls the eval-server via curl (fast path, ~100ms)
        2. Falls back to direct CLI if eval-server is unavailable

        These are standalone executables — no sourcing, env inheritance, or .bashrc
        needed. This is critical because mini-swe-agent runs every command via
        subprocess.run in a fresh subshell.

        Uses heredocs with quoted delimiter to avoid all quoting/escaping issues.
        """
        port = str(self.eval_server_port)

        for spec in TOOL_SPECS.values():
            # GitNexus-s81: validate bin_name BEFORE interpolating into the
            # heredoc command. Today TOOL_SPECS only contains static names
            # but if a future entry's bin_name had a path separator or shell
            # metacharacter (e.g. "../../etc/cron.d/evil"), this command
            # would write to an arbitrary host path inside the container as
            # root. Allow only short kebab-case identifiers.
            if not _BIN_NAME_RE.match(spec.bin_name):
                raise ValueError(
                    f"Refusing to install tool with unsafe bin_name {spec.bin_name!r}: "
                    f"must match {_BIN_NAME_RE.pattern}"
                )
            script_content = self._render_tool_script(spec, port).strip()
            # Use heredoc with quoted delimiter — prevents all variable expansion and quoting issues
            self.execute({
                "command": (
                    f"cat << 'GITNEXUS_SCRIPT_EOF' > /usr/local/bin/{spec.bin_name}\n"
                    f"{script_content}\n"
                    "GITNEXUS_SCRIPT_EOF\n"
                    f"chmod +x /usr/local/bin/{spec.bin_name}"
                ),
                "timeout": 5,
            })

        logger.info(f"Installed {len(TOOL_SPECS)} GitNexus tool scripts in /usr/local/bin/")

    def _get_repo_info(self) -> dict:
        """Get repository identity info from the container."""
        repo_result = self.execute({
            "command": "cd /testbed && basename $(git remote get-url origin 2>/dev/null || basename $(pwd)) .git"
        })
        commit_result = self.execute({"command": "cd /testbed && git rev-parse HEAD 2>/dev/null || echo unknown"})

        return {
            "repo": repo_result.get("output", "unknown").strip(),
            "commit": commit_result.get("output", "unknown").strip(),
        }

    @staticmethod
    def _make_cache_key(repo_info: dict) -> str:
        """Create a deterministic cache key from repo info."""
        content = f"{repo_info['repo']}:{repo_info['commit']}"
        return hashlib.sha256(content.encode()).hexdigest()[:16]

    def _save_cache(self, cache_path: Path, repo_info: dict):
        """Save the GitNexus index to the host cache directory."""
        try:
            cache_path.mkdir(parents=True, exist_ok=True)

            find_result = self.execute({
                "command": "find /root/.gitnexus -name 'kuzu' -type d 2>/dev/null | head -1"
            })
            gitnexus_dir = find_result.get("output", "").strip()

            if gitnexus_dir:
                parent = str(Path(gitnexus_dir).parent)
                # GitNexus-dyr: shlex.quote `parent` before interpolating
                # into the shell command. parent is derived from a `find`
                # output inside the container; without quoting, a directory
                # with shell metacharacters in its name (possible from
                # whatever the SWE-bench / agent fixture creates) would
                # be interpreted by sh.
                quoted_parent = shlex.quote(parent)
                self.execute({
                    "command": f"cd {quoted_parent} && tar czf /tmp/gitnexus-cache.tar.gz .",
                    "timeout": 30,
                })

                container_id = getattr(self, "_container_id", None) or getattr(self, "container_id", None)
                if container_id:
                    import subprocess as sp
                    sp.run(
                        ["docker", "cp", f"{container_id}:/tmp/gitnexus-cache.tar.gz",
                         str(cache_path / "index.tar.gz")],
                        check=True, capture_output=True,
                    )
                    (cache_path / "metadata.json").write_text(json.dumps(repo_info, indent=2))
                    logger.info(f"Cached GitNexus index: {cache_path}")

        except Exception as e:
            log_safe_exception(
                logger,
                "Failed to cache GitNexus index",
                e,
                include_debug=is_debug_enabled(),
                level="warning",
            )
            if cache_path.exists():
                shutil.rmtree(cache_path, ignore_errors=True)

    def _restore_cache(self, cache_path: Path):
        """Restore a cached GitNexus index into the container."""
        try:
            cache_tarball = cache_path / "index.tar.gz"
            if not cache_tarball.exists():
                logger.warning("Cache tarball not found, re-indexing")
                self._index_repository()
                return

            container_id = getattr(self, "_container_id", None) or getattr(self, "container_id", None)
            if container_id:
                import subprocess as sp

                self.execute({"command": "mkdir -p /root/.gitnexus"})

                storage_result = self.execute({
                    "command": "npx gitnexus list 2>/dev/null | grep -o '/root/.gitnexus/[^ ]*' | head -1 || echo '/root/.gitnexus/repos/default'"
                })
                storage_path = storage_result.get("output", "").strip() or "/root/.gitnexus/repos/default"
                # GitNexus-dyr: shlex.quote storage_path before interpolating.
                # Source is `npx gitnexus list` parsed by grep — values come
                # ultimately from the registry but the parsing pipeline is
                # fragile, and we never want shell-execution of unexpected
                # characters in this path.
                quoted_storage = shlex.quote(storage_path)
                self.execute({"command": f"mkdir -p {quoted_storage}"})

                sp.run(
                    ["docker", "cp", str(cache_tarball), f"{container_id}:/tmp/gitnexus-cache.tar.gz"],
                    check=True, capture_output=True,
                )
                self.execute({
                    "command": f"cd {quoted_storage} && tar xzf /tmp/gitnexus-cache.tar.gz",
                    "timeout": 30,
                })
                logger.info("GitNexus index restored from cache")

        except Exception as e:
            log_safe_exception(
                logger,
                "Failed to restore cache, re-indexing",
                e,
                include_debug=is_debug_enabled(),
                level="warning",
            )
            self._index_repository()

    def stop(self) -> dict:
        """Stop the container, shutting down eval-server first."""
        if self._gitnexus_ready:
            try:
                self.execute({
                    "command": f"curl -sf -X POST http://127.0.0.1:{self.eval_server_port}/shutdown 2>/dev/null || true",
                    "timeout": 3,
                })
            except Exception:
                pass

        return super().stop()

    def get_template_vars(self) -> dict:
        """Add GitNexus-specific template variables."""
        base_vars = super().get_template_vars()
        base_vars["gitnexus_ready"] = self._gitnexus_ready
        base_vars["gitnexus_index_time"] = self.index_time
        return base_vars

    def serialize(self) -> dict:
        """Include GitNexus environment info in serialization."""
        base = super().serialize()
        base.setdefault("info", {})["gitnexus_env"] = {
            "enabled": self.enable_gitnexus,
            "ready": self._gitnexus_ready,
            "index_time_seconds": round(self.index_time, 2),
            "skip_embeddings": self.skip_embeddings,
            "eval_server_port": self.eval_server_port,
        }
        return base
