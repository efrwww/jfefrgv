import React,{useRef,useState} from 'react';
import {BrowserProvider,ContractFactory,getAddress,isAddress} from 'ethers';
import tokenArtifact from '../../shared/artifacts/GymToken.json';
import escrowArtifact from '../../shared/artifacts/GymEscrow.json';

const CHAIN_ID=677;
const EXPECTED='0x295DF8b1d573c8332170d03437ddaf36411a29eb';
const chainParams={chainId:'0x2a5',chainName:'BOT Chain',rpcUrls:['https://rpc.botchain.ai'],nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},blockExplorerUrls:['https://scan.botchain.ai']};
const scan=(kind:'tx'|'address',value:string)=>`https://scan.botchain.ai/${kind}/${value}`;

type Step={label:string;status:'waiting'|'running'|'done'|'error';hash?:string;address?:string;error?:string};

export function DeployPage(){
  const [account,setAccount]=useState('');
  const [chainId,setChainId]=useState<number>();
  const [memberA,setMemberA]=useState('');
  const [payout,setPayout]=useState(EXPECTED);
  const [steps,setSteps]=useState<Step[]>([{label:'连接指定 MetaMask 账户',status:'waiting'},{label:'部署 GymToken（会员 A 获得 3,000 GYM）',status:'waiting'},{label:'部署 GymEscrow（商家按确认消费提现）',status:'waiting'}]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [statusMessage,setStatusMessage]=useState('');
  const deploymentInFlight=useRef(false);
  const [done,setDone]=useState<{token:string;escrow:string;deploymentBlock:number;deploymentHash:string;escrowHash:string}>();
  const update=(index:number,next:Partial<Step>)=>setSteps(current=>current.map((step,i)=>i===index?{...step,...next}:step));
  function readableError(value:unknown){
    const err=value as any,code=err?.code??err?.info?.error?.code;
    if(code===4001||code==='ACTION_REJECTED')return '你在 MetaMask 中拒绝了请求。确认账户和网络后，可以重新点击部署。';
    if(code===-32002)return 'MetaMask 已有待处理请求。请先打开钱包处理弹窗，再重试。';
    if(code===4902)return 'MetaMask 尚未添加 BOT Chain。请先点击“连接 MetaMask 并切换主网”。';
    if(code==='INSUFFICIENT_FUNDS')return '部署账户的 BOT 余额不足以支付主网 Gas。';
    return err?.shortMessage||err?.reason||err?.message||'部署失败，请检查 MetaMask 和网络后重试。';
  }
  async function connect(){
    setError('');setStatusMessage('正在连接 MetaMask…');
    const ethereum=(window as any).ethereum;
    if(!ethereum)throw new Error('没有检测到 MetaMask，请使用安装了 MetaMask 的浏览器。');
    const provider=new BrowserProvider(ethereum);
    await provider.send('eth_requestAccounts',[]);
    let network=await provider.getNetwork();
    if(Number(network.chainId)!==CHAIN_ID){
      try{await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chainParams.chainId}]});}
      catch(error:any){if(error?.code!==4902)throw error;await ethereum.request({method:'wallet_addEthereumChain',params:[chainParams]});await ethereum.request({method:'wallet_switchEthereumChain',params:[{chainId:chainParams.chainId}]});}
      network=await provider.getNetwork();
    }
    const signer=await provider.getSigner(),address=await signer.getAddress();
    if(address.toLowerCase()!==EXPECTED.toLowerCase())throw new Error(`当前 MetaMask 账户为 ${address}，不是指定部署账户 ${EXPECTED}。`);
    if(Number(network.chainId)!==CHAIN_ID)throw new Error('MetaMask 尚未切换到 Chain ID 677。');
    setAccount(address);setChainId(Number(network.chainId));update(0,{status:'done'});setStatusMessage('钱包已连接，部署参数检查完成后即可提交。');
  }
  function validateAddress(value:string,label:string){if(!isAddress(value))throw new Error(`${label} 不是有效的以太坊地址。`);return getAddress(value);}
  async function deploy(){
    if(deploymentInFlight.current)return;
    deploymentInFlight.current=true;setBusy(true);setError('');setDone(undefined);setStatusMessage('正在检查 MetaMask、部署账户和网络…');
    try{
      const ethereum=(window as any).ethereum;
      if(!ethereum)throw new Error('没有检测到 MetaMask，请在安装了 MetaMask 的浏览器中打开此页面。');
      const provider=new BrowserProvider(ethereum);
      const connectedAccounts=await provider.send('eth_requestAccounts',[]);
      if(!connectedAccounts?.length)throw new Error('MetaMask 尚未连接账户，请先连接指定部署账户。');
      const network=await provider.getNetwork(),signer=await provider.getSigner(),liveAccount=await signer.getAddress();
      setAccount(liveAccount);setChainId(Number(network.chainId));
      if(liveAccount.toLowerCase()!==EXPECTED.toLowerCase())throw new Error(`当前 MetaMask 账户为 ${liveAccount}，不是指定部署账户 ${EXPECTED}。`);
      if(Number(network.chainId)!==CHAIN_ID)throw new Error(`当前网络 Chain ID 为 ${network.chainId}，请点击“连接 MetaMask 并切换主网”后重试。`);
      const a=validateAddress(memberA,'会员 A'),p=validateAddress(payout,'收款账户');
      if(a.toLowerCase()===liveAccount.toLowerCase())throw new Error('会员地址不能与商家部署账户相同。');
      update(0,{status:'done'});update(1,{status:'running',error:undefined});
      setStatusMessage('请打开 MetaMask，核对并确认 GymToken 部署交易。');
      const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode,signer).deploy([a],[3000n]);
      const tokenTx=token.deploymentTransaction();
      update(1,{status:'running',hash:tokenTx?.hash});
      setStatusMessage(tokenTx?`GymToken 已提交（${tokenTx.hash}），等待链上确认…`:'GymToken 已提交，等待链上确认…');
      await token.waitForDeployment();
      const tokenAddress=await token.getAddress();
      if(!tokenTx)throw new Error('无法取得 GYM Token 部署交易。');
      const tokenHash=tokenTx.hash;
      const tokenReceipt=await tokenTx.wait(1);
      if(!tokenReceipt||tokenReceipt.status!==1)throw new Error('GYM Token 部署交易未确认。');
      update(1,{status:'done',hash:tokenHash,address:tokenAddress});
      setSteps(current=>current.map((step,i)=>i===1?{...step,hash:tokenHash,address:tokenAddress}:step));
      update(2,{status:'running',error:undefined});
      setStatusMessage('GymToken 已确认。请在 MetaMask 中核对并确认 GymEscrow 部署交易。');
      const escrow=await new ContractFactory(escrowArtifact.abi,escrowArtifact.bytecode,signer).deploy(tokenAddress,liveAccount,p);
      const escrowTx=escrow.deploymentTransaction();
      update(2,{status:'running',hash:escrowTx?.hash});
      setStatusMessage(escrowTx?`GymEscrow 已提交（${escrowTx.hash}），等待链上确认…`:'GymEscrow 已提交，等待链上确认…');
      await escrow.waitForDeployment();
      const escrowAddress=await escrow.getAddress();
      if(!escrowTx)throw new Error('无法取得 GymEscrow 部署交易。');
      const escrowHash=escrowTx.hash;
      const escrowReceipt=await escrowTx.wait(1);
      if(!escrowReceipt||escrowReceipt.status!==1)throw new Error('GymEscrow 部署交易未确认。');
      update(2,{status:'done',hash:escrowHash,address:escrowAddress});
      setDone({token:tokenAddress,escrow:escrowAddress,deploymentBlock:tokenReceipt.blockNumber,deploymentHash:tokenHash,escrowHash});
      setStatusMessage('两个合约均已部署并确认。');
    }catch(caught){
      const message=readableError(caught);setError(message);setStatusMessage('部署未完成。');
      setSteps(current=>current.map(step=>step.status==='running'?{...step,status:'error',error:message}:step));
    }finally{deploymentInFlight.current=false;setBusy(false);}
  }
  const manifest=done?JSON.stringify({id:`botchain-${done.escrow.toLowerCase()}`,chainId:CHAIN_ID,dataOrigin:'public-mainnet',mode:'single-member',token:done.token,escrow:done.escrow,tokenSymbol:'GYM',decimals:0,deploymentBlock:done.deploymentBlock,deploymentHash:done.deploymentHash,escrowDeploymentHash:done.escrowHash,accounts:{merchant:account,userA:getAddress(memberA),userB:getAddress(memberA),payout:getAddress(payout),nextPayout:getAddress(payout)},links:{token:scan('address',done.token),escrow:scan('address',done.escrow),tokenDeployment:scan('tx',done.deploymentHash),escrowDeployment:scan('tx',done.escrowHash)}},null,2):'';
  const memberAValid=(()=>{try{return isAddress(memberA)&&memberA.toLowerCase()!==account.toLowerCase();}catch{return false;}})();
  const payoutValid=(()=>{try{return isAddress(payout);}catch{return false;}})();
  async function copy(){if(manifest)await navigator.clipboard.writeText(manifest);}
  return <div className="app-shell"><div className="main-shell" style={{marginLeft:0,width:'100%'}}><main><div className="page-heading"><div><span className="eyebrow">MetaMask 主网部署</span><h1>部署到 BOT Chain 677</h1><p>私钥留在 MetaMask；页面只提交你确认的交易。</p></div><a className="secondary" href="/analysis">返回调查页</a></div>
    <section className="card" style={{maxWidth:900,margin:'0 auto'}}>
      <div className="message"><strong>部署账户</strong><br/>必须是 <span className="mono">{EXPECTED}</span><br/>网络：BOT Chain · Chain ID 677 · <a href="https://scan.botchain.ai" target="_blank" rel="noreferrer">区块浏览器</a></div>
      <div className="buttons" style={{margin:'18px 0'}}><button className="primary" disabled={busy} onClick={()=>void connect().catch(e=>{setError(readableError(e));setStatusMessage('钱包连接未完成。');})}>{account?`已连接 ${account.slice(0,6)}…${account.slice(-4)}`:'连接 MetaMask 并切换主网'}</button>{chainId===CHAIN_ID&&<span className="subtle">网络已确认</span>}</div>
      <div className="forms stacked"><label>会员 A 钱包地址<input value={memberA} onChange={e=>setMemberA(e.target.value)} placeholder="0x…" disabled={busy}/></label><label>商家收款地址<input value={payout} onChange={e=>setPayout(e.target.value)} placeholder="默认使用指定账户" disabled={busy}/></label></div>
      <p className="muted">部署会为会员 A 铸造 3,000 GYM 演示额度。GYM 是固定演示代币，不代表人民币，也不具备升值承诺。</p>
      <div className="message"><strong>部署前检查</strong><br/>{account?`✓ 已连接部署账户 ${account.slice(0,6)}…${account.slice(-4)}`:'○ 尚未连接部署账户'}<br/>{chainId===CHAIN_ID?'✓ Chain ID 677 网络正确':'○ 需要切换到 Chain ID 677'}<br/>{memberAValid?'✓ 会员 A 地址有效':'○ 请填写有效且不同于部署账户的会员 A 地址'}<br/>{payoutValid?'✓ 商家收款地址有效':'○ 商家收款地址无效'}</div>
      {error&&<p className="error" role="alert">{error}</p>}
      <ol className="deploy-steps">{steps.map((step,i)=><li key={step.label} className={step.status}><span>{step.status==='done'?'✓':step.status==='running'?'…':step.status==='error'?'!':i+1}</span><div><strong>{step.label}</strong>{step.address&&<a className="block mono" href={scan('address',step.address)} target="_blank" rel="noreferrer">合约：{step.address}</a>}{step.hash&&<a className="block mono" href={scan('tx',step.hash)} target="_blank" rel="noreferrer">交易：{step.hash}</a>}{step.error&&<small className="error">{step.error}</small>}</div></li>)}</ol>
      <button type="button" className="primary full-width" disabled={busy} onClick={()=>void deploy()}>{busy?'正在处理部署…':'开始部署两个合约'}</button>
      {statusMessage&&<p className={error?'error':'message'} role={error?'alert':'status'} aria-live="polite">{statusMessage}</p>}
      {done&&<div className="message" style={{marginTop:20}}><strong>合约已部署</strong><p>把此 JSON 保存为服务端的 <code>artifacts/acceptance/botchain-mainnet-manifest.json</code>，在项目目录运行 <code>npm run activate:botchain-mainnet -- artifacts/acceptance/botchain-mainnet-manifest.json</code>。脚本会核对 RPC 网络、两笔部署收据、合约代码和构造参数，再生成主网配置；Chain ID 677 与 968 测试网配置分开保留。</p><button className="secondary" onClick={()=>void copy()}>复制部署清单</button><pre>{manifest}</pre></div>}
    </section><footer>主网交易不可逆，请逐笔核对 MetaMask 弹窗中的网络、合约和 Gas。</footer></main></div></div>;
}
