from __future__ import annotations

from collections import OrderedDict
from typing import Any, Iterable

from .models import TransactionAnalysis, TransactionRecord, as_jsonable
from .narrator import Narrator, NarratorError, StubNarrator, build_narrator
from .rules import RuleDetector, aggregate_case_score, classification_for_score
from .tools import InvestigationTools


class InvestigationAgent:
    """Core loop: detect facts, investigate with tools, narrate, then validate citations."""

    def __init__(
        self,
        detector: RuleDetector | None = None,
        narrator: Narrator | None = None,
        explorer_base_url: str = "https://sepolia.etherscan.io",
        chain_id: int = 11155111,
    ) -> None:
        self.detector = detector or RuleDetector()
        self.narrator = narrator or build_narrator()
        self.explorer_base_url = explorer_base_url
        self.chain_id = chain_id

    def run(
        self,
        records: Iterable[TransactionRecord],
        merchant_id: str = "gym-001",
        case_id: str = "case-001",
    ) -> dict[str, Any]:
        merchant_records = [item for item in records if item.merchant_id == merchant_id]
        ordered = sorted(merchant_records, key=lambda item: item.timestamp)
        analyses = self.detector.analyze(ordered)
        tools = InvestigationTools(ordered, explorer_base_url=self.explorer_base_url)
        score = aggregate_case_score(analyses)
        risk_level = classification_for_score(score)
        triggered = [analysis for analysis in analyses if analysis.signals]

        evidence_hashes: list[str] = []
        evidence_reason: dict[str, set[str]] = {}
        flow_traces: list[dict[str, Any]] = []
        facts: list[str] = []

        for analysis in triggered:
            transaction = analysis.transaction
            self._append_unique(evidence_hashes, transaction.tx_hash)
            evidence_reason.setdefault(transaction.tx_hash, set()).update(
                signal.rule_id for signal in analysis.signals
            )
            facts.extend(analysis.facts)
            if transaction.tx_type == "member_payment":
                tools.get_payment_bill(transaction.tx_hash)
            elif transaction.tx_type == "merchant_withdrawal":
                tools.get_withdrawal_bill(transaction.tx_hash)
                flow_traces.append(tools.trace_transfer(transaction.tx_hash, depth=5))
                if transaction.to_address:
                    tools.inspect_payout_address(transaction.to_address)
            elif transaction.tx_type == "payout_address_change":
                address = str(transaction.metadata.get("new_address") or transaction.to_address or "")
                if address:
                    tools.inspect_payout_address(address)
            for signal in analysis.signals:
                for tx_hash in signal.evidence_tx_hashes:
                    if tx_hash in {item.tx_hash for item in ordered}:
                        self._append_unique(evidence_hashes, tx_hash)
                        evidence_reason.setdefault(tx_hash, set()).add(signal.rule_id)

        merchant_state = tools.get_merchant_state(merchant_id)
        baseline = tools.compare_historical_baseline(merchant_id, "payment_withdrawal_service", window=30)
        facts.append(
            f"The investigation contains {len(ordered)} normalized transactions for merchant {merchant_id}."
        )
        facts.append(
            f"Observed payment total is {merchant_state['payment_total']} and observed withdrawal total is {merchant_state['withdrawal_total']} {self._common_token(ordered)}."
        )
        if baseline.get("baseline_quality") == "demo_sample_too_small":
            facts.append("The available sample is too small for a reliable historical or peer baseline.")

        evidence = []
        for tx_hash in evidence_hashes:
            record = next(item for item in ordered if item.tx_hash == tx_hash)
            item = record.to_dict()
            item["evidence_reason"] = sorted(evidence_reason.get(tx_hash, set()))
            item["explorer_url"] = record.explorer_url or tools.get_explorer_link(self.chain_id, tx_hash)
            evidence.append(item)

        hypotheses = self._build_hypotheses(analyses, evidence_hashes)
        triggered_signals = [
            {
                **signal.to_dict(),
                "transaction_hash": analysis.transaction.tx_hash,
                "tx_type": analysis.transaction.tx_type,
            }
            for analysis in triggered
            for signal in analysis.signals
        ]
        packet = {
            "case_id": case_id,
            "merchant_id": merchant_id,
            "chain_id": self.chain_id,
            "risk_score": score,
            "risk_level": risk_level,
            "facts": self._unique(facts),
            "triggered_signals": triggered_signals,
            "evidence": evidence,
            "fund_flow": flow_traces,
            "merchant_state": merchant_state,
            "baseline": baseline,
            "hypotheses": hypotheses,
        }

        narration_error = None
        try:
            narration = self.narrator.narrate(packet)
        except NarratorError as exc:
            narration_error = str(exc)
            narration = StubNarrator().narrate(packet)
            narration["narrator"] = "stub-after-error"

        narration, invalid_citations = self._validate_narration(narration, set(evidence_hashes))
        report = {
            "case_id": case_id,
            "merchant_id": merchant_id,
            "chain_id": self.chain_id,
            "risk_score": score,
            "risk_level": risk_level,
            "confidence": self._confidence(analyses, baseline),
            "facts": self._unique(facts),
            "triggered_rules": triggered_signals,
            "transaction_analyses": [analysis.to_dict() for analysis in analyses],
            "evidence": evidence,
            "fund_flow": flow_traces,
            "hypotheses": hypotheses,
            "unknowns": self._unknowns(baseline, flow_traces),
            "recommended_actions": [
                "继续观察后续会员付款、服务确认和商家提现。",
                "人工核验收款地址变更和资金外流原因。",
            ],
            "narrative": narration,
            "tool_trace": tools.calls,
            "narrator_error": narration_error,
            "invalid_narrator_citations": invalid_citations,
        }
        return as_jsonable(report)

    @staticmethod
    def _append_unique(items: list[str], value: str) -> None:
        if value not in items:
            items.append(value)

    @staticmethod
    def _unique(items: Iterable[str]) -> list[str]:
        return list(OrderedDict.fromkeys(items))

    @staticmethod
    def _common_token(records: list[TransactionRecord]) -> str:
        return records[0].token if records else "DEMO"

    @staticmethod
    def _confidence(analyses: list[TransactionAnalysis], baseline: dict[str, Any]) -> str:
        signal_count = sum(len(analysis.signals) for analysis in analyses)
        if signal_count >= 4 and baseline.get("baseline_quality") == "usable":
            return "high"
        if signal_count >= 2:
            return "medium"
        return "low"

    @staticmethod
    def _unknowns(baseline: dict[str, Any], flow_traces: list[dict[str, Any]]) -> list[str]:
        unknowns = [
            "链上数据不能单独确认商家的线下经营意图或健身房是否实际营业。",
            "演示样本不足时，历史和同类商家基线不具备统计代表性。",
        ]
        if not any(trace.get("edges") for trace in flow_traces):
            unknowns.append("当前数据没有足够的后续转账记录来确认完整资金去向。")
        if baseline.get("baseline_quality") == "demo_sample_too_small":
            unknowns.append("当前案例只能使用配置阈值，不能据此声称模型已经预测跑路概率。")
        return unknowns

    @staticmethod
    def _build_hypotheses(
        analyses: list[TransactionAnalysis], evidence_hashes: list[str]
    ) -> list[dict[str, Any]]:
        rule_ids = {
            signal.rule_id
            for analysis in analyses
            for signal in analysis.signals
        }
        withdrawal_pattern = bool(
            rule_ids
            & {
                "single_withdrawal_over_30_percent",
                "cumulative_withdrawal_over_50_percent_24h",
                "rapid_downstream_outflow_1h",
                "withdrawal_after_payout_address_change",
            }
        )
        hypotheses = [
            {
                "name": "possible_pre_withdrawal_or_liquidity_stress",
                "supporting_evidence": sorted(rule_ids & {
                    "single_withdrawal_over_30_percent",
                    "cumulative_withdrawal_over_50_percent_24h",
                    "rapid_downstream_outflow_1h",
                    "withdrawal_after_payout_address_change",
                    "withdrawal_payment_mismatch",
                }),
                "contradicting_evidence": [],
                "confidence": "medium" if withdrawal_pattern else "low",
                "evidence_tx_hashes": evidence_hashes,
            },
            {
                "name": "normal_batch_operation_or_wallet_migration",
                "supporting_evidence": sorted(rule_ids & {
                    "payment_burst_1h",
                    "confirmation_burst_1h",
                    "payout_address_changed",
                }),
                "contradicting_evidence": sorted(rule_ids & {
                    "rapid_downstream_outflow_1h",
                    "multiple_payout_changes_24h",
                }),
                "confidence": "low" if withdrawal_pattern else "medium",
                "evidence_tx_hashes": evidence_hashes,
            },
            {
                "name": "wallet_compromise_or_uncontrolled_access",
                "supporting_evidence": sorted(rule_ids & {
                    "payout_address_changed",
                    "multiple_payout_changes_24h",
                    "rapid_downstream_outflow_1h",
                }),
                "contradicting_evidence": [],
                "confidence": "low",
                "evidence_tx_hashes": evidence_hashes,
            },
        ]
        return hypotheses

    @staticmethod
    def _validate_narration(
        narration: dict[str, Any], known_hashes: set[str]
    ) -> tuple[dict[str, Any], list[str]]:
        citations = narration.get("evidence_citations", [])
        if not isinstance(citations, list):
            citations = []
        valid = [item for item in citations if item in known_hashes]
        invalid = [item for item in citations if item not in known_hashes]
        narration["evidence_citations"] = valid
        if invalid:
            narration["unverified_citations_removed"] = invalid
        return narration, invalid
