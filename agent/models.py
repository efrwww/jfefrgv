from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Mapping


TX_TYPES = {
    "member_payment",
    "service_confirmation",
    "merchant_withdrawal",
    "payout_address_change",
    "refund",
    "downstream_transfer",
}


def parse_timestamp(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def decimal_string(value: Decimal | int | float | str) -> str:
    return format(Decimal(str(value)), "f")


@dataclass(frozen=True)
class TransactionRecord:
    tx_hash: str
    tx_type: str
    timestamp: datetime
    block_number: int
    from_address: str
    to_address: str | None
    amount: Decimal
    token: str
    status: str = "success"
    gas_used: int | None = None
    gas_price_wei: int | None = None
    merchant_id: str = "gym-001"
    member_id: str | None = None
    invoice_id: str | None = None
    service_id: str | None = None
    metadata: Mapping[str, Any] = field(default_factory=dict)
    explorer_url: str | None = None

    def __post_init__(self) -> None:
        if self.tx_type not in TX_TYPES:
            raise ValueError(f"unsupported tx_type: {self.tx_type}")
        if self.amount < 0:
            raise ValueError("amount cannot be negative")

    @classmethod
    def from_dict(cls, raw: Mapping[str, Any]) -> "TransactionRecord":
        return cls(
            tx_hash=str(raw["tx_hash"]),
            tx_type=str(raw["tx_type"]),
            timestamp=parse_timestamp(raw["timestamp"]),
            block_number=int(raw.get("block_number", 0)),
            from_address=str(raw.get("from_address", "")),
            to_address=raw.get("to_address"),
            amount=Decimal(str(raw.get("amount", "0"))),
            token=str(raw.get("token", "DEMO")),
            status=str(raw.get("status", "success")),
            gas_used=int(raw["gas_used"]) if raw.get("gas_used") is not None else None,
            gas_price_wei=(
                int(raw["gas_price_wei"])
                if raw.get("gas_price_wei") is not None
                else None
            ),
            merchant_id=str(raw.get("merchant_id", "gym-001")),
            member_id=raw.get("member_id"),
            invoice_id=raw.get("invoice_id"),
            service_id=raw.get("service_id"),
            metadata=dict(raw.get("metadata", {})),
            explorer_url=raw.get("explorer_url"),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "tx_hash": self.tx_hash,
            "tx_type": self.tx_type,
            "timestamp": self.timestamp.isoformat(),
            "block_number": self.block_number,
            "from_address": self.from_address,
            "to_address": self.to_address,
            "amount": decimal_string(self.amount),
            "token": self.token,
            "status": self.status,
            "gas_used": self.gas_used,
            "gas_price_wei": self.gas_price_wei,
            "gas_cost_wei": self.gas_cost_wei,
            "merchant_id": self.merchant_id,
            "member_id": self.member_id,
            "invoice_id": self.invoice_id,
            "service_id": self.service_id,
            "metadata": dict(self.metadata),
            "explorer_url": self.explorer_url,
        }

    @property
    def gas_cost_wei(self) -> int | None:
        if self.gas_used is None or self.gas_price_wei is None:
            return None
        return self.gas_used * self.gas_price_wei


@dataclass(frozen=True)
class Signal:
    rule_id: str
    severity: str
    value: Any
    threshold: Any
    description: str
    evidence_tx_hashes: tuple[str, ...] = ()

    def to_dict(self) -> dict[str, Any]:
        return {
            "rule_id": self.rule_id,
            "severity": self.severity,
            "value": self.value,
            "threshold": self.threshold,
            "description": self.description,
            "evidence_tx_hashes": list(self.evidence_tx_hashes),
        }


@dataclass(frozen=True)
class TransactionAnalysis:
    transaction: TransactionRecord
    signals: tuple[Signal, ...]
    metrics: Mapping[str, Any]
    classification: str
    facts: tuple[str, ...]

    @property
    def risk_score(self) -> int:
        weights = {"observe": 10, "review": 20, "high": 30}
        return min(100, sum(weights.get(signal.severity, 0) for signal in self.signals))

    def to_dict(self) -> dict[str, Any]:
        return {
            "transaction": self.transaction.to_dict(),
            "signals": [signal.to_dict() for signal in self.signals],
            "metrics": dict(self.metrics),
            "classification": self.classification,
            "risk_score": self.risk_score,
            "facts": list(self.facts),
        }


def as_jsonable(value: Any) -> Any:
    if isinstance(value, Decimal):
        return decimal_string(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if hasattr(value, "to_dict"):
        return value.to_dict()
    if isinstance(value, Mapping):
        return {str(key): as_jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [as_jsonable(item) for item in value]
    return value
