import type { VercelRequest, VercelResponse } from '@vercel/node';

const member = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';
const memberB = '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65';
const merchant = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const recipient = '0x90F79bf6EB2c4f870365E785982E1f101E93b906';
const evidenceId = 'vercel-flow:demo-evidence';
const txHash = '0x' + '11'.repeat(32);

const event = {
  id: 'vercel-flow:demo-event', txHash, logIndex: 0, blockNumber: 1, blockHash: '0x' + '22'.repeat(32), timestamp: 1791320000,
  from: member, to: merchant, amount: '30', kind: 'payment', token: '0x0000000000000000000000000000000000000001'
};

const stage = {
  name: 'investigator', status: 'complete', model: 'vercel-demo-evidence-v1', startedAt: '2026-10-07T00:00:00.000Z', finishedAt: '2026-10-07T00:00:02.000Z',
  toolRuns: [
    { id: 'flow-tool-1', name: 'list_events', arguments: {}, at: '2026-10-07T00:00:00.100Z', status: 'ok', result: { events: [event], asOfBlock: 1 }, evidenceIds: [evidenceId] },
    { id: 'flow-tool-2', name: 'compute_metrics', arguments: {}, at: '2026-10-07T00:00:00.300Z', status: 'ok', result: { eventAmount: '30', outflows: '0', flags: [], formula: '24小时窗口；演示样例' }, evidenceIds: [evidenceId] },
    { id: 'flow-tool-3', name: 'verify_transaction', arguments: { txHash }, at: '2026-10-07T00:00:00.500Z', status: 'ok', result: { status: 'confirmed', chainId: 31337, blockNumber: 1 }, evidenceIds: [evidenceId] }
  ],
  result: { summary: '这笔会员付款已记录，当前演示窗口没有发现集中转出线索。', risk: 'no-signal', observations: [{ type: 'inference', text: '付款金额和交易收据来自同一份演示证据。', evidenceIds: [evidenceId] }, { type: 'unknown', text: '演示数据不代表真实经营状态，也不能证明商家未来不会改变资金行为。', evidenceIds: [evidenceId] }], alternatives: ['正常收款后尚未发生商家转出。'], limitations: ['这是 Vercel 只读演示数据，不连接本地 Anvil，也不开放签名。'], recommendation: '在本地链上运行完整流程，或切换到公开案例查看真实以太坊证据。' }
};

const report = {
  id: 'vercel-flow:demo-report', datasetId: 'vercel-flow-demo', eventId: event.id, asOfBlock: 1, chainId: 31337, dataOrigin: 'synthetic', status: 'complete', risk: 'no-signal', headline: stage.result.summary,
  metrics: { version: 'direct-flow-quant-demo-v1', window: { from: event.timestamp - 86400, to: event.timestamp, seconds: 86400 }, eventAmount: '30', baselineCount: 0, baselineMedian: null, amountVsMedianBps: null, receipts: '30', outflows: '0', netInflow: '30', outflowToReceiptBps: '0', recipientConcentrationBps: null, topRecipient: null, secondsSinceLastReceipt: null, flags: [], limitations: ['Vercel 只读演示数据；完整 RPC 索引和签名流程在本地运行。'] },
  facts: [{ text: '演示账单记录一笔 30 GYM 会员付款。', evidenceIds: [evidenceId] }], stages: [stage], limitations: ['这是合成演示，不是实际链上资金。'], generatedAt: '2026-10-07T00:00:02.000Z'
};

const overview = {
  version: 'direct-flow-v1', ready: true, modelConfigured: true, automaticAnalysis: false, signingEnabled: false, dataOrigin: 'synthetic',
  deployment: { id: 'vercel-flow-demo', chainId: 31337, dataOrigin: 'local-chain', token: '0x0000000000000000000000000000000000000001', tokenSymbol: 'GYM', decimals: 0, deploymentBlock: 1, deploymentHash: txHash, accounts: { merchant, userA: member, userB: memberB, payout: recipient, nextPayout: recipient } },
  accounts: [{ id: 'vercel-flow-demo:member', role: 'member', displayName: '会员账户', address: member, chainId: 31337, network: 'vercel-demo', status: 'active', createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' }, { id: 'vercel-flow-demo:merchant', role: 'merchant', displayName: '商家账户', address: merchant, chainId: 31337, network: 'vercel-demo', status: 'active', createdAt: '2026-10-07T00:00:00.000Z', updatedAt: '2026-10-07T00:00:00.000Z' }],
  balances: { merchant: '30', userA: '2970', userB: '3000', payout: '0', nextPayout: '0' }, checkpoint: { blockNumber: 1, timestamp: event.timestamp, coverageComplete: true }, events: [event], totalEvents: 1, jobs: [{ id: 'vercel-flow:demo-job', datasetId: 'vercel-flow-demo', eventId: event.id, question: '核查这笔演示账单', status: 'complete', createdAt: '2026-10-07T00:00:00.000Z', asOfBlock: 1, stages: [stage], reportId: report.id }], reports: [report]
};

function send(res: VercelResponse, data: unknown, status = 200) { return res.status(status).json({ data }); }

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  const queryPath = Array.isArray(req.query.path) ? req.query.path.join('/') : String(req.query.path || '');
  const requestPath = String(req.url || '').split('?')[0];
  const path = queryPath || (requestPath.startsWith('/api/flow/') ? decodeURIComponent(requestPath.slice('/api/flow/'.length)) : '');
  if (req.method === 'GET' && !path) return send(res, overview);
  if (req.method === 'GET' && path === 'accounts') return send(res, overview.accounts);
  if (req.method === 'GET' && (path === 'jobs' || path.startsWith('jobs/'))) return send(res, overview.jobs[0]);
  if (req.method === 'GET' && (path === 'reports' || path.startsWith('reports/'))) return send(res, report);
  if (req.method === 'GET' && (path === 'evidence' || path.startsWith('evidence/'))) return send(res, { id: evidenceId, datasetId: overview.deployment.id, chainId: 31337, kind: 'event', asOfBlock: 1, txHash, explorerUrl: null, facts: { event, source: 'Vercel static demo fixture' }, coverage: { complete: true, missing: [] } });
  if (req.method === 'POST' && path === 'investigations') return send(res, overview.jobs[0], 202);
  if (req.method === 'POST' && path === 'transfers') return res.status(400).json({ error: { message: 'Vercel 展示模式为只读；付款与签名请在本地 Anvil 演示。' } });
  return res.status(404).json({ error: { message: 'Vercel 展示模式未提供此接口。' } });
}
