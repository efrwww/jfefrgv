from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class RpcError(RuntimeError):
    pass


class JsonRpcClient:
    """Small standard-library JSON-RPC adapter for Anvil, Sepolia, or another EVM RPC."""

    def __init__(self, url: str | None = None, timeout: float = 15.0) -> None:
        self.url = url or os.getenv("RPC_URL", "")
        self.timeout = timeout
        self._request_id = 0

    def call(self, method: str, params: list[Any] | None = None) -> Any:
        if not self.url:
            raise RpcError("RPC_URL is not configured")
        self._request_id += 1
        payload = {
            "jsonrpc": "2.0",
            "id": self._request_id,
            "method": method,
            "params": params or [],
        }
        request = Request(
            self.url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json", "User-Agent": "today-chain-agent/0.1"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RpcError(f"RPC request failed: {exc}") from exc
        if body.get("error"):
            raise RpcError(str(body["error"]))
        return body.get("result")

    def chain_id(self) -> int:
        return int(self.call("eth_chainId"), 16)

    def block_number(self) -> int:
        return int(self.call("eth_blockNumber"), 16)

    def transaction_receipt(self, tx_hash: str) -> dict[str, Any] | None:
        return self.call("eth_getTransactionReceipt", [tx_hash])

    def get_logs(self, filter_params: dict[str, Any]) -> list[dict[str, Any]]:
        return self.call("eth_getLogs", [filter_params])

    def health(self) -> dict[str, Any]:
        chain_id = self.chain_id()
        return {"ok": True, "chain_id": chain_id, "block_number": self.block_number(), "rpc_url": self.url}
