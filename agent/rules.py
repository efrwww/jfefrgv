from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from decimal import Decimal
from typing import Iterable

from .models import Signal, TransactionAnalysis, TransactionRecord


@dataclass(frozen=True)
class DetectorConfig:
    single_withdrawal_ratio: Decimal = Decimal("0.30")
    cumulative_withdrawal_ratio_24h: Decimal = Decimal("0.50")
    rapid_outflow_ratio_1h: Decimal = Decimal("0.80")
    rapid_outflow_hours: int = 1
    payment_burst_count_1h: int = 5
    confirmation_burst_count_1h: int = 5
    repeated_payment_count_24h: int = 3
    payout_change_window_hours: int = 24
    service_gap_hours: int = 72
    payment_withdrawal_ratio_review: Decimal = Decimal("1.20")


def _in_window(
    records: Iterable[TransactionRecord],
    end: TransactionRecord,
    hours: int,
    tx_types: set[str] | None = None,
) -> list[TransactionRecord]:
    start = end.timestamp - timedelta(hours=hours)
    return [
        record
        for record in records
        if start < record.timestamp <= end.timestamp
        and (tx_types is None or record.tx_type in tx_types)
        and record.merchant_id == end.merchant_id
    ]


def _balance_at(
    records: list[TransactionRecord],
    timestamp,
    merchant_id: str,
    before_block_number: int | None = None,
) -> Decimal:
    balance = Decimal("0")
    for record in records:
        if record.merchant_id != merchant_id:
            continue
        if record.timestamp > timestamp:
            continue
        if record.timestamp == timestamp:
            if before_block_number is None or record.block_number >= before_block_number:
                continue
        if record.status != "success":
            continue
        if record.tx_type in {"member_payment", "refund"}:
            balance += record.amount if record.tx_type == "member_payment" else -record.amount
        elif record.tx_type == "merchant_withdrawal":
            balance -= record.amount
    return max(Decimal("0"), balance)


def _classify(signals: list[Signal]) -> str:
    if any(signal.severity == "high" for signal in signals):
        return "high-risk"
    if any(signal.severity == "review" for signal in signals):
        return "review"
    if signals:
        return "observe"
    return "normal"


