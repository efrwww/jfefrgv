from __future__ import annotations

import json
import os
import re
from typing import Any, Mapping, Protocol
from urllib.request import Request, urlopen


class Narrator(Protocol):
    name: str

    def narrate(self, investigation_packet: Mapping[str, Any]) -> dict[str, Any]:
        ...


class NarratorError(RuntimeError):
    pass


class StubNarrator:
    """Deterministic fallback for local smoke runs when no API key is available."""

    name = "stub"

    def narrate(self, investigation_packet: Mapping[str, Any]) -> dict[str, Any]:
        score = int(investigation_packet.get("risk_score", 0))
        classification = str(investigation_packet.get("risk_level", "normal"))
        signals = investigation_packet.get("triggered_signals", [])
        evidence = investigation_packet.get("evidence", [])
        signal_text = "；".join(str(item.get("description", "")) for item in signals)
        summary = (
            f"当前案例风险等级为 {classification}，风险分数为 {score}。"
            f"检测到的主要链上线索：{signal_text or '暂未发现配置规则异常'}"
        )
        return {
            "summary": summary,
            "facts": investigation_packet.get("facts", []),
            "hypotheses": investigation_packet.get("hypotheses", []),
            "unknowns": [
                "演示数据量有限，无法建立可靠的同类商家统计基线。",
                "链上行为不能单独确认商家的线下经营意图。",
            ],
            "recommended_actions": [
                "人工核验商家地址变更原因。",
                "继续观察后续支付、提现和资金流。",
            ],
            "evidence_citations": [item.get("tx_hash") for item in evidence if item.get("tx_hash")],
            "narrator": self.name,
        }


class OpenAICompatibleNarrator:
    """LLM narrative layer. It receives facts only and cannot execute chain actions."""

    name = "openai-compatible"

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        model: str | None = None,
        timeout: float = 60.0,
    ) -> None:
        self.api_key = api_key or os.getenv("OPENAI_API_KEY", "")
        self.base_url = (base_url or os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4o-mini")
        self.timeout = timeout
        if not self.api_key:
            raise NarratorError("OPENAI_API_KEY is required for the OpenAI-compatible narrator")

    def narrate(self, investigation_packet: Mapping[str, Any]) -> dict[str, Any]:
        allowed_hashes = [item.get("tx_hash") for item in investigation_packet.get("evidence", [])]
        system_prompt = """
你是“今天链不练”的以太坊链上异动调查 Agent。你的职责是解释已经由程序和链上查询工具确认的事实。
只使用用户消息中的结构化事实，不补造地址、金额、交易哈希、区块或资金去向。
请区分事实、推断、备选假设和未知信息。不要把异常直接称为跑路、欺诈或违法。
每个证据引用必须使用 allowed_evidence_tx_hashes 中的交易哈希；没有证据时写入 unknowns。
风险分数是调查优先级，不是真实概率。不要发起交易，也不要声称已经冻结、退款或批准资金。
请用中文返回严格 JSON，不要使用 Markdown 代码围栏。
JSON 字段必须是：summary、facts、hypotheses、unknowns、recommended_actions、evidence_citations。
其中 hypotheses 是对象数组，每项包含 name、supporting_evidence、contradicting_evidence、confidence。
""".strip()
        user_payload = {
            "investigation_packet": investigation_packet,
            "allowed_evidence_tx_hashes": allowed_hashes,
        }
        payload = {
            "model": self.model,
            "temperature": 0.1,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False, default=str)},
            ],
        }
        request = Request(
            f"{self.base_url}/chat/completions",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
                "User-Agent": "today-chain-agent/0.1",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # noqa: BLE001 - provider errors are surfaced as one domain error.
            raise NarratorError(f"LLM request failed: {exc}") from exc
        try:
            content = body["choices"][0]["message"]["content"]
            result = self._parse_json(content)
        except (KeyError, IndexError, TypeError, ValueError) as exc:
            raise NarratorError(f"LLM response did not contain valid report JSON: {exc}") from exc
        result["narrator"] = self.name
        result["model"] = self.model
        return result

    @staticmethod
    def _parse_json(content: str) -> dict[str, Any]:
        cleaned = content.strip()
        fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, flags=re.DOTALL | re.IGNORECASE)
        if fenced:
            cleaned = fenced.group(1)
        parsed = json.loads(cleaned)
        if not isinstance(parsed, dict):
            raise ValueError("report root must be an object")
        return parsed


def build_narrator(mode: str = "auto") -> Narrator:
    selected = mode.lower()
    if selected == "stub":
        return StubNarrator()
    if selected in {"openai", "llm"}:
        return OpenAICompatibleNarrator()
    if os.getenv("OPENAI_API_KEY"):
        return OpenAICompatibleNarrator()
    return StubNarrator()
