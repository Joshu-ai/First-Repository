# Security & scope

`vero` is a reverse-engineering tool. Use it only on software you own or are
explicitly authorized to analyze.

## It is not a sandbox
`vero` does **not execute** the target. It parses and disassembles the file.
But parsing an untrusted file still runs parser code over attacker-controlled
bytes with your user's permissions. For genuinely hostile samples (malware),
work inside a disposable VM — the same precaution any RE tool warrants.

## What it does on your machine
- Reads the target file and writes analysis output you request. Nothing else.
- Makes **no network connections**.
- Installs no analysis engines behind your back. The core engines (LIEF,
  Capstone) are ordinary Python dependencies; optional heavier engines are used
  only if you have already set them up, and `vero doctor` shows what it sees.

## Reporting
Open an issue describing the problem and a minimal reproducer. Do not include
samples you are not permitted to share.
