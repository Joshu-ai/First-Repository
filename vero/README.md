# vero — evidence-first reverse engineering

`vero` connects a coding agent (Claude Code, and any other MCP client) to a set
of reverse-engineering tools, so the agent can take apart a program it has no
source for and explain how a feature works — with the evidence behind every
claim. The same tools are available as terminal commands.

It is a from-scratch take on the idea behind [REA](https://rea.tools), built to
fix the places that design leaves rough. **Analyze only software you own or are
authorized to analyze.**

> Working name. Easy to rename — the package, the CLI and the MCP server all key
> off one string.

---

## What makes it different

**1. No required engine.** The native path (ELF / PE / Mach-O) runs on
[LIEF](https://lief.re) + [Capstone](https://www.capstone-engine.org), both
installed with the package. There is nothing to download and no `GHIDRA_INSTALL_DIR`
to set before you can start. Heavier engines, when present, only raise the
ceiling (decompilation, fuller control-flow), and `vero` records which engine
produced each result so you always know. REA, by contrast, refuses native
analysis until you supply Ghidra/IDA/JADX yourself.

**2. A verifiable evidence chain, not just per-step bundles.** Every claim is a
*finding* that cites the *evidence* it rests on; every piece of evidence is
content-addressed (its id is the hash of its content) and, where it came from
the file, pins the exact bytes. The whole analysis rolls up to one `root` hash.
Anyone can re-run `vero verify` and confirm nothing was altered — change a
single claim, confidence band or byte and the check fails. Analyses are
deterministic and offline, so a third party who re-runs the same command gets
the same root.

**3. Confidence and falsifiability on every finding.** Each claim carries a
confidence band (`certain` … `speculative`) *and* an explicit "what would
disprove this" plus actionable residual unknowns ("binary is stripped: function
names are heuristic — a symbol table or a control-flow engine would confirm
them"). Findings are built to be audited, not just believed.

**4. One question set across every target.** `identify`, `inventory`,
`strings`, `trace`, `disasm` behave the same whether the target is a native
binary or a JavaScript/Electron bundle. An agent asks "how does this feature
work?" the same way regardless of format.

---

## Install

```bash
pip install -e .          # from this repo
vero doctor               # shows engines + readiness
```

## Use it from the terminal

```bash
# What is this?
vero identify ./app --text

# Map it out: sections, symbols, imports, exports
vero inventory ./app

# Follow a feature back to the code that implements it (the signature move)
vero trace ./app "Licensed: access granted" --text

# Disassemble the function the trace pointed at
vero disasm ./app verify_key --text
vero disasm ./app 0x1169

# Re-check that a saved analysis wasn't altered
vero identify ./app --json > analysis.json
vero verify analysis.json --check-files
```

Every command prints a JSON evidence bundle by default (`--json`), or a short
human summary with `--text`. The two are rendered from the same bundle, so what
you read is exactly what an agent would act on.

## Use it from an agent (MCP)

`vero` ships a dependency-free stdio MCP server exposing `identify`,
`inventory`, `strings`, `trace`, `disasm` and `verify`. Register it with your
agent:

```json
{
  "mcpServers": {
    "vero": { "command": "vero-mcp" }
  }
}
```

Then ask, e.g.: *"Using vero, explain how license checking works in
./app and show me the evidence."*

---

## The evidence bundle

```jsonc
{
  "schema": "1.0",
  "command": "vero trace ./app 'Licensed: access granted'",
  "tool_versions": { "vero": "0.1.0", "lief": "...", "capstone": "..." },
  "root": "<sha256 over every record id>",
  "artifacts": [{ "path": "./app", "sha256": "...", "size": 16048, "media_type": "..." }],
  "evidence": [
    { "id": "<sha256 of content>", "kind": "parsed", "summary": "string present @ 0x2008",
      "source": "LIEF ... + Capstone ...", "method": "...", "locator": { "vaddr": 8200 },
      "inputs": [], "artifact_sha256": "..." }
    // ...
  ],
  "findings": [
    { "id": "...", "claim": "Feature '...' is used by 1 site(s), in function(s): main.",
      "confidence": "high", "confidence_score": 0.8,
      "evidence": ["<id>", "..."], "method": "string -> reference -> enclosing function",
      "falsifiable": "If disassembly mis-attributed a reference, ...",
      "unknowns": [{ "question": "...", "how_to_resolve": "..." }] }
  ]
}
```

`evidence[].inputs` forms a DAG that terminates at raw-byte observations of a
hashed artifact, so any claim can be walked back to the bytes it came from.

---

## Supported targets

| Target | Engine | Needs an external tool? |
|---|---|---|
| ELF / PE / Mach-O | LIEF + Capstone (built in) | No |
| JavaScript source / bundles | built-in static analyzer | No |
| Electron `.asar`, zip bundles | built-in | No |

Designed so more targets (APK, WASM, .NET, firmware, smart-contract bytecode)
can be added behind the same interface and the same evidence model.

## Boundaries (read this)

`vero` is **not a sandbox**. It parses and disassembles files with your user's
permissions; it does not execute the target, but opening a hostile file still
hands its bytes to a parser. Analyze only software you own or are authorized to
analyze, and examine genuinely hostile samples inside a disposable VM — the same
rule any reverse-engineering tool carries. `vero` makes no network connections.

## Develop

```bash
bash tests/build_fixtures.sh   # compiles sample targets from source
pytest -q
```

## License

MIT — see [LICENSE](LICENSE).
