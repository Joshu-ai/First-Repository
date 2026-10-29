"""vero command-line interface.

Every subcommand prints a JSON evidence bundle (``--json``, the default for
machine use) or a short human summary (``--text``). The two never disagree: the
text view is rendered from the same bundle, so what you read is what an agent
would act on.
"""

from __future__ import annotations

import argparse
import json
import sys

from . import analysis, __version__
from .evidence import Confidence


def _print(bundle: dict, as_text: bool) -> None:
    if not as_text:
        json.dump(bundle, sys.stdout, indent=2)
        sys.stdout.write("\n")
        return
    _render_text(bundle)


def _render_text(bundle: dict) -> None:
    print(f"command : {bundle['command']}")
    print(f"root    : {bundle['root']}")
    arts = bundle.get("artifacts", [])
    if arts:
        a = arts[0]
        print(f"target  : {a['path']}  ({a['media_type']})")
        print(f"sha256  : {a['sha256']}")
    print(f"evidence: {len(bundle.get('evidence', []))} record(s)")
    print()
    for f in bundle.get("findings", []):
        mark = {
            "certain": "[=]", "high": "[+]", "medium": "[~]",
            "low": "[?]", "speculative": "[!]",
        }.get(f["confidence"], "[ ]")
        print(f"{mark} {f['claim']}")
        print(f"    confidence: {f['confidence']} ({f['confidence_score']:.2f})"
              f"  via {f['method']}")
        if f.get("falsifiable"):
            print(f"    would disprove: {f['falsifiable']}")
        for u in f.get("unknowns", []):
            print(f"    unknown: {u['question']}")
        print(f"    evidence: {len(f['evidence'])} record(s)")
        print()


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="vero",
        description="Evidence-first reverse engineering for software you own or "
                    "are authorized to analyze.")
    p.add_argument("--version", action="version", version=f"vero {__version__}")
    fmt = argparse.ArgumentParser(add_help=False)
    g = fmt.add_mutually_exclusive_group()
    g.add_argument("--json", action="store_true", help="emit JSON bundle (default)")
    g.add_argument("--text", action="store_true", help="emit human summary")

    sub = p.add_subparsers(dest="cmd", required=True)

    s = sub.add_parser("identify", parents=[fmt], help="detect format/arch/bits")
    s.add_argument("path")

    s = sub.add_parser("inventory", parents=[fmt], help="sections, symbols, imports, exports")
    s.add_argument("path")

    s = sub.add_parser("strings", parents=[fmt], help="printable strings with locations")
    s.add_argument("path")
    s.add_argument("--min-len", type=int, default=4)
    s.add_argument("--contains", default=None)

    s = sub.add_parser("trace", parents=[fmt], help="follow a feature string to its code")
    s.add_argument("path")
    s.add_argument("feature")

    s = sub.add_parser("disasm", parents=[fmt], help="disassemble a function (native)")
    s.add_argument("path")
    s.add_argument("where", help="symbol name or vaddr (0x...)")
    s.add_argument("--count", type=int, default=64)

    sub.add_parser("doctor", parents=[fmt], help="report available engines and readiness")

    s = sub.add_parser("verify", parents=[fmt], help="re-check a bundle's integrity")
    s.add_argument("bundle", help="path to a bundle JSON, or - for stdin")
    s.add_argument("--check-files", action="store_true",
                   help="also re-hash the artifact on disk")

    return p


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    as_text = getattr(args, "text", False)
    try:
        if args.cmd == "identify":
            out = analysis.identify(args.path)
        elif args.cmd == "inventory":
            out = analysis.inventory(args.path)
        elif args.cmd == "strings":
            out = analysis.list_strings(args.path, args.min_len, args.contains)
        elif args.cmd == "trace":
            out = analysis.trace(args.path, args.feature)
        elif args.cmd == "disasm":
            out = analysis.disasm(args.path, args.where, args.count)
        elif args.cmd == "doctor":
            out = analysis.doctor()
            json.dump(out, sys.stdout, indent=2)
            sys.stdout.write("\n")
            return 0
        elif args.cmd == "verify":
            raw = sys.stdin.read() if args.bundle == "-" else open(args.bundle).read()
            out = analysis.verify_bundle(json.loads(raw), args.check_files)
            json.dump(out, sys.stdout, indent=2)
            sys.stdout.write("\n")
            return 0 if out["ok"] and out["root_matches"] else 1
        else:  # pragma: no cover
            return 2
    except (ValueError, OSError) as exc:
        print(f"vero: error: {exc}", file=sys.stderr)
        return 1

    _print(out, as_text)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
