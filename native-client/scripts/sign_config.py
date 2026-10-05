#!/usr/bin/env python3
"""SafeExam config signer (C-17). Private key SIRF yahin / signing machine par rahti hai.

Usage:
  python sign_config.py --gen-key keys/k1                        # keys/k1.priv.pem + keys/k1.pub.pem
  python sign_config.py --key keys/k1.priv.pem --key-id k1 --in payload.json --out exam.safeexam
  python sign_config.py --hash-exit-code "mycode"                # -> salt + sha256 for payload (exitCodeSalt / exitCodeSha256)

Signature format = ECDSA P-256 / SHA-256, IEEE P1363 (r||s, 64 bytes) - same as the .NET client expects.
Requires: pip install cryptography
"""
import argparse, base64, hashlib, json, os, sys
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature


def b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def gen_key(prefix: str) -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    os.makedirs(os.path.dirname(prefix) or ".", exist_ok=True)
    with open(prefix + ".priv.pem", "wb") as f:
        f.write(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    pub = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    with open(prefix + ".pub.pem", "wb") as f:
        f.write(pub)
    print(f"wrote {prefix}.priv.pem (KEEP SECRET) and {prefix}.pub.pem (add to trusted_keys.json)")


def sign(key_path: str, key_id: str, payload_bytes: bytes) -> dict:
    with open(key_path, "rb") as f:
        key = serialization.load_pem_private_key(f.read(), password=None)
    der = key.sign(payload_bytes, ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    sig = r.to_bytes(32, "big") + s.to_bytes(32, "big")
    return {"keyId": key_id, "payload": b64url(payload_bytes), "signature": b64url(sig)}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gen-key")
    ap.add_argument("--key"); ap.add_argument("--key-id"); ap.add_argument("--in", dest="inp"); ap.add_argument("--out")
    ap.add_argument("--hash-exit-code")
    a = ap.parse_args()
    if a.gen_key:
        gen_key(a.gen_key); return 0
    if a.hash_exit_code is not None:
        salt = os.urandom(16)
        digest = hashlib.sha256(salt + a.hash_exit_code.encode()).hexdigest()
        print(json.dumps({"exitCodeSalt": base64.b64encode(salt).decode(), "exitCodeSha256": digest}, indent=2)); return 0
    if not (a.key and a.key_id and a.inp and a.out):
        ap.error("need --key --key-id --in --out")
    with open(a.inp, "rb") as f:
        raw = f.read()
    json.loads(raw)  # payload valid JSON ho
    env = sign(a.key, a.key_id, raw)
    with open(a.out, "w") as f:
        json.dump(env, f, indent=2)
    print("wrote", a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
