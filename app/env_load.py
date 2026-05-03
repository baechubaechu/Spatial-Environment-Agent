"""Load `.env.local` / `.env` from exhibition-agent paths so FastAPI shares config with embedded Next.js web."""
from __future__ import annotations

from pathlib import Path


def load_repo_env() -> None:
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    # app -> exhibition-agent -> exhibition-suite (루트)
    suite = Path(__file__).resolve().parent.parent.parent
    agent_root = suite / "exhibition-agent"
    for folder in (agent_root / "web", agent_root):
        load_dotenv(folder / ".env.local")
        load_dotenv(folder / ".env")
