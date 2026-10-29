"""Analyses: turn target facts into ledger evidence and findings.

Each public function takes an open target and a fresh :class:`Ledger`, records
what it observed as evidence (pinned to the file where possible), states claims
as findings with confidence and falsifiability, and returns the ledger. The CLI
and the MCP server are thin wrappers over these.
"""

from __future__ import annotations

import capstone
import lief

from .evidence import (
    Artifact, Evidence, Finding, Locator, Ledger, Confidence, Unknown,
    sha256_file,
)
from .targets import open_target
from .targets.base import Target


TOOL_VERSIONS = {
    "vero": "0.1.0",
    "lief": lief.__version__,
    "capstone": capstone.__version__,
}


def _new_ledger(command: str) -> Ledger:
    return Ledger(command=command, tool_versions=dict(TOOL_VERSIONS))


def _register_artifact(led: Ledger, path: str, media_type: str) -> Artifact:
    import os
    art = Artifact(path=path, sha256=sha256_file(path),
                   size=os.path.getsize(path), media_type=media_type)
    led.add_artifact(art)
    return art


def _limitation_unknowns(target: Target) -> list[Unknown]:
    return [Unknown(question=lim, how_to_resolve="See the tool/engine note in the limitation.")
            for lim in target.limitations()]


# --------------------------------------------------------------------------
def identify(path: str) -> dict:
    """What is this file? Format, arch, bits, stripped, entrypoint — each tied to
    the bytes it was read from."""
    led = _new_ledger(f"vero identify {path}")
    target, det = open_target(path)
    art = _register_artifact(led, path, det["label"])

    magic_ev = led.add_evidence(Evidence(
        kind="raw_bytes",
        summary=f"File begins with magic bytes {det['magic_hex']}",
        source="builtin",
        method="read first 8 bytes of file",
        data={"magic_hex": det["magic_hex"]},
        locator=Locator(file_offset=0, length=len(det["magic_hex"]) // 2),
        artifact_sha256=art.sha256,
    ))
    ident = target.identify()
    ident_ev = led.add_evidence(Evidence(
        kind="parsed",
        summary=f"Parsed header: {ident['format']} {ident.get('arch')} {ident.get('bits')}-bit",
        source=target.source,
        method="parse container header",
        data=ident,
        inputs=[magic_ev],
        artifact_sha256=art.sha256,
    ))
    led.add_finding(Finding(
        claim=(f"Target is a {ident['format']} "
               f"{'(' + ident['arch'] + ', ' + str(ident['bits']) + '-bit) ' if ident.get('bits') else ''}"
               f"{ident.get('file_type','')}"
               f"{', stripped' if ident.get('stripped') else ''}."),
        confidence=Confidence.CERTAIN,
        evidence=[magic_ev, ident_ev],
        method="magic-byte match + header parse",
        falsifiable="A different magic signature, or a header parse that "
                    "disagrees with the detected format, would disprove this.",
        unknowns=_limitation_unknowns(target),
        tags=["identify"],
    ))
    return led.bundle()


def inventory(path: str) -> dict:
    """Sections, symbols, imports and exports — the map of the target."""
    led = _new_ledger(f"vero inventory {path}")
    target, det = open_target(path)
    art = _register_artifact(led, path, det["label"])

    secs = target.sections()
    syms = target.symbols()
    imps = target.imports()
    exps = target.exports()

    sec_ev = led.add_evidence(Evidence(
        kind="parsed", summary=f"{len(secs)} sections/modules",
        source=target.source, method="enumerate sections",
        data=secs, artifact_sha256=art.sha256))
    sym_ev = led.add_evidence(Evidence(
        kind="parsed", summary=f"{len(syms)} named symbols",
        source=target.source, method="enumerate symbol table",
        data=syms[:500], artifact_sha256=art.sha256))
    imp_ev = led.add_evidence(Evidence(
        kind="parsed", summary=f"{len(imps)} imports",
        source=target.source, method="enumerate imports",
        data=imps, artifact_sha256=art.sha256))
    exp_ev = led.add_evidence(Evidence(
        kind="parsed", summary=f"{len(exps)} exports",
        source=target.source, method="enumerate exports",
        data=exps, artifact_sha256=art.sha256))

    led.add_finding(Finding(
        claim=f"Target exposes {len(secs)} sections/modules, {len(syms)} named "
              f"symbols, {len(imps)} imports and {len(exps)} exports.",
        confidence=Confidence.HIGH,
        evidence=[sec_ev, sym_ev, imp_ev, exp_ev],
        method="container enumeration",
        falsifiable="Re-parsing with another loader and getting different "
                    "counts would disprove these totals.",
        unknowns=_limitation_unknowns(target),
        tags=["inventory"],
    ))
    return led.bundle()


def list_strings(path: str, min_len: int = 4, contains: str | None = None) -> dict:
    """Printable strings with where each lives in the file."""
    led = _new_ledger(f"vero strings {path}")
    target, det = open_target(path)
    art = _register_artifact(led, path, det["label"])

    hits = target.strings(min_len=min_len)
    if contains:
        hits = [h for h in hits if contains in h.value]
    data = [h.to_dict() for h in hits]
    ev = led.add_evidence(Evidence(
        kind="parsed", summary=f"{len(hits)} strings (min_len={min_len})",
        source=target.source, method=f"scan sections for printable runs >= {min_len}",
        data=data[:2000], artifact_sha256=art.sha256))
    led.add_finding(Finding(
        claim=f"Found {len(hits)} printable strings"
              + (f" containing {contains!r}" if contains else "") + ".",
        confidence=Confidence.HIGH,
        evidence=[ev], method="printable-run scan",
        falsifiable="A string present in the bytes but absent from this list "
                    "(e.g. obfuscated/encoded) would show the scan is incomplete.",
        unknowns=_limitation_unknowns(target),
        tags=["strings"],
    ))
    return led.bundle()


def trace(path: str, feature: str) -> dict:
    """Follow a feature string back to the code that uses it — the signature
    analysis. Each reference becomes evidence; the overall path is a finding
    whose confidence is the weakest link (function resolution)."""
    led = _new_ledger(f"vero trace {path} {feature!r}")
    target, det = open_target(path)
    art = _register_artifact(led, path, det["label"])

    # Evidence 1: the string exists.
    hits = [h for h in target.strings() if h.value == feature]
    if not hits:
        led.add_finding(Finding(
            claim=f"Feature string {feature!r} is not present as a literal in the target.",
            confidence=Confidence.HIGH,
            evidence=[led.add_evidence(Evidence(
                kind="parsed", summary="string scan found no exact match",
                source=target.source, method="exact match over extracted strings",
                data={"query": feature, "matches": 0}, artifact_sha256=art.sha256))],
            method="string scan",
            falsifiable="The string may be split, encoded or built at runtime; "
                        "finding it by those means would disprove this.",
            unknowns=_limitation_unknowns(target),
            tags=["trace"],
        ))
        return led.bundle()

    str_ev = led.add_evidence(Evidence(
        kind="parsed",
        summary=f"string {feature!r} present"
                + (f" @ {hex(hits[0].vaddr)}" if hits[0].vaddr else ""),
        source=target.source, method="exact match over extracted strings",
        data={"query": feature, "hits": [h.to_dict() for h in hits]},
        locator=Locator(section=hits[0].section, file_offset=hits[0].file_offset,
                        vaddr=hits[0].vaddr, length=len(feature)),
        artifact_sha256=art.sha256))

    # Evidence 2..n: references to it.
    refs = target.feature_references(feature)
    ref_ids = []
    weakest = 1.0
    for ref in refs:
        loc = ref.get("locator", {})
        ref_ids.append(led.add_evidence(Evidence(
            kind="derived",
            summary=f"referenced at {ref['where']}",
            source=target.source,
            method="xref scan" if ref["kind"] == "instruction" else "source reference scan",
            data=ref,
            locator=Locator(section=loc.get("section"), vaddr=loc.get("vaddr"),
                            file_offset=loc.get("file_offset"), length=loc.get("length")),
            inputs=[str_ev], artifact_sha256=art.sha256)))
        weakest = min(weakest, ref.get("confidence", 0.5))

    if not refs:
        led.add_finding(Finding(
            claim=f"Feature string {feature!r} exists but no direct reference to "
                  "it was found.",
            confidence=Confidence.MEDIUM, evidence=[str_ev],
            method="string + xref scan",
            falsifiable="A reference via an indirect/computed address, which "
                        "this scan does not follow, would disprove this.",
            unknowns=_limitation_unknowns(target), tags=["trace"]))
        return led.bundle()

    functions = sorted({r["function"]["name"] for r in refs})
    conf = (Confidence.HIGH if weakest >= 0.9 else
            Confidence.MEDIUM if weakest >= 0.5 else Confidence.LOW)
    led.add_finding(Finding(
        claim=f"Feature {feature!r} is used by {len(refs)} site(s), in "
              f"function(s): {', '.join(functions)}.",
        confidence=conf, evidence=[str_ev] + ref_ids,
        method="string → reference → enclosing-function trace",
        falsifiable="If disassembly/parsing mis-attributed a reference, the "
                    "enclosing function would be wrong; re-running with a "
                    "control-flow-aware engine would show it.",
        unknowns=_limitation_unknowns(target),
        tags=["trace", "feature"],
    ))
    return led.bundle()


def disasm(path: str, where: str, count: int = 64) -> dict:
    """Disassemble a function (by symbol name or hex/dec vaddr)."""
    led = _new_ledger(f"vero disasm {path} {where}")
    target, det = open_target(path)
    if not det["kind"].startswith("native-"):
        raise ValueError("disasm applies to native binaries only; use 'inventory' "
                         "or 'trace' for JS bundles.")
    art = _register_artifact(led, path, det["label"])

    vaddr = _resolve_where(target, where)
    start, size, name, fconf = target.function_bounds(vaddr)
    length = size if size else count * 16
    ins = target.disassemble(start, length)
    if size == 0 and len(ins) > count:
        ins = ins[:count]

    ev = led.add_evidence(Evidence(
        kind="derived",
        summary=f"disassembled {len(ins)} instructions at {name} ({hex(start)})",
        source=target.source, method="capstone linear disassembly",
        data={"function": name, "start": start, "instructions": [i.to_dict() for i in ins]},
        locator=Locator(vaddr=start, length=length), artifact_sha256=art.sha256))
    led.add_finding(Finding(
        claim=f"Function {name} at {hex(start)} is {len(ins)} instructions"
              + (f" ({size} bytes)" if size else " (bounds estimated)") + ".",
        confidence=(Confidence.HIGH if fconf >= 0.9 else
                    Confidence.MEDIUM if fconf >= 0.5 else Confidence.LOW),
        evidence=[ev], method="symbol/heuristic bounds + linear disasm",
        falsifiable="Data mixed into the code region, or wrong bounds, would "
                    "produce bogus instructions near the edges.",
        unknowns=_limitation_unknowns(target), tags=["disasm"]))
    return led.bundle()


def _resolve_where(target: Target, where: str) -> int:
    where = where.strip()
    try:
        return int(where, 16) if where.lower().startswith("0x") else int(where)
    except ValueError:
        pass
    for s in target.symbols():
        if s.get("name") == where and s.get("vaddr"):
            return int(s["vaddr"])
    raise ValueError(f"could not resolve {where!r} to an address or known symbol")


def doctor() -> dict:
    """Report what vero can do here: core engines (always built-in) and any
    heavier optional engines detected in the environment. Unlike REA, the core
    needs none of the optional ones — they only raise the ceiling."""
    import os
    import shutil
    optional = {
        "ghidra": bool(os.environ.get("GHIDRA_INSTALL_DIR")),
        "radare2": bool(shutil.which("r2")),
        "objdump": bool(shutil.which("objdump")),
    }
    return {
        "vero": TOOL_VERSIONS["vero"],
        "core_engines": {"lief": lief.__version__, "capstone": capstone.__version__},
        "core_ready": True,
        "supported_targets": ["ELF", "PE", "Mach-O", "JavaScript/Electron bundles"],
        "optional_engines_detected": optional,
        "notes": [
            "Core analysis (identify/inventory/strings/trace/disasm) works with "
            "no optional engine.",
            "Optional engines, when present, would add decompilation and fuller "
            "control-flow recovery; vero records which engine produced each result.",
        ],
    }


def verify_bundle(bundle: dict, check_files: bool = False) -> dict:
    """Re-check a serialized bundle's integrity. Returns ``{ok, root, problems}``."""
    led = Ledger.from_bundle(bundle)
    problems = led.verify(check_files=check_files)
    return {
        "ok": not problems,
        "root": led.root(),
        "root_matches": led.root() == bundle.get("root"),
        "problems": problems,
    }
