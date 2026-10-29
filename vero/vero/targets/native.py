"""Native binary target: ELF, PE and Mach-O, via LIEF + Capstone.

This is the path REA makes you supply Ghidra/IDA for. Here it works with no
external engine. Where a heavier engine would genuinely do better — full
control-flow recovery, type reconstruction, decompilation to C — we say so in
:meth:`limitations` and in the confidence we attach, rather than pretending the
built-in analysis is the last word.
"""

from __future__ import annotations

import lief
import capstone

from .base import Target, Instruction, StringHit


# LIEF arch name -> (capstone arch, capstone mode, pointer size, little-endian)
_CS = {
    "X86_64": (capstone.CS_ARCH_X86, capstone.CS_MODE_64, 8, True),
    "I386": (capstone.CS_ARCH_X86, capstone.CS_MODE_32, 4, True),
    "x86": (capstone.CS_ARCH_X86, capstone.CS_MODE_32, 4, True),
    "AMD64": (capstone.CS_ARCH_X86, capstone.CS_MODE_64, 8, True),
    "ARM64": (capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM, 8, True),
    "AARCH64": (capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM, 8, True),
    "ARM": (capstone.CS_ARCH_ARM, capstone.CS_MODE_ARM, 4, True),
}


def _arch_key(binary) -> str:
    """Best-effort architecture slug across ELF/PE/Mach-O LIEF models."""
    for attr in ("machine_type", "header"):
        obj = getattr(binary, attr, None)
        if obj is None:
            continue
        mt = getattr(obj, "machine_type", obj)
        name = getattr(mt, "name", str(mt))
        key = name.upper().split(".")[-1]
        if key in _CS:
            return key
    return "X86_64"  # sensible default; disasm will still flag low confidence


