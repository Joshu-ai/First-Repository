"""Tests for vero. Fixtures are compiled by build_fixtures.sh (run on demand)."""

import copy
import json
import os
import subprocess
import sys

import pytest

HERE = os.path.dirname(__file__)
FIX = os.path.join(HERE, "fixtures")
sys.path.insert(0, os.path.dirname(HERE))

from vero import analysis
from vero.evidence import Ledger, Evidence, Finding, Confidence, Locator


def _ensure_fixtures():
    if not os.path.exists(os.path.join(FIX, "licensecheck")):
        subprocess.run(["bash", os.path.join(HERE, "build_fixtures.sh")], check=True)


@pytest.fixture(scope="session", autouse=True)
def fixtures():
    _ensure_fixtures()


# -- evidence core ----------------------------------------------------------
def test_evidence_ids_are_content_addressed():
    led = Ledger("t")
    e1 = led.add_evidence(Evidence("raw_bytes", "s", "builtin", "m", data={"a": 1}))
    led2 = Ledger("t")
    e2 = led2.add_evidence(Evidence("raw_bytes", "s", "builtin", "m", data={"a": 1}))
    assert e1 == e2, "same content must hash to the same id"


def test_finding_must_cite_known_evidence():
    led = Ledger("t")
    with pytest.raises(Exception):
        led.add_finding(Finding("c", Confidence.HIGH, ["does-not-exist"], "m"))


def test_verify_detects_tampered_claim():
    bundle = analysis.identify(os.path.join(FIX, "licensecheck"))
    assert analysis.verify_bundle(bundle)["ok"]
    bad = copy.deepcopy(bundle)
    bad["findings"][0]["claim"] = "a lie"
    assert not analysis.verify_bundle(bad)["ok"]


def test_verify_detects_changed_file():
    bundle = analysis.identify(os.path.join(FIX, "licensecheck"))
    res = analysis.verify_bundle(bundle, check_files=True)
    assert res["ok"], res["problems"]
    bad = copy.deepcopy(bundle)
    bad["artifacts"][0]["sha256"] = "0" * 64
    res2 = analysis.verify_bundle(bad, check_files=True)
    assert not res2["ok"]


# -- native -----------------------------------------------------------------
def test_identify_native_elf():
    b = analysis.identify(os.path.join(FIX, "licensecheck"))
    f = b["findings"][0]
    assert "ELF" in f["claim"]
    assert f["confidence"] == "certain"


def test_trace_named_function_high_confidence():
    b = analysis.trace(os.path.join(FIX, "licensecheck"), "Licensed: access granted")
    f = b["findings"][0]
    assert "main" in f["claim"]
    assert f["confidence"] in ("high", "certain")


def test_trace_stripped_lower_confidence():
    b = analysis.trace(os.path.join(FIX, "licensecheck.stripped"), "Licensed: access granted")
    f = b["findings"][0]
    # Still finds the reference, but is honest that it is less sure.
    assert f["confidence_score"] <= analysis.trace(
        os.path.join(FIX, "licensecheck"), "Licensed: access granted"
    )["findings"][0]["confidence_score"]


def test_trace_missing_string():
    b = analysis.trace(os.path.join(FIX, "licensecheck"), "no such string here xyz")
    assert "not present" in b["findings"][0]["claim"]


def test_disasm_resolves_symbol():
    b = analysis.disasm(os.path.join(FIX, "licensecheck"), "verify_key")
    data = b["evidence"][0]["data"]
    assert data["function"] == "verify_key"
    assert len(data["instructions"]) > 3


def test_inventory_counts():
    b = analysis.inventory(os.path.join(FIX, "licensecheck"))
    assert b["findings"][0]["claim"].startswith("Target exposes")


# -- js ---------------------------------------------------------------------
def test_js_identify_and_trace():
    p = os.path.join(FIX, "app.js")
    ib = analysis.identify(p)
    assert ib["findings"][0]["claim"].startswith("Target is a JS")
    tb = analysis.trace(p, "Licensed: access granted")
    assert "main" in tb["findings"][0]["claim"]


def test_js_inventory_finds_require():
    b = analysis.inventory(os.path.join(FIX, "app.js"))
    imp_ev = [e for e in b["evidence"] if "imports" in e["summary"]][0]
    assert any(i["name"] == "crypto" for i in imp_ev["data"])


def test_asar_detected_and_parsed():
    from vero.targets.detect import detect
    p = os.path.join(FIX, "app.asar")
    assert detect(p)["kind"] == "js-asar"
    b = analysis.trace(p, "Licensed: access granted")
    assert "login" in b["findings"][0]["claim"]


# -- detection --------------------------------------------------------------
def test_detect_magic(tmp_path):
    from vero.targets.detect import detect
    cases = {
        b"MZ" + b"\x00" * 62: "native-pe",
        b"\xcf\xfa\xed\xfe" + b"\x00" * 60: "native-macho",
        b"\x7fELF" + b"\x00" * 60: "native-elf",
    }
    for magic, want in cases.items():
        f = tmp_path / "m"
        f.write_bytes(magic)
        assert detect(str(f))["kind"] == want


# -- bundle shape -----------------------------------------------------------
def test_bundle_has_root_and_versions():
    b = analysis.identify(os.path.join(FIX, "licensecheck"))
    assert len(b["root"]) == 64
    assert "lief" in b["tool_versions"] and "capstone" in b["tool_versions"]
