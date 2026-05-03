"""Run Emotional Space AI server with HTTPS (required for tablet camera/mic)."""
import sys
from pathlib import Path

# Add project root
sys.path.insert(0, str(Path(__file__).parent))

from generate_cert import generate

if __name__ == "__main__":
    cert_file, key_file = generate()
    print("\n" + "="*50)
    print("HTTPS Server - Tablet camera/mic will work")
    print("="*50)
    print("\n1. Get your desktop IP: ipconfig | findstr IPv4")
    print("2. On tablet, open: https://<YOUR_IP>:8000")
    print("3. First time: 'Advanced' -> 'Proceed to ... (unsafe)'")
    print("4. Then allow camera & microphone")
    print("="*50 + "\n")

    import uvicorn
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        ssl_keyfile=key_file,
        ssl_certfile=cert_file,
    )
