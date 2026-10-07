from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .deployment import repository_root
from .event_decoder import EventDecoderConfig, RpcEventDecoder
from .rpc_client import JsonRpcClient


def main() -> int:
    root = repository_root()
    parser = argparse.ArgumentParser(description="Decode PrepaidEscrow events from an EVM RPC")
    parser.add_argument("--rpc", default=os.getenv("RPC_URL", "http://127.0.0.1:8545"))
    parser.add_argument("--deployment", type=Path, default=root / "deployments" / "anvil.json")
    parser.add_argument("--from-block", type=int, required=True)
    parser.add_argument("--to-block", default="latest")
    parser.add_argument("--merchant-id", default="gym-001")
    parser.add_argument("--token-symbol", default="DEMO")
    parser.add_argument("--token-decimals", type=int, default=18)
    parser.add_argument("--explorer", default=os.getenv("EXPLORER_BASE_URL", ""))
    args = parser.parse_args()
    rpc = JsonRpcClient(args.rpc)
    chain_id = rpc.chain_id()
    decoder = RpcEventDecoder.from_deployment(
        rpc,
        args.deployment,
        EventDecoderConfig(
            chain_id=chain_id,
            merchant_id=args.merchant_id,
            token_symbol=args.token_symbol,
            token_decimals=args.token_decimals,
            explorer_base_url=args.explorer,
        ),
    )
    records = decoder.fetch_records(args.from_block, args.to_block)
    print(json.dumps([record.to_dict() for record in records], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
