#!/usr/bin/env bash
# Build sample targets to analyze. Everything here is compiled from source in
# this repo — nothing proprietary, nothing we don't own. Used by the tests.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/fixtures"
mkdir -p "$out"

cat > "$out/licensecheck.c" <<'EOF'
#include <stdio.h>
#include <string.h>

/* A toy "license check": length, a fixed first byte, and a rolling hash. */
int verify_key(const char *s) {
    if (strlen(s) != 5) return 0;
    if (s[0] != 'V') return 0;
    unsigned h = 0;
    for (const char *p = s; *p; p++) h = h * 31u + (unsigned char)*p;
    return h == 2567612u;
}

int main(int argc, char **argv) {
    if (argc < 2) { printf("usage: licensecheck <key>\n"); return 2; }
    if (verify_key(argv[1])) printf("Licensed: access granted\n");
    else                     printf("Denied: invalid key\n");
    return 0;
}
EOF

# Non-stripped (symbols present -> high-confidence function resolution).
gcc -O1 -o "$out/licensecheck" "$out/licensecheck.c"
# Stripped (exercises the heuristic fallback).
gcc -O1 -s -o "$out/licensecheck.stripped" "$out/licensecheck.c"

# A tiny JS "app" with a traceable feature.
cat > "$out/app.js" <<'EOF'
const crypto = require('crypto');

function verifyKey(key) {
  if (key.length !== 5) return false;
  const h = crypto.createHash('sha256').update(key).digest('hex');
  return h.startsWith('00');
}

function main(key) {
  if (verifyKey(key)) {
    console.log('Licensed: access granted');
  } else {
    console.log('Denied: invalid key');
  }
}

module.exports = { verifyKey, main };
EOF

# A minimal Electron ASAR archive (Pickle-framed JSON header + file data),
# built from source so the ASAR parser has something real to read.
python3 - "$out" <<'PY'
import json, struct, sys, os
out = sys.argv[1]
src = b"function login(){ return 'Licensed: access granted'; }\nmodule.exports={login};\n"
header = {"files": {"index.js": {"size": len(src), "offset": "0"}}}
hj = json.dumps(header).encode()
pre = struct.pack("<IIII", 4, len(hj)+8, len(hj)+4, len(hj))
open(os.path.join(out, "app.asar"), "wb").write(pre + hj + src)
PY

echo "fixtures built in $out"
