import type {FlowEvent,FlowJob,FlowReport} from './flow.ts';
import {percentBps} from './flow-view.ts';

export type PlainReport={tone:'neutral'|'attention'|'unknown';label:string;title:string;happened:string;reasons:string[];nextStep:string;boundary:string;checkedAt:string|null};
export type ConversationResult={summary:string;details:string;nextStep:string;confirmed:string[];toVerify:string[]};
export function conversationalReport(report:FlowReport,question:string){
  const m=report.metrics;
  const summary=report.risk==='disputed'?'两次核查确认了同一笔资金变化，但对它的解释有分歧。':report.risk==='insufficient'?'链上已经确认资金发生了变化，资金用途仍需补充凭证。':report.risk==='no-signal'?'当前核查范围内没有发现明显异常信号。':'发现了需要核实的资金线索，还不能说商家要跑路。';
  const changes:string[]=[];
  const confirmed:string[]=[];
  const toVerify:string[]=[];
  if(/24|收款|比例|变化/.test(question)){const line=`截至这笔账单，前 24 小时收到 ${m.receipts} GYM，转出 ${m.outflows} GYM。`;changes.push(line);confirmed.push(line);}
  if(m.flags.some(f=>f.includes('接收方高度集中'))){const line='多笔转账集中到同一个账户。';changes.push(line);confirmed.push(line);toVerify.push('这个接收账户由谁控制、资金用于什么。');}
  if(m.flags.some(f=>f.includes('五分钟'))){const line='至少一笔收款后在五分钟内出现转出。';changes.push(line);confirmed.push(line);toVerify.push('收款后快速转出的业务用途。');}
  if(m.flags.some(f=>f.includes('三倍'))){const line='这笔转出高于此前可比较记录的常见金额。';changes.push(line);confirmed.push(line);toVerify.push('金额变大的具体业务原因。');}
  if(/追踪|哪里|转出去之后/.test(question)){
    const trace=report.stages.flatMap(s=>s.toolRuns).find(t=>t.name==='trace_recipient'&&t.status==='ok');
    const data=trace?.result as {transfers?:unknown[]}|undefined;
    const detail=Array.isArray(data?.transfers)?data.transfers.length?`查到收钱的账户又转出了 ${data.transfers.length} 笔，具体去向可以展开依据查看。`:'在当前追踪窗口内，没有发现收钱账户继续转账。':'这次还没有拿到可靠的后续转账结果。';
    confirmed.push(detail);toVerify.push('追踪窗口之外的转账，以及收款账户与商家的关系。');
    return {summary,details:detail+'这里只覆盖有限区块和直接转账，未查到不等于不存在。',nextStep:'先核对收款账户身份，再补充用途说明或付款凭证。',confirmed,toVerify:[...new Set(toVerify)]};
  }
  if(/正常.*解释|经营.*可能解释/.test(question)){toVerify.push('房租、工资、采购或账户归集等正常经营解释。');return {summary,details:'房租、工资或经营账户归集都可能造成这种资金轨迹，但链上记录没有给出用途凭证。',nextStep:'请商家说明用途，并提供对应账单或付款凭证。',confirmed,toVerify:[...new Set(toVerify)]};}
  if(!confirmed.length)confirmed.push('已确认这笔账单及其链上收款、转出记录。');
  if(!toVerify.length)toVerify.push('资金用途和接收账户关系。');
  return {summary,details:changes.slice(0,3).join(' ')||'当前链上记录能确认资金怎么移动，但不能单独说明线下用途。',nextStep:'先核对接收账户身份，再补充用途说明或付款凭证。',confirmed,toVerify:[...new Set(toVerify)]};
}
export function plainReport(event:FlowEvent,report:FlowReport|undefined,job:FlowJob|undefined,fromName:string,toName:string):PlainReport{
  const happened=event.kind==='payment'?`${fromName}向健身房支付了 ${event.amount} GYM，这笔付款已确认。`:event.kind==='receipt'?`健身房收到 ${event.amount} GYM，这笔收款已确认。`:`${fromName}转出了 ${event.amount} GYM，接收方是${toName}。`;
  const base:PlainReport={tone:'unknown',label:'等待检查',title:'这笔记录还没有检查结果',happened,reasons:[],nextStep:'稍后回来查看结果，也可以发起一次检查。',boundary:'这里只能核查已记录的资金变动，不能据此判断商家会不会关门。',checkedAt:report?.generatedAt??null};
  if(report?.status==='stale'||job?.status==='stale')return {...base,label:'旧结果已过期',title:'这份旧结果不能代表当前情况',reasons:['用于检查的记录已经变化，需要重新核实。'],nextStep:'重新检查后，再查看新的结果。'};
  if(report?.status==='partial'||job?.status==='partial')return {...base,label:'核查只完成一部分',title:'已取得部分链上事实，风险判断尚未完成',reasons:['付款或转出是否完成，与风险检查是否完成是两回事。此次只完成部分核查，不代表资金没有风险。'],nextStep:'稍后重新检查，或直接向商家核实资金用途。'};
  if(!report||report.status!=='complete')return {...base,label:job?'正在检查':'等待检查',title:job?'正在检查这笔记录，请稍等':'这笔记录还没有检查结果',reasons:[job?'检查结果会自动更新，现在还不能下结论。':'尚未进行检查，不能把没有结果当作安全。']};
  const m=report.metrics,reasons:string[]=[];
  if(m.flags.some(f=>f.includes('转出达到收款')))reasons.push(`截至这笔记录，24 小时内健身房收款 ${m.receipts} GYM、转出 ${m.outflows} GYM，转出占收款的 ${percentBps(m.outflowToReceiptBps)}。需要关注的是累计转出比例，不能只看这一笔的金额。`);
  if(m.flags.some(f=>f.includes('接收方高度集中')))reasons.push('多笔转账主要流向同一个账户，需要了解该账户的用途。');
  if(m.flags.some(f=>f.includes('五分钟')))reasons.push('健身房收到付款后，很快又转出了资金，需要核实是否为正常经营支出。');
  if(m.flags.some(f=>f.includes('三倍')))reasons.push('这笔金额达到此前同类转账常见金额的三倍或以上，需要了解金额增加的原因。');
  const state=report.risk;
  const presentation={
    attention:{tone:'attention' as const,label:'建议核实用途',title:m.flags.some(f=>f.includes('转出达到收款'))?'健身房近期转出比例偏高，建议核实用途':'这笔资金变动需要进一步核实',nextStep:'向商家了解相关支出的用途，并要求提供相应说明。'},
    disputed:{tone:'unknown' as const,label:'暂时没有一致判断',title:'对这笔记录存在不同解释，需要再核实',nextStep:'先核实资金用途，等进一步检查后再作判断。'},
    insufficient:{tone:'unknown' as const,label:'已确认线索，待补充凭证',title:'资金变化已确认，链上尚未说明用途',nextStep:'先核对接收账户身份，再补充用途说明或付款凭证。'},
    'no-signal':{tone:'neutral' as const,label:'暂未发现明显异常',title:'这次检查没有发现明确的异常信号',nextStep:'留意后续提醒；这次结果不是商家安全或正常营业的保证。'},
  }[state];
  if(!reasons.length)reasons.push(state==='no-signal'?'在这次检查的记录范围内，没有发现明确的资金异常。':'链上已确认资金变化，但当前记录不包含线下用途、合同或付款凭证。');
  if(m.baselineCount<3)reasons.push('历史对照样本不足，金额是否反常还不能定量确认。');
  return {...base,...presentation,reasons};
}
export function plainReportText(summary:PlainReport){return ['今天链不练 · 简明检查结果',summary.label,summary.title,'','链上已确认',summary.happened,'','这次核查得到的线索',...summary.reasons.map(s=>'• '+s),'','下一步核实',summary.nextStep,'',summary.boundary,...(summary.checkedAt?['检查时间：'+new Date(summary.checkedAt).toLocaleString('zh-CN')]:[]),'GYM 是无现金价值的演示币。本地演示不代表已接入公共以太坊。'].join('\n');}
