from __future__ import annotations

from collections import Counter
from datetime import timedelta
from decimal import Decimal
from typing import Any, Iterable

from .models import TransactionRecord


class InvestigationTools:
    """Read-only tools backed by normalized chain records.

    A real RPC adapter can replace this class without changing the agent loop.
    """

    def __init__(self, records: Iterable[TransactionRecord], explorer_base_url: str = "") -> None:
        self.records = sorted(records, key=lambda item: item.timestamp)
        self.by_hash = {item.tx_hash: item for item in self.records}
        self.explorer_base_url = explorer_base_url.rstrip("/")
        self.calls: list[dict[str, Any]] = []

    def _call(self, name: str, **arguments: Any) -> None:
        self.calls.append({"tool": name, "arguments": arguments})

    def get_merchant_state(self, merchant_id: str) -> dict[str, Any]:
        self._call("get_merchant_state", merchant_id=merchant_id)
        merchant_records = [item for item in self.records if item.merchant_id == merchant_id]
        successful = [item for item in merchant_records if item.status == "success"]
        payments = sum((item.amount for item in successful if item.tx_type == "member_payment"), Decimal("0"))
        withdrawals = sum(
            (item.amount for item in successful if item.tx_type == "merchant_withdrawal"), Decimal("0")
        )
        refunds = sum((item.amount for item in successful if item.tx_type == "refund"), Decimal("0"))
        addresses = [
            str(item.metadata.get("new_address") or item.to_address)
            for item in successful
            if item.tx_type == "payout_address_change"
        ]
        return {
            "merchant_id": merchant_id,
            "payment_total": str(payments),
            "withdrawal_total": str(withdrawals),
            "refund_total": str(refunds),
            "observed_balance": str(payments - withdrawals - refunds),
            "payment_count": sum(item.tx_type == "member_payment" for item in successful),
            "withdrawal_count": sum(item.tx_type == "merchant_withdrawal" for item in successful),
            "service_confirmation_count": sum(
                item.tx_type == "service_confirmation" for item in successful
            ),
            "payout_addresses": addresses,
            "last_activity": merchant_records[-1].timestamp.isoformat() if merchant_records else None,
        }

    def get_payment_bill(self, tx_hash_or_invoice_id: str) -> dict[str, Any] | None:
        self._call("get_payment_bill", tx_hash_or_invoice_id=tx_hash_or_invoice_id)
        item = self._find(tx_hash_or_invoice_id, {"member_payment"})
        return item.to_dict() if item else None

    def get_withdrawal_bill(self, tx_hash: str) -> dict[str, Any] | None:
        self._call("get_withdrawal_bill", tx_hash=tx_hash)
        item = self._find(tx_hash, {"merchant_withdrawal"})
        return item.to_dict() if item else None

    def query_events(self, merchant_id: str, event_type: str | None = None) -> list[dict[str, Any]]:
        self._call("query_events", merchant_id=merchant_id, event_type=event_type)
        return [
            item.to_dict()
            for item in self.records
            if item.merchant_id == merchant_id and (event_type is None or item.tx_type == event_type)
        ]

    def trace_transfer(self, tx_hash: str, depth: int = 5) -> dict[str, Any]:
        self._call("trace_transfer", tx_hash=tx_hash, depth=depth)
        root = self.by_hash.get(tx_hash)
        if not root:
            return {"root_tx_hash": tx_hash, "nodes": [], "edges": [], "unknown": True}
        frontier = [root]
        visited = {root.tx_hash}
        edges: list[dict[str, Any]] = []
        nodes: list[dict[str, Any]] = [
            {"address": root.from_address, "role": "source", "tx_hash": root.tx_hash},
            {"address": root.to_address, "role": "destination", "tx_hash": root.tx_hash},
        ]
        for _ in range(max(1, depth)):
            next_frontier: list[TransactionRecord] = []
            for parent in frontier:
                parent_destination = (parent.to_address or "").lower()
                for candidate in self.records:
                    if candidate.tx_hash in visited or candidate.status != "success":
                        continue
                    if candidate.timestamp <= parent.timestamp:
                        continue
                    if candidate.from_address.lower() != parent_destination:
                        continue
                    if candidate.tx_type not in {"downstream_transfer", "merchant_withdrawal"}:
                        continue
                    visited.add(candidate.tx_hash)
                    edges.append(
                        {
                            "from": candidate.from_address,
                            "to": candidate.to_address,
                            "amount": str(candidate.amount),
                            "token": candidate.token,
                            "tx_hash": candidate.tx_hash,
                            "timestamp": candidate.timestamp.isoformat(),
                        }
                    )
                    nodes.extend(
                        [
                            {"address": candidate.from_address, "role": "downstream_source", "tx_hash": candidate.tx_hash},
                            {"address": candidate.to_address, "role": "downstream_destination", "tx_hash": candidate.tx_hash},
                        ]
                    )
                    next_frontier.append(candidate)
            frontier = next_frontier
            if not frontier:
                break
        return {"root_tx_hash": tx_hash, "nodes": nodes, "edges": edges, "unknown": False}

    def inspect_payout_address(self, address: str) -> dict[str, Any]:
        self._call("inspect_payout_address", address=address)
        address_lower = address.lower()
        related = [
            item
            for item in self.records
            if item.from_address.lower() == address_lower or (item.to_address or "").lower() == address_lower
        ]
        inbound = sum((item.amount for item in related if (item.to_address or "").lower() == address_lower), Decimal("0"))
        outbound = sum((item.amount for item in related if item.from_address.lower() == address_lower), Decimal("0"))
        first_seen = min((item.timestamp for item in related), default=None)
        return {
            "address": address,
            "first_seen": first_seen.isoformat() if first_seen else None,
            "transaction_count": len(related),
            "inbound": str(inbound),
            "outbound": str(outbound),
            "known_label": self._address_label(address),
            "related_tx_hashes": [item.tx_hash for item in related],
        }

    def inspect_contract_permissions(self, merchant_id: str) -> dict[str, Any]:
        self._call("inspect_contract_permissions", merchant_id=merchant_id)
        changes = [
            item.to_dict()
            for item in self.records
            if item.merchant_id == merchant_id
            and item.tx_type == "payout_address_change"
        ]
        return {
            "merchant_id": merchant_id,
            "payout_changes": changes,
            "admin_changes": [],
            "proxy_upgrades": [],
            "unknown": True,
        }

    def compare_historical_baseline(self, merchant_id: str, metric: str, window: int = 30) -> dict[str, Any]:
        self._call("compare_historical_baseline", merchant_id=merchant_id, metric=metric, window=window)
        records = [item for item in self.records if item.merchant_id == merchant_id]
        counts = Counter(item.tx_type for item in records)
        return {
            "merchant_id": merchant_id,
            "metric": metric,
            "window_days": window,
            "available_records": len(records),
            "type_counts": dict(counts),
            "baseline_quality": "demo_sample_too_small" if len(records) < 30 else "usable",
            "note": "Historical and peer baselines require more production data than this demo sample.",
        }

    def get_explorer_link(self, chain_id: int, tx_hash: str) -> str:
        self._call("get_explorer_link", chain_id=chain_id, tx_hash=tx_hash)
        if self.explorer_base_url:
            return f"{self.explorer_base_url}/tx/{tx_hash}"
        return f"chain:{chain_id}/tx/{tx_hash}"

    def _find(self, key: str, tx_types: set[str]) -> TransactionRecord | None:
        item = self.by_hash.get(key)
        if item and item.tx_type in tx_types:
            return item
        return next(
            (
                candidate
                for candidate in self.records
                if candidate.tx_type in tx_types
                and (candidate.invoice_id == key or candidate.service_id == key)
            ),
            None,
        )

    @staticmethod
    def _address_label(address: str) -> str | None:
        return None
