from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def repository_root() -> Path:
    return Path(__file__).resolve().parents[1]


def load_deployment(path: str | Path | None = None) -> dict[str, Any]:
    deployment_path = Path(path) if path else repository_root() / "deployments" / "anvil.json"
    return json.loads(deployment_path.read_text(encoding="utf-8"))


def load_contract_spec(contract_name: str, path: str | Path | None = None) -> dict[str, Any]:
    deployment = load_deployment(path)
    spec = deployment["contracts"][contract_name]
    abi_path = repository_root() / spec["abi"]
    return {**spec, "abi_json": json.loads(abi_path.read_text(encoding="utf-8"))}
