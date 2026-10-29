"""The target abstraction.

Every kind of input — an ELF, a PE, a JavaScript bundle — answers the same
questions through this interface, so the analyses and the CLI never branch on
format. A target exposes *parsed facts*; it does not build evidence or findings
itself. Each fact carries enough locating information (``file_offset``,
``vaddr``, ``section``) for the analysis layer to pin it in the ledger.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass
class Instruction:
    vaddr: int
    size: int
    mnemonic: str
    op_str: str
    bytes_hex: str
    refs: list[int] = field(default_factory=list)  # addresses this instruction references

    def to_dict(self) -> dict:
        d = {
            "vaddr": self.vaddr,
            "size": self.size,
            "text": f"{self.mnemonic} {self.op_str}".strip(),
            "bytes": self.bytes_hex,
        }
        if self.refs:
            d["refs"] = [hex(r) for r in self.refs]
        return d


@dataclass
class StringHit:
    value: str
    section: str | None
    file_offset: int | None
    vaddr: int | None
    encoding: str = "ascii"

    def to_dict(self) -> dict:
        return {
            "value": self.value,
            "section": self.section,
            "file_offset": self.file_offset,
            "vaddr": self.vaddr,
            "encoding": self.encoding,
        }


class Target(ABC):
    """A parsed input. ``kind`` is a stable slug (e.g. ``native-elf``);
    ``source`` is the engine string recorded on every piece of evidence this
    target backs (e.g. ``LIEF 1.0.0 + Capstone 5.0.7``)."""

    kind: str = "unknown"
    source: str = "builtin"

    @abstractmethod
    def identify(self) -> dict:
        """Format, architecture, bit-width, endianness, file type, whether it is
        stripped, and the entry point. Values the whole analysis keys off."""

    @abstractmethod
    def sections(self) -> list[dict]:
        ...

    @abstractmethod
    def symbols(self) -> list[dict]:
        ...

    @abstractmethod
    def imports(self) -> list[dict]:
        ...

    @abstractmethod
    def exports(self) -> list[dict]:
        ...

    @abstractmethod
    def strings(self, min_len: int = 4) -> list[StringHit]:
        ...

    def disassemble(self, start_vaddr: int, length: int) -> list[Instruction]:
        raise NotImplementedError(f"{self.kind} cannot disassemble")

    def xrefs_to(self, vaddr: int) -> list[Instruction]:
        """Instructions anywhere in executable regions that reference ``vaddr``."""
        raise NotImplementedError(f"{self.kind} cannot compute xrefs")

    def function_bounds(self, vaddr: int) -> tuple[int, int, str, float]:
        """Return ``(start_vaddr, length, name, confidence)`` for the function
        containing ``vaddr``. ``confidence`` in 0..1 reflects how sure we are of
        the bounds (symbol table = sure, heuristic = less)."""
        raise NotImplementedError(f"{self.kind} cannot resolve functions")

    def feature_references(self, value: str) -> list[dict]:
        """Locate where a feature string is used, in format-neutral terms. Each
        entry: ``{where, kind, detail, function, locator, confidence}``. This is
        what ``trace`` is built on; the analysis layer turns the entries into
        evidence and findings without knowing the target's format."""
        raise NotImplementedError(f"{self.kind} cannot trace feature references")

    # Residual-unknowns hook: what a heavier engine / dynamic run would add that
    # this target cannot provide. The analyses surface these to the user.
    def limitations(self) -> list[str]:
        return []
