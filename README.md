# 今天链不练 Agent MVP

这是“今天链不练”的 Agent 核心循环原型，面向 GCC 公共物品赛题二：以太坊链上异动调查 Agent。

本版本只做调查层：会员支付和商家提现保持金额自由，检测规则只产生调查标签，不阻止交易。当前输入是已经标准化的链上账单 JSON，后续可接 Anvil、Sepolia RPC 或合约事件索引器。

## 核心循环

```text
读取逐笔账单
→ 计算确定性指标和规则信号
→ 调用只读调查工具
→ 追踪提现后的资金流
→ 比较历史行为
→ 生成备选假设
→ 调用带 Key 的模型生成中文调查解释
→ 校验模型引用的交易哈希
→ 输出结构化报告
```

## 运行

```powershell
cd C:\Users\28176\jfefrgv
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 无模型 Key 的本地烟雾运行

```powershell
python -m agent.cli --narrator stub --output data/report.stub.json
```

### 使用 OpenAI-compatible API

不要把 Key 写入代码或提交到 Git。当前 PowerShell 会话中设置：

```powershell
$env:OPENAI_API_KEY="你的 Key"
$env:OPENAI_BASE_URL="https://api.openai.com/v1"
$env:OPENAI_MODEL="gpt-4o-mini"
python -m agent.cli --narrator openai --output data/report.llm.json
```

也可以使用兼容 OpenAI Chat Completions 的其他服务，只需替换 `OPENAI_BASE_URL` 和 `OPENAI_MODEL`。

## RPC 接入准备

核心循环不依赖 RPC，可以先使用 `data/sample_case.json` 验证流程。项目已经提供 `agent/rpc_client.py`，支持：

```text
eth_chainId
eth_blockNumber
eth_getTransactionReceipt
eth_getLogs
```

设置 `RPC_URL` 后，可以先检查节点：

```powershell
python -c "from agent.rpc_client import JsonRpcClient; print(JsonRpcClient().health())"
```

下一步是把合约事件 ABI 解码为 `TransactionRecord`，保持检测器和调查 Agent 不变。

## 合约 ABI 和 Anvil 部署

仓库现在包含最小自由金额托管合约：

```text
contracts/PrepaidEscrow.sol
contracts/DemoToken.sol
abi/PrepaidEscrow.json
abi/DemoToken.json
deployments/anvil.json
```

启动 Anvil 并部署：

```powershell
npm install --ignore-scripts
npm run compile:contracts
npx --no-install anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --accounts 10
npm run deploy:anvil
```

当前 Anvil 部署：

```text
DemoToken:     0x5FbDB2315678afecb367f032d93F642f64180aa3
PrepaidEscrow: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
merchant:      0x70997970C51812dc3A010C7d01b50e0d17dc79C8
payout:        0x90F79bf6EB2c4f870365E785982E1f101E93b906
```

这些地址属于当前 Anvil 会话。Anvil 重启后状态和部署地址会变化，Agent 或其他服务应读取 `deployments/anvil.json`，不要把地址硬编码到业务逻辑中。

合约允许会员支付任意正数金额、商家在实际托管余额内提现任意金额。30%、50% 和 80% 等阈值只由 Python 检测器生成调查信号，不会让合约回滚合法交易。

## 目录

```text
agent/models.py          账单、信号、分析结果数据结构
agent/rules.py           逐笔检测和时间窗口规则
agent/tools.py           只读调查工具和资金流追踪
agent/narrator.py        OpenAI-compatible 报告生成器
agent/orchestrator.py    Agent 核心循环和证据校验
agent/rpc_client.py      Anvil/Sepolia JSON-RPC 适配器
agent/cli.py             命令行入口
data/sample_case.json    可复现异动调查案例
contracts/                Solidity 合约源代码
scripts/                  编译和 Anvil 部署脚本
deployments/anvil.json    当前本地部署地址
```

## 证据安全规则

- 模型只能看到结构化事实和工具返回结果。
- 模型引用的交易哈希必须存在于已知账单中。
- 未知资金去向必须写入 `unknowns`，不得由模型补造。
- 风险分数表示调查优先级，不是真实概率。
- Agent 没有发送交易、批准提现或冻结资金的工具。
