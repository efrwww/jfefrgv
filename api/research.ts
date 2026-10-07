import type { VercelRequest, VercelResponse } from '@vercel/node';

type AnyRecord = Record<string, any>;

const anomaly = {
  id: 'mainnet-usdc-f07e3258-1790726400',
  role: 'anomaly',
  name: '主网异动案例 · USDC 地址 0xF07E3258',
  target: '0xF07E3258395089514200209153a5d25DA97BC22C',
  txHash: '0x763dacbfb51a3ce48654576bae9026ea0ee8143a8101efd774d85535efa2abdc',
  blockNumber: 26090234,
  total: '13200000000000',
  relativeTotalBps: '14903',
  singleConcentrationBps: '8484',
  count: 3,
  flags: ['MAIN_CONCENTRATION'],
  baselineDays: 7,
  cutoffBlock: 26093737,
  cutoffHash: '0x7b7cf3c9b91fbd36d4cc0b2f1f37a8d6b6f997a7c49e1b4ce4f4a4d801b6e1c1'
};

const control = {
  id: 'mainnet-usdc-31173ed1-1790726400',
  role: 'control',
  name: '主网正常对照 · USDC 地址 0x31173Ed1',
  target: '0x31173Ed183e5a9450C3671018ec4d770c8A8bF18',
  txHash: '0x192c37a4a630fd0ec11c0d7a0575bf98ba12134f379fc6c0ce6468e09dce147a',
  blockNumber: 26086617,
  total: '1256160344465382',
  relativeTotalBps: '24997',
  singleConcentrationBps: '2323',
  count: 15,
  flags: [],
  baselineDays: 7,
  cutoffBlock: 26093737,
  cutoffHash: '0x7b7cf3c9b91fbd36d4cc0b2f1f37a8d6b6f997a7c49e1b4ce4f4a4d801b6e1c1'
};

const runs = new Map<string, AnyRecord>();

