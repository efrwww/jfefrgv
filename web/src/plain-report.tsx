import type {PlainReport} from '../../shared/plain-report';
export function PlainReportCard({summary}:{summary:PlainReport}){
  return <section className={'plain-report '+summary.tone} data-testid="plain-report"><span className="plain-status">{summary.label}</span><h3>{summary.title}</h3><div className="plain-block"><h4>链上已确认</h4><p>{summary.happened}</p></div><div className="plain-block"><h4>这次核查得到的线索</h4><ul>{summary.reasons.map((reason,i)=><li key={i}>{reason}</li>)}</ul></div><div className="plain-block next-step"><h4>下一步核实</h4><p>{summary.nextStep}</p></div><p className="plain-boundary">{summary.boundary}</p>{summary.checkedAt&&<small className="plain-time">检查时间：{new Date(summary.checkedAt).toLocaleString('zh-CN')}，不是实时营业状态。</small>}</section>;
}
