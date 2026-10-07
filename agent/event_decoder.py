from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable, Mapping

from .models import TransactionRecord
from .rpc_client import JsonRpcClient


# Keccak-256 topics generated from the canonical event signatures in
# contracts/PrepaidEscrow.sol. Python's hashlib.sha3_256 is not Ethereum Keccak.
EVENT_TOPICS = {
    "0x8b5e8e688b55a25c8ada4a46e2317b16572b97277f5d8d8b6c6d4d31da1eb690": "MemberPayment",
    "0xa6f5d7f80d8c61b727087014b554c3895fd8efa76d200dbf90864964c6baa4e5": "ServiceConfirmed",
    "0xd69e545ee207107085b6ed37f17ea20fa88c471a35f26750add12cbcb44d0086": "MerchantWithdrawal",
    "0x6706020a65600b3496005cfd282dbbd692a827197e34c20e4a0fc2fa21d3eff2": "RefundRequested",
    "0x8c34d48cd0c843083ac888bb6f1ee0429ff1f71068f66b6243162c97da4ebc66": "PayoutAddressProposed",
    "0x5de55c56e7a6424bae9765fc1c756327e97ea310f08f9a18eeb4690c92398dd6": "PayoutAddressActivated",
}


@dataclass(frozen=True)
class EventDecoderConfig:
    chain_id: int = 31337
    merchant_id: str = "gym-001"
    token_symbol: str = "DEMO"
    token_decimals: int = 18
    explorer_base_url: str = ""


def _word(value: str) -> int:
    return int(value[2:] if value.startswith("0x") else value, 16)


def _address(topic: str) -> str:
    value = topic[2:] if topic.startswith("0x") else topic
    return "0x" + value[-40:]


def _data_words(data: str) -> list[int]:
    value = data[2:] if data.startswith("0x") else data
    if not value:
        return []
    if len(value) % 64:
        raise ValueError(f"event data is not word-aligned: {data}")
    return [int(value[index : index + 64], 16) for index in range(0, len(value), 64)]


def _timestamp(block: Mapping[str, Any]) -> datetime:
    return datetime.fromtimestamp(_word(str(block["timestamp"])), tz=timezone.utc)