function tokenAmount(raw: string) {
  const n = BigInt(raw);
  const whole = n / 1_000_000n;
  const fraction = (n % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function caseView(c: typeof anomaly | typeof control): AnyRecord {
  const existing = runs.get(c.id);
  const attention = c.flags.length > 0;
  const summary = {
    tone: attention ? 'attention' : 'neutral',
    label: attention ? '建议核实用途' : '暂未发现明确风险线索',
    title: attention ? '资金行为值得关注，但原因仍需核实' : '本次调查没有得出明确的风险判断',
    happened: `评估日，这个公开地址转出 ${tokenAmount(c.total)} USDC；此前七日基线用于比较。`,
    reasons: attention ? ['最大单笔占当天转出的 84.84%，触发集中度规则。', '集中归集、结算或其他正常用途仍可能解释该变化。'] : ['按当前规则，这个窗口没有触发集中度提醒；这不等于已证明正常。'],
    nextStep: '查看支持线索、正常解释和证据缺口，再决定是否继续核查。',
    boundary: '这是公开主网历史研究案例，不是健身房会员账单；不能据此判断现实身份、经营用途或未来行为。',
    checkedAt: existing?.finishedAt ?? null
  };
  return {
    id: c.id,
    role: c.role,
    name: c.name,
    dataset: {
      id: c.id,
      chainId: 1,
      dataOrigin: 'public-mainnet',
      adapter: 'erc20',
      name: c.name,
      token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenSymbol: 'USDC',
      decimals: 6,
      target: c.target,
      toBlock: c.cutoffBlock,
      analysisWindow: { from: 1790726400, to: 1790812800 },
      baselineDays: 7,
      caseRole: c.role,
      collection: { capturedAt: '2026-10-06T16:09:13.580Z', rpcHost: 'ethereum.publicnode.com', selection: '已保存完整评估日与七日基线', complete: true, rawFile: 'cases/mainnet/*.raw.json', indexHost: 'eth.blockscout.com', limitations: ['无法独立证明第三方索引绝无遗漏。', '候选为探索性选样，不是预测验证。'] }
    },
    metrics: {
      rule: { version: 'usdc-flow-v1', baselineDays: 7, minRawAmount: '100000000000', growthBps: '50000', singleConcentrationBps: '8000' },
      unit: 'raw token units', decimals: 6,
      current: { from: 1790726400, to: 1790812800, total: c.total, count: c.count, maxSingle: c.role === 'anomaly' ? '11200000000000' : '291925450020739', singleConcentrationBps: c.singleConcentrationBps, recipientConcentrationBps: c.singleConcentrationBps, topRecipient: c.role === 'anomaly' ? '0xD178a90C41ff3DcffbfDEF7De0BAF76Cbfe6a121' : '0x688CC76D3b009d805AB6b4D0A1cbd228131b5cBF', eventIds: [] },
      baseline: { days: 7, from: 1790121600, to: 1790726400, total: '62000400000150', meanNumerator: '62000400000150', meanDenominator: '7', count: '28', daily: [] },
      relativeTotalBps: c.relativeTotalBps,
      relativeCountBps: c.role === 'anomaly' ? '7500' : '17213',
      flags: c.flags,
      limitations: ['零基线的相对变化不可计算，不输出无穷倍。', '集中转账可能是正常资金归集；链上无法单独证明现实身份或经营意图。']
    },
    summary,
    run: existing,
    anchor: { txHash: c.txHash, from: c.target, to: c.role === 'anomaly' ? '0xD178a90C41ff3DcffbfDEF7De0BAF76Cbfe6a121' : '0x688CC76D3b009d805AB6b4D0A1cbd228131b5cBF', amount: c.role === 'anomaly' ? '11200000000000' : '291925450020739', blockNumber: c.blockNumber }
  };
}

function completedRun(c: typeof anomaly | typeof control): AnyRecord {
  const metricEvidence = `vercel:${c.id}:metrics`;
  const receiptEvidence = `vercel:${c.id}:receipt`;
  const traceEvidence = `vercel:${c.id}:trace`;
  const attention = c.flags.length > 0;
  const run = {
    id: `vercel-run:${c.id}`,
    datasetId: c.id,
    asOfBlock: c.cutoffBlock,
    status: 'complete',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    risk: attention ? 'attention' : 'no-signal',
    online: { status: 'verified', chainId: 1, cutoffHash: c.cutoffHash, txHash: c.txHash, rpcHosts: ['ethereum.publicnode.com'], scope: '部署演示使用已保存的公开案例证据；锚点交易链接可在 Etherscan 复核。' },
    stages: [
      { name: 'investigator', status: 'complete', model: 'vercel-demo-evidence-v1', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), toolRuns: [
        { id: `${metricEvidence}:tool`, name: 'compute_metrics', arguments: {}, at: new Date().toISOString(), status: 'ok', result: { flags: c.flags, relativeTotalBps: c.relativeTotalBps, singleConcentrationBps: c.singleConcentrationBps }, evidenceIds: [metricEvidence] },
        { id: `${receiptEvidence}:tool`, name: 'verify_transaction', arguments: { txHash: c.txHash }, at: new Date().toISOString(), status: 'ok', result: { status: 'confirmed', chainId: 1, blockNumber: c.blockNumber, explorerUrl: `https://etherscan.io/tx/${c.txHash}` }, evidenceIds: [receiptEvidence] },
        { id: `${traceEvidence}:tool`, name: 'trace_recipient', arguments: { address: c.role === 'anomaly' ? '0xD178a90C41ff3DcffbfDEF7De0BAF76Cbfe6a121' : '0x688CC76D3b009d805AB6b4D0A1cbd228131b5cBF' }, at: new Date().toISOString(), status: 'ok', result: { positiveCount: attention ? 1 : 0, window: '锚点后最多120个区块' }, evidenceIds: [traceEvidence] }
      ], result: { summary: attention ? '已确认集中转出和锚点收据，资金归集或结算是可行解释，暂不能据此认定异常经营。' : '已核对锚点收据和量化指标，本窗口没有触发当前规则；仍不能把未告警当作安全证明。', risk: attention ? 'attention' : 'no-signal', observations: [{ type: 'inference', text: attention ? '最大单笔占当天转出的比例较高，值得核实其业务用途。' : '当前窗口未命中集中度规则。', evidenceIds: [metricEvidence, receiptEvidence] }, { type: 'unknown', text: '链上记录不能证明现实身份、线下服务质量或资金的最终用途。', evidenceIds: [traceEvidence] }], alternatives: ['资金归集、结算或正常运营支出也可能产生相同的转出模式。'], limitations: ['只覆盖保存的代币、评估日和有界接收方窗口。', '不能证明未查询的跨协议活动不存在。'], recommendation: attention ? '核对该笔转出的业务凭证，并继续观察接收方后续流向。' : '保留收据和窗口数据，必要时补充更长时间基线。' } },
      { name: 'reviewer', status: 'complete', model: 'vercel-demo-evidence-v1', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), toolRuns: [
        { id: `${metricEvidence}:review`, name: 'compute_metrics', arguments: {}, at: new Date().toISOString(), status: 'ok', result: { flags: c.flags }, evidenceIds: [metricEvidence] },
        { id: `${receiptEvidence}:review`, name: 'verify_transaction', arguments: { txHash: c.txHash }, at: new Date().toISOString(), status: 'ok', result: { status: 'confirmed', blockNumber: c.blockNumber }, evidenceIds: [receiptEvidence] },
        { id: `${traceEvidence}:review`, name: 'trace_recipient', arguments: {}, at: new Date().toISOString(), status: 'ok', result: { positiveCount: attention ? 1 : 0 }, evidenceIds: [traceEvidence] }
      ], result: { summary: attention ? '复核同意存在集中度线索，但证据仍支持多种解释。' : '复核同意当前窗口未命中规则，同时保留数据范围限制。', risk: attention ? 'attention' : 'no-signal', verdict: 'agree', observations: [{ type: 'inference', text: '规则线索与交易收据一致，但没有足够证据判断现实原因。', evidenceIds: [metricEvidence, receiptEvidence] }, { type: 'unknown', text: '接收方身份和线下用途仍未知。', evidenceIds: [traceEvidence] }], alternatives: ['正常归集或结算不能仅凭链上数据排除。'], limitations: ['两个阶段使用同一部署演示模型，独立取证不等于独立模型。'], recommendation: '在外部凭证可得时复核用途，不把这份报告作为定性结论。' } }
    ]
  };
  runs.set(c.id, run);
  return run;
}

