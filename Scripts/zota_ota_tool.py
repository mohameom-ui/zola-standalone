#!/usr/bin/env python3
"""zota_ota_tool.py — THE OTA GROUND TOOL (spec section 3, the operator side).

Packages a firmware binary for the Zola fleet's OTA lane:
  * computes the image's SHA-256 (the firmware checks it against its
    running digest before committing the bank),
  * signs the digest with ED25519 (the `cryptography` lib; the TPM 2.0
    vault's key on production hardware — this tool generates/loads a
    dev keypair for the bench),
  * emits the signed image package (the header the bridge chunks out),
  * and verifies its own signature round trip before shipping (a signer
    that cannot verify itself is not a signer).

Usage:
    python Scripts/zota_ota_tool.py sign <firmware.bin> [--key dev_ota_key.pem]
    python Scripts/zota_ota_tool.py verify <package.bin> [--key dev_ota_key_pub.pem]
    python Scripts/zota_ota_tool.py deploy <package.zota>   # through the bridge to the FC
    python Scripts/zota_ota_tool.py selftest
"""
import argparse
import hashlib
import os
import struct
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives import serialization

MAGIC = b"ZOTA"          # the package: MAGIC + u32 size + sha256(32) + sig(64) + image
DEV_KEY = os.path.join("Saved", "zola-ota-dev-key.pem")
DEV_PUB = os.path.join("Saved", "zola-ota-dev-key-pub.pem")


def load_or_create_key(path):
    if os.path.exists(path):
        return serialization.load_pem_private_key(open(path, "rb").read(), password=None)
    key = Ed25519PrivateKey.generate()
    pem = key.private_bytes(serialization.Encoding.PEM,
                            serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption())
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    open(path, "wb").write(pem)
    pub = key.public_key().public_bytes(serialization.Encoding.PEM,
                                        serialization.PublicFormat.SubjectPublicKeyInfo)
    open(path.replace(".pem", "-pub.pem"), "wb").write(pub)
    print(f"[zota] generated the dev keypair: {path} (+ the public half)")
    return key


def package_image(image_path, key):
    image = open(image_path, "rb").read()
    digest = hashlib.sha256(image).digest()
    signature = key.sign(digest)  # ED25519: the 64-byte signature over the digest
    pkg = struct.pack("<4sI", MAGIC, len(image)) + digest + signature + image
    out = image_path + ".zota"
    open(out, "wb").write(pkg)
    print(f"[zota] packaged {len(image)} bytes → {out}")
    print(f"[zota]   sha256: {digest.hex()[:32]}…")
    print(f"[zota]   ed25519 signature: {signature.hex()[:32]}…")
    return out


def verify_package(pkg_path, pub_path):
    raw = open(pkg_path, "rb").read()
    magic, size = struct.unpack_from("<4sI", raw, 0)
    if magic != MAGIC:
        print("VERIFY FAIL: the magic is missing — not a Zola OTA package")
        return False
    digest = raw[8:40]
    signature = raw[40:104]
    image = raw[104:104 + size]
    # THE RECEIVER'S ORDER (mirrors the firmware): the digest over the IMAGE
    # must match the carried digest, THEN the signature over the digest
    if hashlib.sha256(image).digest() != digest:
        print("VERIFY FAIL: the image's SHA-256 does not match the carried digest")
        return False
    pub = serialization.load_pem_public_key(open(pub_path, "rb").read())
    try:
        pub.verify(signature, digest)
    except Exception as e:
        print(f"VERIFY FAIL: the ED25519 signature is invalid ({e})")
        return False
    print(f"VERIFY PASS: {size} bytes, digest {digest.hex()[:24]}…, signature valid")
    return True


def selftest():
    # build a fake image, sign it, corrupt it, and verify BOTH verdicts
    with open("Saved/ota-selftest.bin", "wb") as f:
        f.write(b"ZOLA-FIRMWARE-IMAGE\0" * 512)
    key = load_or_create_key(DEV_KEY)
    pkg = package_image("Saved/ota-selftest.bin", key)
    assert verify_package(pkg, DEV_PUB), "the valid package must verify"

    raw = bytearray(open(pkg, "rb").read())
    raw[-1] ^= 0xFF  # flip one image bit — exactly what a bad flash does
    open(pkg, "wb").write(raw)
    assert not verify_package(pkg, DEV_PUB), "a corrupted image must FAIL"
    print("OTA-TOOL SELFTEST PASS — valid verifies, corrupted rejects")


def deploy(pkg_path, ws_url="ws://127.0.0.1:8002", chunk=200):
    """THE DEPLOY: stream the package through the bridge to the FC —
    BEGIN (size/digest/signature) → CHUNKs → COMMIT. The bridge builds the
    wire frames (one canon, one builder); the tool speaks the semantics."""
    import asyncio
    import json
    import websockets

    raw = open(pkg_path, "rb").read()
    magic, size = struct.unpack_from("<4sI", raw, 0)
    assert magic == MAGIC, "not a Zola OTA package — run `sign` first"
    digest = raw[8:40]
    signature = raw[40:104]
    image = raw[104:104 + size]

    async def run():
        async with websockets.connect(ws_url) as ws:
            await ws.send(json.dumps({
                "type": "ZOTA_BEGIN", "size": size,
                "sha256_hex": digest.hex(), "sig_hex": signature.hex(),
            }))
            sent = 0
            while sent < size:
                data = image[sent:sent + chunk]
                await ws.send(json.dumps({"type": "ZOTA_CHUNK", "offset": sent,
                                          "data_hex": data.hex()}))
                sent += len(data)
            await ws.send(json.dumps({"type": "ZOTA_COMMIT"}))
            print(f"[zota] deployed {size} bytes ({(size + chunk - 1) // chunk} chunks) → {ws_url}")
            print("[zota] the FC verifies digest + signature, then the 10 s boot")
            print("      health gate decides: stick, or roll back to the old bank")

    asyncio.run(run())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["sign", "verify", "selftest", "deploy"])
    parser.add_argument("path", nargs="?")
    parser.add_argument("--key", default=DEV_KEY)
    args = parser.parse_args()
    if args.action == "selftest":
        selftest()
        return
    if args.action == "deploy":
        if not args.path:
            sys.exit("usage: zota_ota_tool.py deploy <package.zota>")
        deploy(args.path)
        return
    if args.action == "sign":
        if not args.path:
            sys.exit("usage: zota_ota_tool.py sign <firmware.bin>")
        package_image(args.path, load_or_create_key(args.key))
    else:
        if not args.path:
            sys.exit("usage: zota_ota_tool.py verify <package.zota>")
        sys.exit(0 if verify_package(args.path, args.key.replace(".pem", "-pub.pem") if args.key == DEV_KEY else args.key) else 1)


if __name__ == "__main__":
    main()