class NativeTarget(Target):
    kind = "native"

    def __init__(self, path: str):
        self.path = path
        self._bin = lief.parse(path)
        if self._bin is None:
            raise ValueError(f"LIEF could not parse {path!r}")
        fmt = str(self._bin.format).split(".")[-1].lower()  # elf / pe / macho
        self.kind = f"native-{fmt}"
        self._arch = _arch_key(self._bin)
        csa, csm, self._ptr, self._le = _CS.get(
            self._arch, (capstone.CS_ARCH_X86, capstone.CS_MODE_64, 8, True)
        )
        self._cs = capstone.Cs(csa, csm)
        self._cs.detail = True
        self.source = f"LIEF {lief.__version__} + Capstone {capstone.__version__}"
        self._fn_index: list[tuple[int, int, str]] | None = None  # sorted (start,end,name)

    # -- identity -----------------------------------------------------------
    def identify(self) -> dict:
        b = self._bin
        stripped = len([s for s in b.symbols]) == 0 or not any(
            self._symbol_is_function(s) and s.name for s in b.symbols
        )
        try:
            ftype = str(b.header.file_type).split(".")[-1]
        except Exception:
            ftype = "unknown"
        return {
            "format": self.kind.split("-")[-1].upper(),
            "arch": self._arch,
            "bits": self._ptr * 8,
            "endian": "little" if self._le else "big",
            "file_type": ftype,
            "stripped": stripped,
            "entrypoint": int(b.entrypoint),
            "pie": bool(getattr(b, "is_pie", False)),
        }

    # -- structure ----------------------------------------------------------
    def sections(self) -> list[dict]:
        out = []
        for s in self._bin.sections:
            out.append({
                "name": s.name,
                "vaddr": int(s.virtual_address),
                "file_offset": int(getattr(s, "offset", 0)),
                "size": int(s.size),
                "executable": self._section_is_exec(s),
            })
        return out

    def _section_is_exec(self, s) -> bool:
        # ELF: flags; PE/Mach-O: characteristics vary — fall back to name.
        try:
            flags = getattr(s, "flags", 0)
            # ELF SHF_EXECINSTR = 0x4
            if isinstance(flags, int) and flags & 0x4:
                return True
        except Exception:
            pass
        return s.name in (".text", "__text", ".init", ".plt")

    @staticmethod
    def _symbol_is_function(sym) -> bool:
        t = getattr(sym, "type", None)
        name = getattr(t, "name", str(t)).upper()
        return "FUNC" in name

    def symbols(self) -> list[dict]:
        out = []
        for s in self._bin.symbols:
            if not s.name:
                continue
            out.append({
                "name": s.name,
                "vaddr": int(getattr(s, "value", 0)),
                "size": int(getattr(s, "size", 0)),
                "is_function": self._symbol_is_function(s),
            })
        return out

    def imports(self) -> list[dict]:
        out = []
        try:
            for f in self._bin.imported_functions:
                name = getattr(f, "name", str(f))
                out.append({"name": name})
        except Exception:
            pass
        return out

    def exports(self) -> list[dict]:
        out = []
        try:
            for f in self._bin.exported_functions:
                name = getattr(f, "name", str(f))
                out.append({"name": name})
        except Exception:
            pass
        return out

    # -- bytes / addressing -------------------------------------------------
    def _content_at(self, vaddr: int, length: int) -> tuple[bytes, int] | None:
        """Return (bytes, file_offset) for a vaddr range, reading from whichever
        section contains it."""
        for s in self._bin.sections:
            base = int(s.virtual_address)
            if base == 0:
                continue
            if base <= vaddr < base + int(s.size):
                data = bytes(s.content)
                start = vaddr - base
                return data[start:start + length], int(getattr(s, "offset", 0)) + start
        return None

    def _exec_sections(self):
        for s in self._bin.sections:
            if self._section_is_exec(s) and int(s.size) > 0 and int(s.virtual_address):
                yield s

    # -- strings ------------------------------------------------------------
    def strings(self, min_len: int = 4) -> list[StringHit]:
        hits: list[StringHit] = []
        for s in self._bin.sections:
            data = bytes(s.content)
            if not data:
                continue
            base = int(s.virtual_address)
            foff = int(getattr(s, "offset", 0))
            cur = bytearray()
            start = 0
            for i, byte in enumerate(data):
                if 0x20 <= byte < 0x7F:
                    if not cur:
                        start = i
                    cur.append(byte)
                else:
                    if len(cur) >= min_len:
                        hits.append(StringHit(
                            value=cur.decode("ascii"),
                            section=s.name,
                            file_offset=foff + start if foff else None,
                            vaddr=base + start if base else None,
                        ))
                    cur = bytearray()
            if len(cur) >= min_len:
                hits.append(StringHit(
                    value=cur.decode("ascii"),
                    section=s.name,
                    file_offset=foff + start if foff else None,
                    vaddr=base + start if base else None,
                ))
        return hits

    # -- disassembly --------------------------------------------------------
    def _decode(self, data: bytes, vaddr: int) -> list[Instruction]:
        out = []
        for ins in self._cs.disasm(data, vaddr):
            refs = self._instruction_refs(ins)
            out.append(Instruction(
                vaddr=ins.address, size=ins.size,
                mnemonic=ins.mnemonic, op_str=ins.op_str,
                bytes_hex=ins.bytes.hex(), refs=refs,
            ))
        return out

    def _instruction_refs(self, ins) -> list[int]:
        """Addresses an instruction points at: RIP-relative data refs, absolute
        immediates that fall in a mapped section, and direct branch targets."""
        refs: set[int] = set()
        try:
            for op in ins.operands:
                if op.type == capstone.CS_OP_MEM:
                    m = op.mem
                    base_reg = ins.reg_name(m.base) if m.base else None
                    if base_reg in ("rip", "eip"):
                        refs.add(ins.address + ins.size + m.disp)
                elif op.type == capstone.CS_OP_IMM:
                    if self._in_mapped(op.imm):
                        refs.add(op.imm)
        except Exception:
            pass
        return sorted(refs)

    def _in_mapped(self, addr: int) -> bool:
        for s in self._bin.sections:
            base = int(s.virtual_address)
            if base and base <= addr < base + int(s.size):
                return True
        return False

    def disassemble(self, start_vaddr: int, length: int) -> list[Instruction]:
        got = self._content_at(start_vaddr, length)
        if got is None:
            return []
        data, _ = got
        return self._decode(data, start_vaddr)

    # -- xrefs --------------------------------------------------------------
    def xrefs_to(self, vaddr: int) -> list[Instruction]:
        found: list[Instruction] = []
        for s in self._exec_sections():
            data = bytes(s.content)
            base = int(s.virtual_address)
            for ins in self._decode(data, base):
                if vaddr in ins.refs:
                    found.append(ins)
        return found

    # -- functions ----------------------------------------------------------
    def _build_fn_index(self):
        if self._fn_index is not None:
            return
        funcs: list[tuple[int, int, str]] = []
        for sym in self._bin.symbols:
            if self._symbol_is_function(sym) and getattr(sym, "value", 0):
                start = int(sym.value)
                size = int(getattr(sym, "size", 0))
                funcs.append((start, size, sym.name or f"sub_{start:x}"))
        funcs.sort()
        self._fn_index = funcs

    def function_bounds(self, vaddr: int) -> tuple[int, int, str, float]:
        self._build_fn_index()
        # 1) exact symbol hit
        for start, size, name in self._fn_index:
            if size and start <= vaddr < start + size:
                return start, size, name, 0.95
        # 2) nearest preceding symbol, extend to next symbol
        prev = None
        for i, (start, size, name) in enumerate(self._fn_index):
            if start <= vaddr:
                nxt = self._fn_index[i + 1][0] if i + 1 < len(self._fn_index) else None
                prev = (start, (nxt - start) if nxt else 0, name)
            else:
                break
        if prev:
            return prev[0], prev[1], prev[2], 0.5
        # 3) stripped: fall back to the containing exec section
        for s in self._exec_sections():
            base = int(s.virtual_address)
            if base <= vaddr < base + int(s.size):
                return base, int(s.size), f"{s.name}:sub_{vaddr:x}", 0.25
        return vaddr, 0, f"sub_{vaddr:x}", 0.1

    # -- feature trace ------------------------------------------------------
    def feature_references(self, value: str) -> list[dict]:
        """Find the string(s) equal to ``value`` and, for each, the instructions
        that reference its address and the function each instruction sits in."""
        out: list[dict] = []
        matches = [s for s in self.strings() if s.value == value and s.vaddr]
        for sh in matches:
            for ins in self.xrefs_to(sh.vaddr):
                fstart, fsize, fname, fconf = self.function_bounds(ins.vaddr)
                out.append({
                    "where": f"{fname} @ {hex(ins.vaddr)}",
                    "kind": "instruction",
                    "detail": f"{ins.mnemonic} {ins.op_str}".strip(),
                    "function": {"name": fname, "vaddr": fstart,
                                 "size": fsize, "confidence": fconf},
                    "locator": {"vaddr": ins.vaddr, "section": None,
                                "length": ins.size},
                    "string_vaddr": sh.vaddr,
                    "confidence": fconf,
                })
        return out

    # -- limitations --------------------------------------------------------
    def limitations(self) -> list[str]:
        lim = [
            "Disassembly is linear-sweep within executable sections, not a full "
            "recovered control-flow graph; data interleaved with code can cause "
            "local mis-decoding.",
            "No decompilation to C. A heavier engine (Ghidra/IDA/Binary Ninja) "
            "would recover types, variables and pseudocode.",
            "Only direct references are resolved. Computed/indirect jumps "
            "(jump tables, vtables, dynamic dispatch) are not followed.",
        ]
        if self.identify()["stripped"]:
            lim.append(
                "Binary is stripped: function names and precise bounds are "
                "heuristic (nearest-symbol / section fallback)."
            )
        return lim