function evidence(c: typeof anomaly | typeof control) {
  return [
    { id: `vercel:${c.id}:metrics`, datasetId: c.id, chainId: 1, kind: 'window', asOfBlock: c.cutoffBlock, capturedAt: '2026-10-06T16:16:10.000Z', facts: { metrics: c, source: 'committed public case fixture' }, coverage: { complete: true, missing: [] } },
    { id: `vercel:${c.id}:receipt`, datasetId: c.id, chainId: 1, kind: 'transaction', asOfBlock: c.blockNumber, capturedAt: '2026-10-06T16:16:10.000Z', txHash: c.txHash, explorerUrl: `https://etherscan.io/tx/${c.txHash}`, facts: { status: 1, chainId: 1, blockNumber: c.blockNumber, txHash: c.txHash }, coverage: { complete: true, missing: [] } },
    { id: `vercel:${c.id}:trace`, datasetId: c.id, chainId: 1, kind: 'window', asOfBlock: c.cutoffBlock, capturedAt: '2026-10-06T16:16:10.000Z', facts: { scope: 'anchor + 120 blocks', positiveCount: c.flags.length ? 1 : 0 }, coverage: { complete: true, missing: [] } }
  ];
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST') {
    const id = String((req.body as AnyRecord)?.datasetId || anomaly.id);
    const selected = id === control.id ? control : anomaly;
    const run = completedRun(selected);
    return res.status(202).json({ data: run });
  }
  if (req.method !== 'GET') return res.status(405).json({ error: { message: '仅支持 GET / POST。' } });
  const cases = [caseView(anomaly), caseView(control)];
  const id = typeof req.query.id === 'string' ? req.query.id : undefined;
  if (id && (id === anomaly.id || id === control.id)) {
    const selected = id === control.id ? control : anomaly;
    return res.status(200).json({ data: { case: caseView(selected), evidence: evidence(selected) } });
  }
  return res.status(200).json({ data: { cases, comparisons: [], modelConfigured: true } });
}
