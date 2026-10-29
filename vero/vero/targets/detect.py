"""Format detection from file contents — never from the extension.

Detection itself is evidence: the magic bytes we matched are recorded so the
"what is this?" claim can be audited like any other.
"""

from __future__ import annotations

import os
import zipfile


# (slug, human label, matcher) — first match wins.
def _is_elf(head: bytes, path: str) -> bool:
    return head[:4] == b"\x7fELF"


def _is_pe(head: bytes, path: str) -> bool:
    return head[:2] == b"MZ"


def _is_macho(head: bytes, path: str) -> bool:
    return head[:4] in (
        b"\xfe\xed\xfa\xce",  # 32-bit BE/LE forms
        b"\xce\xfa\xed\xfe",
        b"\xfe\xed\xfa\xcf",  # 64-bit
        b"\xcf\xfa\xed\xfe",
        b"\xca\xfe\xba\xbe",  # fat/universal
        b"\xbe\xba\xfe\xca",
    )


def _is_asar(head: bytes, path: str) -> bool:
    # Electron ASAR: a Pickle-framed JSON header. The first uint32 (LE) is 4,
    # and the JSON directory ("{...\"files\"...}") begins at offset 16.
    if head[:4] != b"\x04\x00\x00\x00":
        return False
    return head[16:17] == b"{" or b'"files"' in head[16:256]


def _is_zip_jsbundle(head: bytes, path: str) -> bool:
    if head[:2] != b"PK":
        return False
    try:
        with zipfile.ZipFile(path) as zf:
            names = zf.namelist()
        return any(n.endswith((".js", ".mjs", ".cjs")) for n in names) or any(
            n.endswith("package.json") for n in names
        )
    except (zipfile.BadZipFile, OSError):
        return False


def _is_js_text(head: bytes, path: str) -> bool:
    if path.endswith((".js", ".mjs", ".cjs")):
        return True
    # Heuristic: mostly-text file with JS-ish tokens.
    try:
        sample = head.decode("utf-8", "strict")
    except UnicodeDecodeError:
        return False
    toks = ("function", "=>", "require(", "module.exports", "var ", "const ", "let ")
    return sum(t in sample for t in toks) >= 2


_MATCHERS = [
    ("native-elf", "ELF executable/shared object", _is_elf),
    ("native-macho", "Mach-O executable/object", _is_macho),
    ("native-pe", "PE executable (Windows)", _is_pe),
    ("js-asar", "Electron ASAR bundle", _is_asar),
    ("js-zip", "Zip-packaged JS bundle", _is_zip_jsbundle),
    ("js-source", "JavaScript source/bundle", _is_js_text),
]


def detect(path: str) -> dict:
    """Return ``{kind, label, magic_hex, file_offset}`` for the detected format,
    or kind ``unknown``. ``magic_hex`` is the first bytes we matched on, so the
    identification claim can cite exactly what it saw."""
    with open(path, "rb") as fh:
        head = fh.read(4096)
    for slug, label, matcher in _MATCHERS:
        if matcher(head, path):
            return {
                "kind": slug,
                "label": label,
                "magic_hex": head[:8].hex(),
                "file_offset": 0,
                "size": os.path.getsize(path),
            }
    return {
        "kind": "unknown",
        "label": "unrecognized format",
        "magic_hex": head[:8].hex(),
        "file_offset": 0,
        "size": os.path.getsize(path),
    }
