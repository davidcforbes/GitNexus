import pytest

GitNexusDockerEnvironment = pytest.importorskip(
    "environments.gitnexus_docker"
).GitNexusDockerEnvironment
tool_registry = pytest.importorskip("tool_registry")
TOOL_SPECS = tool_registry.TOOL_SPECS


def test_render_query_script_uses_endpoint_and_fallback():
    script = GitNexusDockerEnvironment._render_tool_script(TOOL_SPECS["query"], "4848")
    assert "/tool/query" in script
    assert "gitnexus query" in script
    assert "GITNEXUS_EVAL_PORT" in script


def test_render_augment_script_skips_curl():
    script = GitNexusDockerEnvironment._render_tool_script(TOOL_SPECS["augment"], "4848")
    assert "/tool/" not in script
    assert "curl" not in script
    assert "gitnexus augment" in script


# ── GitNexus-5c1 regressions ────────────────────────────────────────────

@pytest.mark.parametrize(
    "tool_key",
    ["query", "context", "impact", "cypher"],
)
def test_payload_builders_use_jq_not_string_concatenation(tool_key):
    """
    Payload builders must not assemble JSON via bash string concatenation.
    Pre-fix, an agent argument containing a `"` or `}` would corrupt the
    JSON body and could inject extra fields into the eval-server request.
    """
    spec = TOOL_SPECS[tool_key]
    pb = spec.payload_builder
    # Old shape: payload="{\"key\": \"$var\"" — must be gone.
    assert r'\"$' not in pb, (
        f"{tool_key} payload_builder still concatenates raw $var into JSON"
    )
    assert "jq -n" in pb, f"{tool_key} payload_builder must use `jq -n` for JSON assembly"


# ── GitNexus-s81 regression ─────────────────────────────────────────────

def test_all_tool_specs_bin_names_are_safe():
    """
    Every spec's bin_name must match the same allowlist that
    gitnexus_docker.py enforces at install time. Catches an unsafe
    bin_name at PR-review time instead of install-failure time inside
    a container.
    """
    import re as _re

    bin_re = _re.compile(r"^[a-z][a-z0-9-]{1,32}$")
    for spec in TOOL_SPECS.values():
        assert bin_re.match(spec.bin_name), (
            f"bin_name {spec.bin_name!r} does not match the gitnexus-docker allowlist"
        )
