"""JavaScript / Electron bundle target.

Handles plain JS/bundle source, Electron ASAR archives and zip-packaged
bundles. No engine needed — this is static source analysis — but the same
interface as the native target, so an agent asks the same questions
(``identify``, ``inventory``, ``strings``, ``trace``) regardless of format.

Modules play the role sections play for a binary: each file is a named region,
and a feature reference is pinned to ``(module, char_offset)`` the way a native
reference is pinned to a vaddr.
"""

from __future__ import annotations

import json
import re
import struct
import zipfile

from .base import Target, StringHit


_STRING_RE = re.compile(r"""(['"])((?:\\.|(?!\1).)*)\1""")
_FUNC_RE = re.compile(
    r"""(?:function\s+([A-Za-z_$][\w$]*)|"""
    r"""(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()|"""
    r"""([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|"""
    r"""class\s+([A-Za-z_$][\w$]*))"""
)
_REQUIRE_RE = re.compile(r"""require\(\s*['"]([^'"]+)['"]\s*\)""")
_IMPORT_RE = re.compile(r"""import\s+(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]""")
_EXPORT_RE = re.compile(
    r"""(?:module\.exports\s*=|exports\.([A-Za-z_$][\w$]*)\s*=|"""
    r"""export\s+(?:default\s+|const\s+|function\s+|class\s+)?([A-Za-z_$][\w$]*))"""
)


class JsBundleTarget(Target):
    kind = "js-bundle"
    source = "builtin JS static analyzer"

    def __init__(self, path: str, detected_kind: str = "js-source"):
        self.path = path
        self.detected_kind = detected_kind
        # modules: name -> source text
        self._modules: dict[str, str] = self._load_modules(path, detected_kind)

    # -- loading ------------------------------------------------------------
    def _load_modules(self, path: str, kind: str) -> dict[str, str]:
        if kind == "js-asar":
            return self._load_asar(path)
        if kind == "js-zip":
            mods = {}
            with zipfile.ZipFile(path) as zf:
                for name in zf.namelist():
                    if name.endswith((".js", ".mjs", ".cjs", ".json")):
                        try:
                            mods[name] = zf.read(name).decode("utf-8", "replace")
                        except OSError:
                            continue
            return mods
        # single source file
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return {path.split("/")[-1]: fh.read()}

    def _load_asar(self, path: str) -> dict[str, str]:
        """Parse an ASAR header (Pickle-framed JSON) and extract text files."""
        with open(path, "rb") as fh:
            raw = fh.read()
        # 4 x uint32 LE preamble; header_size is the 4th; JSON follows.
        (_, _, _, json_size) = struct.unpack("<IIII", raw[:16])
        header_json = raw[16:16 + json_size].split(b"\x00", 1)[0]
        try:
            header = json.loads(header_json.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            return {}
        base = 16 + json_size
        # ASAR aligns file data to the header; offsets in the directory are
        # relative to the start of the file-data region.
        data_base = base
        mods: dict[str, str] = {}

        def walk(node, prefix=""):
            for name, meta in node.get("files", {}).items():
                full = f"{prefix}/{name}".lstrip("/")
                if "files" in meta:
                    walk(meta, full)
                elif "offset" in meta and full.endswith((".js", ".mjs", ".cjs", ".json")):
                    off = data_base + int(meta["offset"])
                    size = int(meta["size"])
                    mods[full] = raw[off:off + size].decode("utf-8", "replace")

        walk(header)
        return mods

    # -- identity -----------------------------------------------------------
    def identify(self) -> dict:
        total = sum(len(s) for s in self._modules.values())
        # crude minification signal: very long lines, few newlines.
        minified = False
        if self._modules:
            sample = max(self._modules.values(), key=len)
            lines = sample.count("\n") + 1
            minified = (len(sample) / max(lines, 1)) > 200
        electron = self.detected_kind == "js-asar" or any(
            "electron" in m.lower() for m in self._modules
        )
        return {
            "format": "JS",
            "arch": "n/a",
            "bits": 0,
            "endian": "n/a",
            "file_type": "electron-app" if electron else "js-bundle",
            "stripped": minified,
            "entrypoint": 0,
            "module_count": len(self._modules),
            "total_source_bytes": total,
            "minified": minified,
        }

    def sections(self) -> list[dict]:
        return [
            {"name": name, "vaddr": 0, "file_offset": 0,
             "size": len(src), "executable": True}
            for name, src in self._modules.items()
        ]

    def symbols(self) -> list[dict]:
        out = []
        for name, src in self._modules.items():
            for m in _FUNC_RE.finditer(src):
                sym = next((g for g in m.groups() if g), None)
                if sym:
                    out.append({"name": sym, "module": name,
                                "offset": m.start(), "is_function": True})
        return out

    def imports(self) -> list[dict]:
        seen = set()
        out = []
        for name, src in self._modules.items():
            for rx in (_REQUIRE_RE, _IMPORT_RE):
                for m in rx.finditer(src):
                    tgt = m.group(1)
                    if tgt not in seen:
                        seen.add(tgt)
                        out.append({"name": tgt, "module": name})
        return out

    def exports(self) -> list[dict]:
        out = []
        for name, src in self._modules.items():
            for m in _EXPORT_RE.finditer(src):
                sym = next((g for g in m.groups() if g), None)
                out.append({"name": sym or "<module.exports>", "module": name})
        return out

    def strings(self, min_len: int = 4) -> list[StringHit]:
        out = []
        for name, src in self._modules.items():
            for m in _STRING_RE.finditer(src):
                val = m.group(2)
                if len(val) >= min_len:
                    out.append(StringHit(
                        value=val, section=name,
                        file_offset=m.start(2), vaddr=None, encoding="utf-8",
                    ))
        return out

    # -- feature trace ------------------------------------------------------
    def _enclosing_function(self, src: str, pos: int) -> tuple[str, float]:
        """Nearest function/class declaration before ``pos``. Static and
        best-effort, so confidence is capped accordingly."""
        best = None
        for m in _FUNC_RE.finditer(src):
            if m.start() <= pos:
                sym = next((g for g in m.groups() if g), None)
                if sym:
                    best = (sym, m.start())
            else:
                break
        if best:
            return best[0], 0.55
        return "<module top-level>", 0.3

    def feature_references(self, value: str) -> list[dict]:
        out = []
        for name, src in self._modules.items():
            for m in _STRING_RE.finditer(src):
                if m.group(2) == value:
                    fn, conf = self._enclosing_function(src, m.start())
                    line = src.count("\n", 0, m.start()) + 1
                    out.append({
                        "where": f"{name}:{line} in {fn}()",
                        "kind": "source",
                        "detail": src[max(0, m.start() - 20):m.end() + 20].replace("\n", " "),
                        "function": {"name": fn, "module": name, "confidence": conf},
                        "locator": {"section": name, "file_offset": m.start(2),
                                    "length": len(value)},
                        "confidence": conf,
                    })
        return out

    def limitations(self) -> list[str]:
        lim = [
            "Static source analysis only — no execution, so runtime-constructed "
            "strings, dynamic require()/import() and eval'd code are not followed.",
            "Enclosing-function resolution is a nearest-declaration heuristic, "
            "not a parsed scope tree.",
        ]
        if self.identify().get("minified"):
            lim.append(
                "Bundle looks minified: identifier names are mangled and "
                "offsets map to generated, not original, source."
            )
        return lim
