"""Target loading: detect a file's format and return the right Target."""

from __future__ import annotations

from .base import Target, Instruction, StringHit
from .detect import detect


def open_target(path: str) -> tuple[Target, dict]:
    """Return ``(target, detection)``. Raises ValueError for unsupported or
    unparseable inputs, with a message safe to show the user."""
    det = detect(path)
    kind = det["kind"]
    if kind.startswith("native-"):
        from .native import NativeTarget
        return NativeTarget(path), det
    if kind.startswith("js-"):
        from .jsbundle import JsBundleTarget
        return JsBundleTarget(path, kind), det
    raise ValueError(
        f"unsupported format: {det['label']} (magic {det['magic_hex']}). "
        "Supported: ELF, PE, Mach-O, JavaScript/Electron bundles."
    )


__all__ = ["Target", "Instruction", "StringHit", "detect", "open_target"]
