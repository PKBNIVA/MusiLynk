#!/usr/bin/env python3
"""Owner-approved (2026-10-02): create the web-push VAPID key pair and store it on Railway.

Never prints a key. The pair is generated here, written straight to the web service, and the
worker gets references to the web service's values (one copy of the secret). VAPID_SUBJECT is a
mailto: built from the web service's own BREVO_SENDER_EMAIL by reference, so no address is read.

Usage:
  railway_push_keys.py status   names + lengths of the VAPID variables on web and worker
  railway_push_keys.py apply    generate and set (refuses if web already has a private key)
"""
import base64, sys

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from railway_vars import variables, upsert  # noqa: E402

NAMES = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"]
WEB_SERVICE_NAME = "verse-music-platform"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def status():
    for service in ("web", "worker"):
        v = variables(service)
        print(service, {k: (len(v[k]) if k in v else None) for k in NAMES})


def apply():
    if variables("web").get("VAPID_PRIVATE_KEY"):
        raise SystemExit("web already has VAPID_PRIVATE_KEY; not replacing it (existing subscriptions depend on it)")
    key = ec.generate_private_key(ec.SECP256R1())
    private = b64url(key.private_numbers().private_value.to_bytes(32, "big"))
    public = b64url(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    upsert("web", {"VAPID_PUBLIC_KEY": public, "VAPID_PRIVATE_KEY": private, "VAPID_SUBJECT": "mailto:${{BREVO_SENDER_EMAIL}}"})
    upsert("worker", {name: "${{" + WEB_SERVICE_NAME + "." + name + "}}" for name in NAMES})
    del key, private
    status()


if __name__ == "__main__":
    {"status": status, "apply": apply}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
