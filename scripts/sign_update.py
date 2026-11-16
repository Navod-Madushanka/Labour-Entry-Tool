"""Release build: sign the Windows package for the automatic updates (app/updater.py).

    python scripts/sign_update.py public  backend/app/update_key.pub   # the key the app checks with
    python scripts/sign_update.py sign    LabourEntryTool-windows.zip  # writes the .zip.sig

The private key comes from the UPDATE_SIGNING_KEY environment variable (a GitHub Actions secret,
base64 of the 32-byte Ed25519 key made by `LabourEntryTool.exe --make-update-key`). It is never
written to disk or printed. Without it this script says so and exits 3: the build goes on unsigned
and the tool's updater ignores that build.
"""

from __future__ import annotations

import base64
import os
import sys
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def private_key() -> Ed25519PrivateKey:
    secret = os.environ.get("UPDATE_SIGNING_KEY", "").strip()
    if not secret:
        print("UPDATE_SIGNING_KEY is not set: not signed (updates stay off).")
        sys.exit(3)
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(secret, validate=True))


def main(argv: list[str]) -> None:
    what, path = argv[0], Path(argv[1])
    key = private_key()
    if what == "public":
        raw = key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw)
        path.write_text(base64.b64encode(raw).decode() + "\n", encoding="ascii")
        print(f"public key written to {path}")
    elif what == "sign":
        sig = key.sign(path.read_bytes())
        Path(f"{path}.sig").write_text(base64.b64encode(sig).decode() + "\n", encoding="ascii")
        print(f"signed {path.name} ({path.stat().st_size // 1024} KB)")
    else:
        raise SystemExit(f"unknown command {what!r}")


if __name__ == "__main__":
    main(sys.argv[1:])
