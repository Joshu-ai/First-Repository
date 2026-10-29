"""vero MCP server (stdio, newline-delimited JSON-RPC 2.0).

Exposes the same analyses as the CLI so an agent like Claude Code can drive vero
over MCP. Deliberately dependency-free — it speaks the protocol directly rather
than pulling an SDK — so it starts anywhere Python runs.

Each tool returns the evidence bundle as JSON text content; the agent gets the
claims *and* the evidence and unknowns behind them in one response.
"""

from __future__ import annotations

import json
import sys

from . import analysis, __version__

PROTOCOL_VERSION = "2024-11-05"

_TOOLS = [
    {
        "name": "identify",
        "description": "Identify a local file's format, architecture, bit-width "
                       "and whether it is stripped. Returns an evidence bundle.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string", "description": "absolute path to the target file"}},
            "required": ["path"],
        },
    },
    {
        "name": "inventory",
        "description": "Enumerate sections/modules, symbols, imports and exports "
                       "of a local target. Returns an evidence bundle.",
        "inputSchema": {
            "type": "object",
            "properties": {"path": {"type": "string"}},
            "required": ["path"],
        },
    },
    {
        "name": "strings",
        "description": "Extract printable strings with their location in the file.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "min_len": {"type": "integer", "default": 4},
                "contains": {"type": "string", "description": "only strings containing this substring"},
            },
            "required": ["path"],
        },
    },
    {
        "name": "trace",
        "description": "Follow a feature string back to the function(s) and "
                       "instruction(s)/source that reference it. The signature "
                       "'how does this feature work' analysis.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "feature": {"type": "string", "description": "the exact string a feature prints/uses"},
            },
            "required": ["path", "feature"],
        },
    },
    {
        "name": "disasm",
        "description": "Disassemble a function in a native binary, by symbol name "
                       "or virtual address (0x...).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "where": {"type": "string"},
                "count": {"type": "integer", "default": 64},
            },
            "required": ["path", "where"],
        },
    },
    {
        "name": "verify",
        "description": "Re-check the integrity of a previously produced evidence "
                       "bundle (recompute every hash and reference).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "bundle": {"type": "object", "description": "a bundle produced by another vero tool"},
                "check_files": {"type": "boolean", "default": False},
            },
            "required": ["bundle"],
        },
    },
]


def _dispatch(name: str, args: dict) -> dict:
    if name == "identify":
        return analysis.identify(args["path"])
    if name == "inventory":
        return analysis.inventory(args["path"])
    if name == "strings":
        return analysis.list_strings(args["path"], args.get("min_len", 4), args.get("contains"))
    if name == "trace":
        return analysis.trace(args["path"], args["feature"])
    if name == "disasm":
        return analysis.disasm(args["path"], args["where"], args.get("count", 64))
    if name == "verify":
        return analysis.verify_bundle(args["bundle"], args.get("check_files", False))
    raise ValueError(f"unknown tool {name!r}")


def _handle(msg: dict) -> dict | None:
    mid = msg.get("id")
    method = msg.get("method")
    params = msg.get("params") or {}

    if method == "initialize":
        return _ok(mid, {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {}},
            "serverInfo": {"name": "vero", "version": __version__},
        })
    if method == "notifications/initialized":
        return None  # notification, no reply
    if method == "tools/list":
        return _ok(mid, {"tools": _TOOLS})
    if method == "tools/call":
        name = params.get("name")
        args = params.get("arguments") or {}
        try:
            bundle = _dispatch(name, args)
        except (ValueError, OSError, KeyError) as exc:
            return _ok(mid, {
                "content": [{"type": "text", "text": f"error: {exc}"}],
                "isError": True,
            })
        return _ok(mid, {
            "content": [{"type": "text", "text": json.dumps(bundle, indent=2)}],
            "isError": False,
        })
    if mid is not None:
        return _err(mid, -32601, f"method not found: {method}")
    return None


def _ok(mid, result):
    return {"jsonrpc": "2.0", "id": mid, "result": result}


def _err(mid, code, message):
    return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}


def serve(stdin=None, stdout=None) -> None:
    stdin = stdin or sys.stdin
    stdout = stdout or sys.stdout
    for line in stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        reply = _handle(msg)
        if reply is not None:
            stdout.write(json.dumps(reply) + "\n")
            stdout.flush()


def main() -> int:  # pragma: no cover
    serve()
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