class RpcEventDecoder:
    """Decode PrepaidEscrow logs into the agent's normalized ledger records."""

    def __init__(
        self,
        rpc: JsonRpcClient,
        escrow_address: str,
        config: EventDecoderConfig | None = None,
        abi_event_names: frozenset[str] | None = None,
    ) -> None:
        self.rpc = rpc
        self.escrow_address = escrow_address
        self.config = config or EventDecoderConfig()
        self.abi_event_names = abi_event_names
        self._block_cache: dict[int, dict[str, Any]] = {}

    @classmethod
    def from_deployment(
        cls,
        rpc: JsonRpcClient,
        deployment_path: str | Path,
        config: EventDecoderConfig | None = None,
    ) -> "RpcEventDecoder":
        deployment = json.loads(Path(deployment_path).read_text(encoding="utf-8"))
        escrow_address = deployment["contracts"]["PrepaidEscrow"]["address"]
        deployment_file = Path(deployment_path)
        abi_path = deployment_file.parent.parent / deployment["contracts"]["PrepaidEscrow"]["abi"]
        abi_event_names: frozenset[str] | None = None
        if abi_path.exists():
            abi = json.loads(abi_path.read_text(encoding="utf-8"))
            abi_event_names = frozenset(
                item["name"]
                for item in abi
                if item.get("type") == "event" and item.get("name")
            )
        return cls(rpc, escrow_address, config=config, abi_event_names=abi_event_names)

    def fetch_records(
        self,
        from_block: int,
        to_block: int | str = "latest",
        include_unknown: bool = False,
    ) -> list[TransactionRecord]:
        topics = list(EVENT_TOPICS.keys())
        logs = self.rpc.get_logs(
            {
                "address": self.escrow_address,
                "fromBlock": hex(from_block),
                "toBlock": to_block if isinstance(to_block, str) else hex(to_block),
                "topics": [topics],
            }
        )
        records: list[TransactionRecord] = []
        for log in logs:
            try:
                record = self.decode_log(log)
            except (KeyError, IndexError, ValueError) as exc:
                if include_unknown:
                    raise ValueError(f"could not decode log {log}: {exc}") from exc
                continue
            if record is not None:
                records.append(record)
        return sorted(records, key=lambda item: (item.block_number, item.tx_hash))

    def decode_log(self, log: Mapping[str, Any]) -> TransactionRecord | None:
        topics = [str(item).lower() for item in log.get("topics", [])]
        if not topics:
            return None
        event_name = EVENT_TOPICS.get(topics[0])
        if not event_name:
            return None
        if self.abi_event_names is not None and event_name not in self.abi_event_names:
            return None
        tx_hash = str(log["transactionHash"])
        block_number = _word(str(log["blockNumber"]))
        block = self._get_block(block_number)
        tx = self.rpc.transaction(tx_hash) or {}
        receipt = self.rpc.transaction_receipt(tx_hash) or {}
        tx_from = str(tx.get("from") or "")
        tx_to = str(tx.get("to") or self.escrow_address)
        status = "success" if _word(str(receipt.get("status", "0x1"))) == 1 else "failed"
        gas_used = _word(str(receipt["gasUsed"])) if receipt.get("gasUsed") else None
        gas_price = None
        if receipt.get("effectiveGasPrice"):
            gas_price = _word(str(receipt["effectiveGasPrice"]))
        elif tx.get("gasPrice"):
            gas_price = _word(str(tx["gasPrice"]))
        data = _data_words(str(log.get("data", "0x")))
        args = topics[1:]
        timestamp = _timestamp(block)
        explorer_url = (
            f"{self.config.explorer_base_url.rstrip('/')}/tx/{tx_hash}"
            if self.config.explorer_base_url
            else None
        )
        common = {
            "tx_hash": tx_hash,
            "timestamp": timestamp,
            "block_number": block_number,
            "from_address": tx_from,
            "status": status,
            "gas_used": gas_used,
            "gas_price_wei": gas_price,
            "merchant_id": self.config.merchant_id,
            "token": self.config.token_symbol,
            "explorer_url": explorer_url,
        }

        if event_name == "MemberPayment":
            invoice_id = _word(args[0])
            member = _address(args[1])
            token_address = _address(args[2])
            amount = self._scale(data[0])
            return TransactionRecord(
                **common,
                tx_type="member_payment",
                to_address=tx_to,
                amount=amount,
                member_id=member,
                invoice_id=str(invoice_id),
                metadata={"token_address": token_address, "contract_address": self.escrow_address},
            )

        if event_name == "ServiceConfirmed":
            service_id = _word(args[0])
            invoice_id = _word(args[1])
            member = _address(args[2])
            amount = self._scale(data[0])
            return TransactionRecord(
                **common,
                tx_type="service_confirmation",
                to_address=tx_to,
                amount=amount,
                member_id=member,
                invoice_id=str(invoice_id),
                service_id=str(service_id),
                metadata={"contract_address": self.escrow_address},
            )

        if event_name == "MerchantWithdrawal":
            merchant = _address(args[0])
            payout = _address(args[1])
            amount = self._scale(data[0])
            observed = self._scale(data[1])
            withdrawal_common = dict(common)
            withdrawal_common.pop("from_address", None)
            return TransactionRecord(
                **withdrawal_common,
                tx_type="merchant_withdrawal",
                from_address=merchant,
                to_address=payout,
                amount=amount,
                metadata={
                    "observed_balance_before": str(observed),
                    "contract_address": self.escrow_address,
                    "transaction_to": tx_to,
                },
            )

        if event_name == "RefundRequested":
            invoice_id = _word(args[0])
            member = _address(args[1])
            amount = self._scale(data[0])
            return TransactionRecord(
                **common,
                tx_type="refund",
                to_address=member,
                amount=amount,
                member_id=member,
                invoice_id=str(invoice_id),
                metadata={"contract_address": self.escrow_address, "transaction_to": tx_to},
            )

        if event_name in {"PayoutAddressProposed", "PayoutAddressActivated"}:
            old_address = _address(args[0])
            new_address = _address(args[1])
            activation_time = _word(data[0]) if event_name == "PayoutAddressProposed" and data else None
            return TransactionRecord(
                **common,
                tx_type="payout_address_change",
                to_address=new_address,
                amount=Decimal("0"),
                metadata={
                    "old_address": old_address,
                    "new_address": new_address,
                    "activation_time": activation_time,
                    "event_name": event_name,
                    "contract_address": self.escrow_address,
                },
            )
        return None

    def _get_block(self, block_number: int) -> dict[str, Any]:
        if block_number not in self._block_cache:
            block = self.rpc.block(block_number)
            if not block:
                raise ValueError(f"block {block_number} not found")
            self._block_cache[block_number] = block
        return self._block_cache[block_number]

    def _scale(self, raw_value: int) -> Decimal:
        return Decimal(raw_value) / (Decimal(10) ** self.config.token_decimals)
