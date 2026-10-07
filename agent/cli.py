from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

from .models import TransactionRecord
from .narrator import build_narrator
from .orchestrator import InvestigationAgent


def load_records(path: Path) -> list[TransactionRecord]:
    raw: Any = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, dict):
        raw = raw.get("transactions", [])
    if not isinstance(raw, list):
        raise ValueError("input JSON must be a list or an object with transactions")
    return [TransactionRecord.from_dict(item) for item in raw]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Today Chain Not Train investigation agent")
    parser.add_argument("--input", type=Path, default=Path("data/sample_case.json"))
    parser.add_argument("--merchant", default="gym-001")
    parser.add_argument("--case-id", default="case-demo-001")
    parser.add_argument("--narrator", choices=["auto", "openai", "stub"], default="auto")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--explorer", default=os.getenv("EXPLORER_BASE_URL", "https://sepolia.etherscan.io"))
    parser.add_argument("--chain-id", type=int, default=int(os.getenv("CHAIN_ID", "11155111")))
    return parser


def main() -> int:
    args = build_parser().parse_args()
    records = load_records(args.input)
    agent = InvestigationAgent(
        narrator=build_narrator(args.narrator),
        explorer_base_url=args.explorer,
        chain_id=args.chain_id,
    )
    report = agent.run(records, merchant_id=args.merchant, case_id=args.case_id)
    rendered = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered + "\n", encoding="utf-8")
    else:
        print(rendered)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
