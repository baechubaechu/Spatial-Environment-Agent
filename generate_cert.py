"""Generate self-signed SSL certificate for local HTTPS (camera/mic access on tablet)."""
from pathlib import Path

try:
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
except ImportError:
    print("Installing cryptography...")
    import subprocess
    subprocess.check_call(["pip", "install", "cryptography", "-q"])
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization

import datetime
import socket

CERT_DIR = Path(__file__).parent


def _make_san():
    names = [
        x509.DNSName("localhost"),
        x509.IPAddress(__import__("ipaddress").IPv4Address("127.0.0.1")),
    ]
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        if local_ip and not local_ip.startswith("127."):
            names.append(x509.IPAddress(__import__("ipaddress").IPv4Address(local_ip)))
    except Exception:
        pass
    return x509.SubjectAlternativeName(names)
KEY_FILE = CERT_DIR / "key.pem"
CERT_FILE = CERT_DIR / "cert.pem"


def generate():
    if CERT_FILE.exists() and KEY_FILE.exists():
        print("Certificate already exists.")
        return str(CERT_FILE), str(KEY_FILE)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Emotional Space AI"),
        x509.NameAttribute(NameOID.COMMON_NAME, "localhost"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.utcnow())
        .not_valid_after(datetime.datetime.utcnow() + datetime.timedelta(days=365))
        .add_extension(
            _make_san(),
            critical=False,
        )
    ).sign(key, hashes.SHA256())

    with open(KEY_FILE, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    with open(CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"Generated: {CERT_FILE}, {KEY_FILE}")
    return str(CERT_FILE), str(KEY_FILE)


if __name__ == "__main__":
    generate()
