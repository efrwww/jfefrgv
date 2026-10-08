# 今天链不练

健身预付消费的以太坊资金异动调查原型。本项目目前持续开发、验收中，**不是已完成全部公开链验收的交付版本**。

三层职责：网站负责操作与核查；智能合约执行充值、会员确认结算、退款和已结算额度提现；只读调查 Agent 调用量化与链上工具，生成引用证据的报告。GYM 是固定演示额度，无人民币兑换、升值或交易市场。

日常入口已改为顶部横向导航与右上角会员/商家身份菜单。[会员首页](http://127.0.0.1:5173/consumer) 展示额度与待办；商家首页优先展示收款结算；充值、退款、提现在弹窗完成。[AI 助手](http://127.0.0.1:5173/assistant) 独立双栏，真实问题关联当前健身房、账户和身份，展示工具进度、报告和证据。研究案例与技术原稿放在账号菜单的开发区，不要求普通用户选数据集。切换视图不是权限认证；本地演示才自动切换测试账号。

用户已明确授权新异常记录发送给 DeepSeek 后启用后台自动调查；许可位于 `data/runtime-settings.json`，无许可默认关闭。去重与五分钟冷却避免轮询重复调用。新版布局实际验收见 [布局改版验收](./artifacts/acceptance/布局改版验收.md)，之前的 [日常界面简化验收](./artifacts/acceptance/日常界面简化验收.md) 保留为历史记录。

最新三项收尾已完成：四份演示报告的针对性解释复核、关键失败保护、独立本地启动/重启及交接。直接运行和演示见 [快速启动与演示](./快速启动与演示.md)，范围与实际结果见 [三项收尾验收](./artifacts/acceptance/三项收尾验收.md)。Sepolia 和独立第二 Agent 本轮不做，原完整 P0 不标完成。

## Vercel 在线 Demo

仓库包含一个可直接发布到 Vercel 的只读展示模式。它通过 `api/research.ts` 展示已保存的公开以太坊 USDC 调查案例，通过 `api/flow/[...path].ts` 展示会员付款、商家收款和 Agent 取证界面。在线模式不连接本机 Anvil、不保存 SQLite、不持有私钥，也不执行付款签名；页面会明确显示“Vercel 只读演示”。完整 RPC 索引、合约交互和本地签名流程仍按下方本地运行说明执行。

```sh
npm ci
npm run build
vercel --prod
```

## BOT Chain 测试网

当前可核验的 BOT Chain Test 网络为 Chain ID `968`，RPC 为 `https://rpc.bohr.life`，区块浏览器为 [scan.bohr.life](https://scan.bohr.life/)。`npm run deploy:botchain` 只做预检；确认余额后运行 `npm run deploy:botchain:execute` 才会发送交易。部署账户只保存在被忽略的 `.runtime/botchain-wallet.json`，不会写入 GitHub。脚本会部署 `GymToken` 和 `GymEscrow`，然后执行一笔会员充值、一次消费确认和一笔商家提现，最后生成 `artifacts/acceptance/botchain-deployment-proof.json`，其中包含每笔交易的区块浏览器链接。若使用旧的 677 RPC，可显式设置 `BOTCHAIN_CHAIN_ID=677`、`BOTCHAIN_RPC_URL=https://rpc.botchain.ai` 和对应浏览器地址。

Chain ID `677` 的主网部署支持显式签名账户：将 `BOTCHAIN_DEPLOYER_PRIVATE_KEY` 放入服务器密钥管理器，并设置 `BOTCHAIN_DEPLOYER_ADDRESS=0x295DF8b1d573c8332170d03437ddaf36411a29eb`。执行前脚本会校验 RPC Chain ID、签名地址和余额；地址或网络不匹配时不会发送交易。私钥不能写入仓库、聊天或前端环境变量。

当前官方页面同时将 Faucet 标为测试网、扫描器环境标为非测试网；在没有单独的 BOT Chain 主网 RPC/Chain ID 说明前，项目不会把测试 Faucet 资金或测试交易宣称为主网资产。提供独立主网 RPC 后，再新增主网部署清单。

## 本地运行

已安装依赖时可运行 `npm run doctor` 检查环境，`npm run start` 一键启动，`npm run services:status` 查看归属，`npm run stop` 停止本次由启动器创建的服务。已在其他终端运行的匹配服务会复用，不会被 stop 关闭。

Hardhat 本地链在节点退出后不会保留状态。一键启动发现旧部署与新节点不一致时会拒绝继续；显式运行 `npm run start -- --renew-local` 才会把失效的本地清单移动到 `data/archive/`、将旧报告标为 stale 并部署新的本地演示合约。历史数据库、证据和公开链清单不删除。此选项只作用于启动器自己新建的本地节点，不重置或接管外部节点；重新启动后旧本地交易不能作为新链实例证据。

使用受支持的偶数版本 Node.js（当前验证环境为 26.7.0），在本目录执行：

```sh
npm ci
npm run chain
```

另开终端，仍在本目录执行：

```sh
npm run compile
npm run deploy:local
npm run server
```

第三个终端执行：

```sh
npm run dev
```

访问 http://127.0.0.1:5173 。本地测试账号仅连接 chainId 31337 的本地节点，不是个人钱包。节点只监听本机，不要公开暴露解锁账户的 RPC。

服务端优先读取本目录 `.env.local`，否则读取上级目录的 `.env.local`。使用上级 `.env.example` 的字段配置 DeepSeek；不要把密钥放进 `web/`、报告或代码仓库。模型状态分为“已配置”和“实际可用”：当模型未配置、账户欠费或接口失败时，调查仍会运行确定性规则报告，明确标记为 `rule-only`，不会把规则结果伪装成 AI 解释；模型恢复后可重新运行双 Agent 调查。

## 验收与案例

### 后续迭代节奏（按用户要求加速）

常规修改仅验证直接受影响的路径：页面改动做构建与对应页面检查；分析逻辑改动跑相关单元测试；API 改动核对对应接口。无需重复运行整套验收，也不重新生成未受影响的模型报告。只有修改合约或本地链回滚/索引机制时才进行相关 EVM 回滚测试；最终交付前统一验收一次。`--contracts` 是显式选项，不作为日常默认检查。保留原完成判据，不把减少重复检查等同省略必要的公开链验证。

`npm run verify:all` 会统一运行构建、单元测试、主网离线复算、四份当前报告、实际 API 和已有网页交易的链上核对，结果保存到 `artifacts/acceptance/acceptance-suite.json`，每次原始结果另存 `suite-runs/`，失败不会被后续成功记录抹去。可添加 `-- --online` 做主网只读在线抽查，添加 `-- --contracts` 做本地 EVM 测试（先等待调查结束，执行时勿操作网站）。它不发送公开链交易，不重新操作浏览器，也不把本次检查通过等同于整个项目 P0 完成；没有案例、报告或服务时会如实失败。

```sh
npm run build
node --import tsx --test tests/analysis.test.ts tests/data-agent.test.ts
node --import tsx --test tests/contracts.test.ts
node --import tsx scripts/local-anomaly.ts
npm run verify:api
npm run verify:browser-business
npm run verify:mainnet
npm run verify:mainnet:online
npm run verify:reports
```

合约测试需要正在运行的本地节点。其快照/回滚会改变测试链高度；最终系统验收时应先让调查任务结束，并按索引重组机制重同步，不把重组后的旧报告当作当前报告。

统一验收指定 `--contracts` 时会在测试之后主动同步本地索引，并核对 API 截止块与实际节点的哈希和高度，避免测试刚回滚、自动同步尚未完成时立即查询已失效的临时区块。该恢复步骤不发送交易，正常节点同步与历史报告仍各自保留截止范围。

正常流程：充值 3000 → 商家申请不扣费 → 用户确认后剩余 2970、商家可提 30 → 提现后商家可提 0、会员仍为 2970。用户可退回自己的未消费额度。

本地异常脚本在**独立部署**上执行 24 次确认，形成 720 可提额度，改收款地址后提取 600，剩余会员负债 2280、商家负债 120、资产 2400。这是人为构造的真实本地 EVM 交易，不是公共链或现实诈骗案例。

## 公共网络

```sh
node --import tsx scripts/prepare-sepolia.ts
node --import tsx scripts/deploy-sepolia.ts
node --import tsx scripts/collect-mainnet.ts --expanded
```

第一条创建仅用于 Sepolia 的专用测试账户，私钥保存在被忽略的 `.runtime/sepolia-wallets.json`，权限 0600。输出仅包含公开地址、余额和资源状态。第二条默认仅生成部署预检与费用上限，不发送交易；只有添加 `--execute` 才会部署，且专门限制网络、交易数与测试 Gas 费用。当前仍需免费测试 ETH，公开业务部署及网页交易验收待完成；不要发送主网 ETH，不购买测试币，不提供个人助记词。

第三条只读采集主网 USDC：固定规则先记录，再选择候选；完整分页历史索引，逐条核对真实 RPC 收据与区块，保存原始响应、查询来源、范围、基线和检索过程。`--expanded` 披露了首批候选正常后扩大搜索的条件，阈值版本不变。若找不到满足规则的异动与正常对照，明确失败，不生成伪造案例。探索器索引有遗漏的残余风险必须披露，逐条收据核验不等于证明索引绝无遗漏。

已采集 2026-09-30 UTC 的真实主网案例对：F07E 地址当日转出 13,200,000 USDC，单笔集中度触发规则，但未触发五倍增长规则；31173 地址按同一规则不告警。两者使用此前七个完整 UTC 日作为基线。关联补查从实际接收交易之后最多 120 个区块开始，截止于案例区块；不是全天追踪，也不能认定转出币逐枚来自该入账。历史索引缓存重放时保留原采集时间，并在线复核返回转出的收据，不冒充重新全量扫描。报告仍须通过当前版本的语义和数值校验，旧报告的 complete 状态不等于最新验收通过。

免费 RPC 的历史 `eth_call` 或历史日志可能受限，不以当前余额冒充历史状态。当前读取的 token 精度与历史状态分别记录。无实名来源不为地址附加现实主体身份。主网案例与健身房业务分开，主网不连接签名器。

## 结构

- `contracts/`：固定代币、托管合约、仅测试的故障 token。
- `server/`：索引、SQLite、整数指标、调查工具、真实 LLM 与证据校验、API。
- `shared/`：共享类型和编译产物。
- `web/`：会员、商家、调查、案例和报告视图。
- `scripts/`：编译、部署、专用测试资源及案例采集。
- `tests/`：真实 EVM 测试与显式 synthetic/mock 单元测试。
- `artifacts/acceptance/`：实际验收产物；不能仅凭文件存在认定通过。
- `cases/mainnet/`：已采集的真实公共案例来源、原始响应、固定规则和探索记录。
- `data/`：运行索引、报告、任务及脱敏诊断，不是链上余额的替代账本。

当前 Agent 是一个调查员与结构化工具、确定性校验器协作；独立第二复核 Agent 尚未实现。API 不开放任意签名、shell、SQL 或任意 URL 抓取给模型。

### Agent 接入点（RPC 事件解码与证据闭环）

直接资金流程现在把 ERC-20 `Transfer` 日志先交给 `server/flow-event-decoder.ts` 做严格解码，再写入 `direct-flow.sqlite` 的事件和证据表。会员付款、商家转出以及关联地址的一层后续转账都沿用同一条链路：

```text
RPC eth_getLogs
  → ERC-20 Transfer 与 GymEscrow 业务事件解码（充值、消费申请、会员确认、退款、提现、改收款地址）
  → 量化检测（资产覆盖、已结算收入、集中提现、改址后提现、密集确认、长期未确认、绕过托管直收）
  → Agent 工具取证（业务事件 / 量化指标 / 托管快照 / 交易收据 / 收款地址后续流）
  → evidence 表保存交易收据、区块、规则、窗口和不确定性
  → 报告中的 evidenceId 可通过 `/api/evidence/:id` 或 `/api/flow/evidence/:id` 复核
```

所有金额仍可自由填写；Agent 只读分析，不签名、不付款、不冻结，也不会因为规则命中而阻断商家转出。模型不可用时任务会生成可核查的 `rule-only` 报告，报告仍包含事实、触发规则、证据、正常解释和未知项。

### 后端账户与数据库

直接资金流程使用独立的 SQLite 文件 `data/direct-flow.sqlite`。服务启动时会将当前部署的两个业务账户写入 `accounts` 表：

- `member`：会员账户，绑定当前部署的会员地址；
- `merchant`：商家账户，绑定当前部署的商家地址。

账户记录只保存角色、地址、链 ID、网络和状态，不保存私钥、助记词或 API Key。查询接口为 `GET http://127.0.0.1:3001/api/flow/accounts`，资金流水和 Agent 报告仍通过 `/api/flow` 查询。默认 API 只监听本机 3001 端口；要部署到公网前，应先增加正式鉴权和外部签名方案。

`evidence-facts-v1` 报告把成功工具的金额、状态、规则和补查结果生成确定性事实；模型只写推断、未知、假设、反证和建议，不改写事实条目。完整模型原稿与工具轨迹仍保存，`verify:reports` 会核对解释内容与真实模型响应一致。程序校验不能证明所有自然语言语义。`npm run audit:reports` 可重新校验历史完整报告：失败的原文先可恢复归档，再改标 partial，不静默改写模型结论。

当前四份演示报告另附开发验收复核意见，并明确标记不采用的原稿假设；网页与 Markdown 均展示，意见引用现有证据，原稿保留在报告及 `data/report-reviews/`。这是针对冻结案例的开发复核，不是第二 Agent，也不自动保证后续新报告的自然语言正确。

Gym 与主网调查分别提示和校验：GYM 退款只返还尚未消费的额度，不撤销已确认消费；健身报告不套用主网七日日均或 `current.topRecipient` 字段。链重组只让截止区块晚于实际匹配共同祖先的报告失效；共同祖先及以前的报告仍保留，整链重置没有匹配祖先时仍会失效。

公开链部署、主网两份真实报告、完整 UI/故障回归、安全检查、重启复现和最终交付清单未全部验收前，不宣称项目整体完成。详细门槛沿用上级《今天链不练-自动开发与验收执行方案》。