class RuleDetector:
    """Deterministic feature and signal generation for every ledger record."""

    def __init__(self, config: DetectorConfig | None = None) -> None:
        self.config = config or DetectorConfig()

    def analyze(self, records: Iterable[TransactionRecord]) -> list[TransactionAnalysis]:
        ordered = sorted(records, key=lambda record: (record.timestamp, record.block_number))
        analyses: list[TransactionAnalysis] = []
        seen_service_ids: set[str] = set()
        current_payout_by_merchant: dict[str, str | None] = {}
        last_service_by_merchant: dict[str, TransactionRecord] = {}

        for record in ordered:
            signals: list[Signal] = []
            metrics: dict[str, object] = {}
            facts = [
                f"{record.tx_type} transaction {record.tx_hash} has amount {record.amount} {record.token}.",
                f"Transaction status is {record.status} at block {record.block_number}.",
            ]

            if record.status != "success":
                signals.append(
                    Signal(
                        "transaction_failed",
                        "review",
                        record.status,
                        "success",
                        "The transaction did not complete successfully.",
                        (record.tx_hash,),
                    )
                )

            if record.tx_type == "member_payment":
                recent_payments = _in_window(ordered, record, 24, {"member_payment"})
                member_payments = [
                    item for item in recent_payments if item.member_id == record.member_id
                ]
                recent_hour = _in_window(ordered, record, 1, {"member_payment"})
                metrics.update(
                    {
                        "payment_count_24h": len(member_payments),
                        "merchant_payment_count_1h": len(recent_hour),
                        "member_payment_total_24h": str(
                            sum((item.amount for item in member_payments), Decimal("0"))
                        ),
                    }
                )
                if len(member_payments) >= self.config.repeated_payment_count_24h:
                    signals.append(
                        Signal(
                            "repeated_member_payments_24h",
                            "observe",
                            len(member_payments),
                            self.config.repeated_payment_count_24h,
                            "The same member made repeated payments in 24 hours.",
                            tuple(item.tx_hash for item in member_payments),
                        )
                    )
                if len(recent_hour) >= self.config.payment_burst_count_1h:
                    signals.append(
                        Signal(
                            "payment_burst_1h",
                            "review",
                            len(recent_hour),
                            self.config.payment_burst_count_1h,
                            "The merchant received an unusual number of payments in one hour.",
                            tuple(item.tx_hash for item in recent_hour),
                        )
                    )
                current_balance = _balance_at(
                    ordered, record.timestamp, record.merchant_id, before_block_number=record.block_number
                )
                metrics["observed_escrow_balance_after"] = str(current_balance + record.amount)

            elif record.tx_type == "service_confirmation":
                recent_confirmations = _in_window(ordered, record, 1, {"service_confirmation"})
                metrics["confirmation_count_1h"] = len(recent_confirmations)
                service_key = record.service_id or record.metadata.get("service_id")
                if service_key and service_key in seen_service_ids:
                    signals.append(
                        Signal(
                            "duplicate_service_attempt",
                            "review",
                            service_key,
                            "unique service id",
                            "The service confirmation identifier was seen before.",
                            tuple(item.tx_hash for item in recent_confirmations),
                        )
                    )
                if service_key:
                    seen_service_ids.add(str(service_key))
                if len(recent_confirmations) >= self.config.confirmation_burst_count_1h:
                    signals.append(
                        Signal(
                            "confirmation_burst_1h",
                            "review",
                            len(recent_confirmations),
                            self.config.confirmation_burst_count_1h,
                            "The merchant confirmed an unusual number of services in one hour.",
                            tuple(item.tx_hash for item in recent_confirmations),
                        )
                    )
                previous = last_service_by_merchant.get(record.merchant_id)
                if previous:
                    gap = (record.timestamp - previous.timestamp).total_seconds() / 3600
                    metrics["service_gap_hours"] = round(gap, 2)
                    if gap >= self.config.service_gap_hours:
                        signals.append(
                            Signal(
                                "service_confirmation_gap",
                                "review",
                                round(gap, 2),
                                self.config.service_gap_hours,
                                "Service confirmations resumed after a long gap.",
                                (previous.tx_hash, record.tx_hash),
                            )
                        )
                last_service_by_merchant[record.merchant_id] = record

            elif record.tx_type == "payout_address_change":
                new_address = str(record.metadata.get("new_address") or record.to_address or "")
                old_address = current_payout_by_merchant.get(record.merchant_id)
                current_payout_by_merchant[record.merchant_id] = new_address
                recent_changes = _in_window(ordered, record, 24, {"payout_address_change"})
                metrics.update(
                    {
                        "old_payout_address": old_address,
                        "new_payout_address": new_address,
                        "address_changes_24h": len(recent_changes),
                    }
                )
                signals.append(
                    Signal(
                        "payout_address_changed",
                        "observe",
                        new_address,
                        "address change event",
                        "The merchant payout address changed and needs contextual review.",
                        (record.tx_hash,),
                    )
                )
                if len(recent_changes) >= 2:
                    signals.append(
                        Signal(
                            "multiple_payout_changes_24h",
                            "review",
                            len(recent_changes),
                            2,
                            "The payout address changed multiple times in 24 hours.",
                            tuple(item.tx_hash for item in recent_changes),
                        )
                    )

            elif record.tx_type == "merchant_withdrawal":
                before_balance = _balance_at(
                    ordered, record.timestamp, record.merchant_id, before_block_number=record.block_number
                )
                recent_withdrawals = _in_window(ordered, record, 24, {"merchant_withdrawal"})
                recent_payments = _in_window(ordered, record, 24, {"member_payment"})
                withdrawal_total = sum((item.amount for item in recent_withdrawals), Decimal("0"))
                payment_total = sum((item.amount for item in recent_payments), Decimal("0"))
                single_ratio = record.amount / before_balance if before_balance else Decimal("0")
                window_start = record.timestamp - timedelta(hours=24)
                start_balance = _balance_at(ordered, window_start, record.merchant_id)
                cumulative_ratio = withdrawal_total / start_balance if start_balance else Decimal("0")
                downstream = [
                    item
                    for item in ordered
                    if item.tx_type == "downstream_transfer"
                    and item.status == "success"
                    and item.from_address.lower() == (record.to_address or "").lower()
                    and record.timestamp < item.timestamp <= record.timestamp + timedelta(hours=self.config.rapid_outflow_hours)
                ]
                downstream_total = sum((item.amount for item in downstream), Decimal("0"))
                outflow_ratio = downstream_total / record.amount if record.amount else Decimal("0")
                recent_change = self._recent_address_change(ordered, record)
                metrics.update(
                    {
                        "observed_escrow_balance_before": str(before_balance),
                        "withdrawal_ratio_to_observed_balance": str(single_ratio),
                        "withdrawal_total_24h": str(withdrawal_total),
                        "withdrawal_cumulative_ratio_24h": str(cumulative_ratio),
                        "payment_total_24h": str(payment_total),
                        "payment_to_withdrawal_ratio_24h": str(
                            payment_total / withdrawal_total if withdrawal_total else Decimal("0")
                        ),
                        "downstream_outflow_1h": str(downstream_total),
                        "downstream_outflow_ratio_1h": str(outflow_ratio),
                        "recent_payout_change_tx": recent_change.tx_hash if recent_change else None,
                    }
                )
                if single_ratio >= self.config.single_withdrawal_ratio:
                    signals.append(
                        Signal(
                            "single_withdrawal_over_30_percent",
                            "review",
                            str(single_ratio),
                            str(self.config.single_withdrawal_ratio),
                            "The withdrawal is large relative to the observed escrow balance.",
                            (record.tx_hash,),
                        )
                    )
                if cumulative_ratio >= self.config.cumulative_withdrawal_ratio_24h:
                    signals.append(
                        Signal(
                            "cumulative_withdrawal_over_50_percent_24h",
                            "high",
                            str(cumulative_ratio),
                            str(self.config.cumulative_withdrawal_ratio_24h),
                            "Cumulative withdrawals are large relative to the 24-hour starting balance.",
                            tuple(item.tx_hash for item in recent_withdrawals),
                        )
                    )
                if outflow_ratio >= self.config.rapid_outflow_ratio_1h:
                    signals.append(
                        Signal(
                            "rapid_downstream_outflow_1h",
                            "high",
                            str(outflow_ratio),
                            str(self.config.rapid_outflow_ratio_1h),
                            "Most of the withdrawal moved downstream within one hour.",
                            tuple([record.tx_hash] + [item.tx_hash for item in downstream]),
                        )
                    )
                if recent_change and recent_change.to_address:
                    minutes = (record.timestamp - recent_change.timestamp).total_seconds() / 60
                    if minutes <= self.config.payout_change_window_hours * 60:
                        signals.append(
                            Signal(
                                "withdrawal_after_payout_address_change",
                                "review",
                                round(minutes, 2),
                                self.config.payout_change_window_hours * 60,
                                "A withdrawal followed a recent payout address change.",
                                (recent_change.tx_hash, record.tx_hash),
                            )
                        )
                if payment_total and record.amount / payment_total >= self.config.payment_withdrawal_ratio_review:
                    signals.append(
                        Signal(
                            "withdrawal_payment_mismatch",
                            "review",
                            str(record.amount / payment_total),
                            str(self.config.payment_withdrawal_ratio_review),
                            "The withdrawal is large compared with recent member payments.",
                            tuple(item.tx_hash for item in recent_payments + recent_withdrawals),
                        )
                    )
                facts.append(
                    f"The observed escrow balance before withdrawal was {before_balance} {record.token}; this is an observation, not a business withdrawal cap."
                )

            elif record.tx_type == "downstream_transfer":
                metrics["source_address"] = record.from_address
                metrics["destination_address"] = record.to_address
                facts.append("This transfer is analyzed as a downstream movement from a previously observed address.")

            analyses.append(
                TransactionAnalysis(
                    transaction=record,
                    signals=tuple(signals),
                    metrics=metrics,
                    classification=_classify(signals),
                    facts=tuple(facts),
                )
            )
        return analyses

    @staticmethod
    def _recent_address_change(
        records: list[TransactionRecord], withdrawal: TransactionRecord
    ) -> TransactionRecord | None:
        changes = [
            record
            for record in records
            if record.merchant_id == withdrawal.merchant_id
            and record.tx_type == "payout_address_change"
            and record.timestamp <= withdrawal.timestamp
        ]
        return max(changes, key=lambda record: record.timestamp) if changes else None


def aggregate_case_score(analyses: Iterable[TransactionAnalysis]) -> int:
    weights = {
        "single_withdrawal_over_30_percent": 25,
        "cumulative_withdrawal_over_50_percent_24h": 30,
        "rapid_downstream_outflow_1h": 30,
        "withdrawal_after_payout_address_change": 20,
        "multiple_payout_changes_24h": 20,
        "payment_burst_1h": 15,
        "confirmation_burst_1h": 15,
        "service_confirmation_gap": 15,
        "withdrawal_payment_mismatch": 20,
        "transaction_failed": 10,
        "duplicate_service_attempt": 20,
        "repeated_member_payments_24h": 10,
    }
    total = sum(
        weights.get(signal.rule_id, 0)
        for analysis in analyses
        for signal in analysis.signals
    )
    return min(100, total)


def classification_for_score(score: int) -> str:
    if score >= 75:
        return "high-risk"
    if score >= 50:
        return "review"
    if score >= 25:
        return "observe"
    return "normal"
