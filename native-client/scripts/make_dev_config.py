#!/usr/bin/env python3
"""Local demo helper: dev key banao, trusted_keys.json me public key daalo, signed demo .safeexam config likho.

  python scripts/make_dev_config.py --exam-url http://localhost:5173/ --api http://localhost:8000
Dev only: SAFEEXAM_ENV=dev set karke client chalao (http://localhost allowed). Production me real HTTPS URLs + alag production key.
Private key `scripts/dev-keys/` me banti hai (gitignored) - kabhi commit mat karo.
"""
import argparse, datetime as dt, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sign_config  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--exam-url", default="http://localhost:5173/")
ap.add_argument("--api", default="http://localhost:8000")
ap.add_argument("--exit-code", default="dev-exit")
ap.add_argument("--out", default=os.path.join(HERE, "..", "dev.safeexam"))
a = ap.parse_args()

keydir = os.path.join(HERE, "dev-keys"); os.makedirs(keydir, exist_ok=True)
prefix = os.path.join(keydir, "dev")
if not os.path.exists(prefix + ".priv.pem"):
    sign_config.gen_key(prefix)

trusted = os.path.join(HERE, "..", "src", "SafeExam.Client", "Security", "trusted_keys.json")
keys = json.load(open(trusted)) if os.path.exists(trusted) else []
pub = open(prefix + ".pub.pem").read()
keys = [k for k in keys if k["keyId"] != "dev"] + [{"keyId": "dev", "publicKeyPem": pub, "notAfter": None}]
json.dump(keys, open(trusted, "w"), indent=2)

from urllib.parse import urlparse
host = urlparse(a.exam_url).hostname
import base64, hashlib
salt = os.urandom(16)
now = dt.datetime.now(dt.timezone.utc)
iso = lambda t: t.strftime("%Y-%m-%dT%H:%M:%SZ")
payload = {
    "version": 1, "issuedAt": iso(now - dt.timedelta(minutes=1)), "expiresAt": iso(now + dt.timedelta(days=30)),
    "examUrl": a.exam_url, "allowedHosts": [host], "apiBaseUrl": a.api,
    "exitRequiresCode": True, "exitCodeSalt": base64.b64encode(salt).decode(),
    "exitCodeSha256": hashlib.sha256(salt + a.exit_code.encode()).hexdigest(),
    "prohibitedProcesses": ["teamviewer", "anydesk", "discord"],
    "accessibilityAllowedProcesses": ["narrator", "magnify", "nvda", "osk"],
    "allowExternalDisplay": False, "cameraAllowed": False, "microphoneAllowed": False, "minClientVersion": "1.0.0",
}
env = sign_config.sign(prefix + ".priv.pem", "dev", json.dumps(payload).encode())
json.dump(env, open(a.out, "w"), indent=2)
print(f"trusted key 'dev' installed in trusted_keys.json; config written to {os.path.abspath(a.out)}; exit code = {a.exit_code}")
