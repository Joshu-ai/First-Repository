"""Verifiable evidence ledger.

The ledger is what separates an auditable analysis from a confident-sounding
one. Every claim (:class:`Finding`) points at the :class:`Evidence` it rests
on; every piece of evidence is content-addressed and, where it comes from the
file, pins the exact bytes it was read from. The whole thing rolls up to a
single ``root`` hash, so a third party can re-run the analysis and confirm the
hash matches rather than taking the output on trust.

Design notes
------------
* An id is the sha256 of the canonical JSON of the record *without* its id.
  Change any field and the id changes, which breaks every reference to it, which
  makes :meth:`Ledger.verify` fail. That is the tamper-evidence.
* Evidence records name their ``inputs`` (other evidence ids), so the evidence
  forms a directed acyclic graph that terminates at raw-byte observations of a
  known artifact. A claim can always be walked back to the bytes.
* Nothing here reaches the network or imports an analysis engine. It is pure
  bookkeeping, deterministic, and safe to run on untrusted metadata.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any


SCHEMA_VERSION = "1.0"


def _canonical(obj: Any) -> bytes:
    """Deterministic JSON bytes: sorted keys, no insignificant whitespace."""
    return json.dumps(obj, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _hash(obj: Any) -> str:
    return hashlib.sha256(_canonical(obj)).hexdigest()


def sha256_file(path: str, _chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(_chunk), b""):
            h.update(block)
    return h.hexdigest()


class Confidence(str, Enum):
    """Coarse confidence bands. Kept small on purpose — a finer scale invites
    false precision. Each band also carries a numeric midpoint for sorting."""

    CERTAIN = "certain"        # follows directly from the bytes; no inference
    HIGH = "high"              # strong structural evidence, one reading
    MEDIUM = "medium"          # plausible, but an alternative reading exists
    LOW = "low"                # a guess consistent with the evidence
    SPECULATIVE = "speculative"  # flagged hypothesis, not a claim

    @property
    def score(self) -> float:
        return {
            "certain": 1.0,
            "high": 0.8,
            "medium": 0.55,
            "low": 0.3,
            "speculative": 0.1,
        }[self.value]


@dataclass(frozen=True)
class Locator:
    """Where in the artifact an observation came from. All fields optional so a
    locator can be as precise as ``(section, file_offset, length)`` or as loose
    as ``{"note": "whole file"}``."""

    section: str | None = None
    file_offset: int | None = None
    vaddr: int | None = None
    length: int | None = None
    note: str | None = None

    def to_dict(self) -> dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


@dataclass
class Artifact:
    """The input under analysis, pinned by content hash."""

    path: str
    sha256: str
    size: int
    media_type: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Evidence:
    """A single observation. ``id`` is derived, never supplied by callers."""

    kind: str                       # "raw_bytes" | "tool_output" | "parsed" | "derived"
    summary: str                    # one line, human-readable
    source: str                     # engine + version, e.g. "LIEF 1.0.0" or "builtin"
    method: str                     # how it was obtained (command / routine)
    data: Any = None                # the observation itself (JSON-able)
    locator: Locator | None = None
    inputs: list[str] = field(default_factory=list)  # evidence ids this derives from
    artifact_sha256: str | None = None
    id: str = ""                    # filled in by _finalize

    def _body(self) -> dict:
        return {
            "kind": self.kind,
            "summary": self.summary,
            "source": self.source,
            "method": self.method,
            "data": self.data,
            "locator": self.locator.to_dict() if self.locator else None,
            "inputs": sorted(self.inputs),
            "artifact_sha256": self.artifact_sha256,
        }

    def _finalize(self) -> "Evidence":
        self.id = _hash(self._body())
        return self

    def to_dict(self) -> dict:
        d = self._body()
        d["id"] = self.id
        return d


@dataclass
class Unknown:
    """A residual unknown made actionable: the open question and what would
    resolve it (e.g. a heavier engine, dynamic analysis, the original source)."""

    question: str
    how_to_resolve: str

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Finding:
    """A claim, tied to the evidence it rests on. ``id`` is derived."""

    claim: str
    confidence: Confidence
    evidence: list[str]                         # evidence ids
    method: str
    falsifiable: str = ""                       # what observation would disprove this
    unknowns: list[Unknown] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    id: str = ""

    def _body(self) -> dict:
        return {
            "claim": self.claim,
            "confidence": self.confidence.value,
            "confidence_score": self.confidence.score,
            "evidence": sorted(self.evidence),
            "method": self.method,
            "falsifiable": self.falsifiable,
            "unknowns": [u.to_dict() for u in self.unknowns],
            "tags": sorted(self.tags),
        }

    def _finalize(self) -> "Finding":
        self.id = _hash(self._body())
        return self

    def to_dict(self) -> dict:
        d = self._body()
        d["id"] = self.id
        return d


class LedgerError(Exception):
    pass


class Ledger:
    """Collects artifacts, evidence and findings and seals them under one root
    hash. Add evidence with :meth:`add_evidence` (returns its id so findings can
    cite it), claims with :meth:`add_finding`, then :meth:`bundle` to serialize
    or :meth:`verify` to check integrity."""

    def __init__(self, command: str, tool_versions: dict[str, str] | None = None):
        self.command = command
        self.tool_versions = tool_versions or {}
        self._artifacts: dict[str, Artifact] = {}
        self._evidence: dict[str, Evidence] = {}
        self._findings: dict[str, Finding] = {}

    # -- construction -------------------------------------------------------
    def add_artifact(self, art: Artifact) -> str:
        self._artifacts[art.sha256] = art
        return art.sha256

    def add_evidence(self, ev: Evidence) -> str:
        for dep in ev.inputs:
            if dep not in self._evidence:
                raise LedgerError(f"evidence cites unknown input {dep!r}")
        ev._finalize()
        self._evidence[ev.id] = ev
        return ev.id

    def add_finding(self, fnd: Finding) -> str:
        for eid in fnd.evidence:
            if eid not in self._evidence:
                raise LedgerError(f"finding cites unknown evidence {eid!r}")
        fnd._finalize()
        self._findings[fnd.id] = fnd
        return fnd.id

    # -- sealing ------------------------------------------------------------
    def root(self) -> str:
        """Merkle-style root over every record id. Any change anywhere — a byte
        in the file, a claim, a confidence band — moves this hash."""
        leaves = (
            sorted(self._artifacts)
            + sorted(self._evidence)
            + sorted(self._findings)
        )
        return _hash({"schema": SCHEMA_VERSION, "leaves": leaves})

    def bundle(self) -> dict:
        return {
            "schema": SCHEMA_VERSION,
            "command": self.command,
            "tool_versions": self.tool_versions,
            "root": self.root(),
            "artifacts": [a.to_dict() for a in self._artifacts.values()],
            "evidence": [e.to_dict() for e in sorted(self._evidence.values(), key=lambda x: x.id)],
            "findings": [f.to_dict() for f in sorted(self._findings.values(), key=lambda x: x.id)],
        }

    # -- verification -------------------------------------------------------
    def verify(self, check_files: bool = False) -> list[str]:
        """Recompute every id and reference. Returns a list of problems; empty
        means the bundle is internally consistent. With ``check_files`` it also
        re-hashes each artifact on disk and flags any that changed."""
        problems: list[str] = []

        for ev in self._evidence.values():
            if ev.id != _hash(ev._body()):
                problems.append(f"evidence {ev.id}: id does not match content")
            for dep in ev.inputs:
                if dep not in self._evidence:
                    problems.append(f"evidence {ev.id}: dangling input {dep}")
            if ev.artifact_sha256 and ev.artifact_sha256 not in self._artifacts:
                problems.append(f"evidence {ev.id}: unknown artifact {ev.artifact_sha256}")

        for fnd in self._findings.values():
            if fnd.id != _hash(fnd._body()):
                problems.append(f"finding {fnd.id}: id does not match content")
            for eid in fnd.evidence:
                if eid not in self._evidence:
                    problems.append(f"finding {fnd.id}: dangling evidence {eid}")

        if check_files:
            for art in self._artifacts.values():
                try:
                    actual = sha256_file(art.path)
                except OSError as exc:
                    problems.append(f"artifact {art.sha256}: cannot read ({exc})")
                    continue
                if actual != art.sha256:
                    problems.append(
                        f"artifact {art.path}: on-disk hash {actual} != recorded {art.sha256}"
                    )
        return problems

    @classmethod
    def from_bundle(cls, bundle: dict) -> "Ledger":
        """Load a serialized bundle for verification. Records are trusted as
        written here; call :meth:`verify` to actually check them."""
        led = cls(bundle.get("command", ""), bundle.get("tool_versions", {}))
        for a in bundle.get("artifacts", []):
            art = Artifact(**a)
            led._artifacts[art.sha256] = art
        for e in bundle.get("evidence", []):
            loc = e.get("locator")
            ev = Evidence(
                kind=e["kind"], summary=e["summary"], source=e["source"],
                method=e["method"], data=e.get("data"),
                locator=Locator(**loc) if loc else None,
                inputs=e.get("inputs", []),
                artifact_sha256=e.get("artifact_sha256"),
            )
            ev.id = e["id"]
            led._evidence[ev.id] = ev
        for f in bundle.get("findings", []):
            fnd = Finding(
                claim=f["claim"], confidence=Confidence(f["confidence"]),
                evidence=f.get("evidence", []), method=f["method"],
                falsifiable=f.get("falsifiable", ""),
                unknowns=[Unknown(**u) for u in f.get("unknowns", [])],
                tags=f.get("tags", []),
            )
            fnd.id = f["id"]
            led._findings[fnd.id] = fnd
        return led
