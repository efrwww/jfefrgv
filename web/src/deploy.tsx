import React,{useState} from 'react';
import {BrowserProvider,ContractFactory,getAddress,isAddress} from 'ethers';
import tokenArtifact from '../../shared/artifacts/GymToken.json';
import escrowArtifact from '../../shared/artifacts/GymEscrow.json';

const CHAIN_ID=677;
const EXPECTED='0x295DF8b1d573c8332170d03437ddaf36411a29eb';
const chainParams={chainId:'0x2a5',chainName:'BOT Chain',rpcUrls:['https://rpc.botchain.ai'],nativeCurrency:{name:'BOT',symbol:'BOT',decimals:18},blockExplorerUrls:['https://scan.botchain.ai']};
const scan=(kind:'tx'|'address',value:string)=>`https://scan.botchain.ai/${kind}/${value}`;

type Step={label:string;status:'waiting'|'running'|'done'|'error';hash?:string;address?:string;error?:string};

export function DeployPage(){
  const [wallet,setWallet]=useState<BrowserProvider>();
  const [account,setAccount]=useState('');
  const [chainId,setChainId]=useState<number>();
  const [memberA,setMemberA]=useState('');
  const [memberB,setMemberB]=useState('');
  const [payout,setPayout]=useState(EXPECTED);
  const [steps,setSteps]=useState<Step[]>([{label:'连接指定 MetaMask 账户',status:'waiting'},{label:'部署 GymToken（每个会员 3,000 GYM）',status:'waiting'},{label:'部署 GymEscrow（商家按确认消费提现）',status:'waiting'}]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState<{token:string;escrow:string}>();
  const update=(index:number,next:Partial<Step>)=>setSteps(current=>current.map((step,i)=>i===index?{...step,...next}:step));
  async function connect(){
    setError('');
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
    setWallet(provider);setAccount(address);setChainId(Number(network.chainId));update(0,{status:'done'});
  }
  function validateAddress(value:string,label:string){if(!isAddress(value))throw new Error(`${label} 不是有效的以太坊地址。`);return getAddress(value);}
  async function deploy(){
    setError('');setDone(undefined);
    if(busy)return;
    try{
      if(!wallet||!account||chainId!==CHAIN_ID)throw new Error('请先连接指定 MetaMask 账户并切换到 Chain ID 677。');
      const a=validateAddress(memberA,'会员 A'),b=validateAddress(memberB,'会员 B'),p=validateAddress(payout,'收款账户');
      if(a.toLowerCase()===b.toLowerCase())throw new Error('会员 A 和会员 B 不能使用同一地址。');
      if(a.toLowerCase()===account.toLowerCase()||b.toLowerCase()===account.toLowerCase())throw new Error('会员地址不能与商家部署账户相同。');
      setBusy(true);update(1,{status:'running'});
      const signer=await wallet.getSigner(account);
      const token=await new ContractFactory(tokenArtifact.abi,tokenArtifact.bytecode,signer).deploy([a,b],[3000n,3000n]);
      update(1,{status:'running',hash:token.deploymentTransaction()?.hash});
      await token.waitForDeployment();
      const tokenAddress=await token.getAddress(),tokenHash=token.deploymentTransaction()?.hash;
      update(1,{status:'done',hash:tokenHash,address:tokenAddress});
      setSteps(current=>current.map((step,i)=>i===1?{...step,hash:tokenHash,address:tokenAddress}:step));
      update(2,{status:'running'});
      const escrow=await new ContractFactory(escrowArtifact.abi,escrowArtifact.bytecode,signer).deploy(tokenAddress,account,p);
      update(2,{status:'running',hash:escrow.deploymentTransaction()?.hash});
      await escrow.waitForDeployment();
      const escrowAddress=await escrow.getAddress(),escrowHash=escrow.deploymentTransaction()?.hash;
      update(2,{status:'done',hash:escrowHash,address:escrowAddress});
      setDone({token:tokenAddress,escrow:escrowAddress});
    }catch(error){
      const message=error instanceof Error?error.message:'部署失败';setError(message);
      setSteps(current=>current.map(step=>step.status==='running'?{...step,status:'error',error:message}:step));
    }finally{setBusy(false);}
  }
  const manifest=done?JSON.stringify({chainId:CHAIN_ID,network:'BOT Chain',rpcUrl:'https://rpc.botchain.ai',merchant:account,memberA,memberB,payout,token:done.token,escrow:done.escrow,links:{token:scan('address',done.token),escrow:scan('address',done.escrow)}},null,2):'';
  async function copy(){if(manifest)await navigator.clipboard.writeText(manifest);}
  return <div className="app-shell"><div className="main-shell" style={{marginLeft:0,width:'100%'}}><main><div className="page-heading"><div><span className="eyebrow">MetaMask 主网部署</span><h1>部署到 BOT Chain 677</h1><p>私钥留在 MetaMask；页面只提交你确认的交易。</p></div><a className="secondary" href="/analysis">返回调查页</a></div>
    <section className="card" style={{maxWidth:900,margin:'0 auto'}}>
      <div className="message"><strong>部署账户</strong><br/>必须是 <span className="mono">{EXPECTED}</span><br/>网络：BOT Chain · Chain ID 677 · <a href="https://scan.botchain.ai" target="_blank" rel="noreferrer">区块浏览器</a></div>
      <div className="buttons" style={{margin:'18px 0'}}><button className="primary" disabled={busy} onClick={()=>void connect().catch(e=>setError(e.message))}>{account?`已连接 ${account.slice(0,6)}…${account.slice(-4)}`:'连接 MetaMask 并切换主网'}</button>{chainId===CHAIN_ID&&<span className="subtle">网络已确认</span>}</div>
      <div className="forms stacked"><label>会员 A 钱包地址<input value={memberA} onChange={e=>setMemberA(e.target.value)} placeholder="0x…" disabled={busy}/></label><label>会员 B 钱包地址<input value={memberB} onChange={e=>setMemberB(e.target.value)} placeholder="0x…" disabled={busy}/></label><label>商家收款地址<input value={payout} onChange={e=>setPayout(e.target.value)} placeholder="默认使用指定账户" disabled={busy}/></label></div>
      <p className="muted">部署会铸造两份各 3,000 GYM 演示额度。GYM 是固定演示代币，不代表人民币，也不具备升值承诺。</p>
      {error&&<p className="error" role="alert">{error}</p>}
      <ol className="deploy-steps">{steps.map((step,i)=><li key={step.label} className={step.status}><span>{step.status==='done'?'✓':step.status==='running'?'…':step.status==='error'?'!':i+1}</span><div><strong>{step.label}</strong>{step.address&&<a className="block mono" href={scan('address',step.address)} target="_blank" rel="noreferrer">合约：{step.address}</a>}{step.hash&&<a className="block mono" href={scan('tx',step.hash)} target="_blank" rel="noreferrer">交易：{step.hash}</a>}{step.error&&<small className="error">{step.error}</small>}</div></li>)}</ol>
      <button className="primary full-width" disabled={busy||!account||chainId!==CHAIN_ID} onClick={()=>void deploy()}>{busy?'等待 MetaMask 确认…':'开始部署两个合约'}</button>
      {done&&<div className="message" style={{marginTop:20}}><strong>合约已部署</strong><p>先保存下面公开清单，再把合约地址用于后端同步。</p><button className="secondary" onClick={()=>void copy()}>复制部署清单</button><pre>{manifest}</pre></div>}
    </section><footer>主网交易不可逆，请逐笔核对 MetaMask 弹窗中的网络、合约和 Gas。</footer></main></div></div>;
}
