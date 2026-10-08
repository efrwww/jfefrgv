import fs from 'node:fs';
import {Contract,JsonRpcProvider,getAddress,keccak256} from 'ethers';
import {readJSON,writeJSON} from '../server/config.ts';

const chainId=677;
const rpcUrl='https://rpc.botchain.ai';
const expectedMerchant=getAddress('0x295DF8b1d573c8332170d03437ddaf36411a29eb');
const manifestPath=process.argv[2]||'artifacts/acceptance/botchain-mainnet-manifest.json';
type Manifest={chainId:number;dataOrigin:string;token:string;escrow:string;tokenSymbol:string;decimals:number;deploymentBlock:number;deploymentHash:string;escrowDeploymentHash:string;accounts:{merchant:string;userA:string;userB:string;payout:string;nextPayout:string}};

function same(a:string,b:string){return a.toLowerCase()===b.toLowerCase();}
function hash(value:string,label:string){if(!/^0x[0-9a-fA-F]{64}$/.test(value))throw new Error(`${label} 格式无效。`);return value;}

async function main(){
  if(!fs.existsSync(manifestPath))throw new Error(`找不到部署清单：${manifestPath}`);
  const m=readJSON<Manifest>(manifestPath);
  if(m.chainId!==chainId||m.dataOrigin!=='public-mainnet')throw new Error('部署清单不是 BOT Chain 677 主网。');
  if(m.tokenSymbol!=='GYM'||m.decimals!==0)throw new Error('仅支持当前 GYM 演示代币参数。');
  const tokenAddress=getAddress(m.token),escrowAddress=getAddress(m.escrow),merchant=getAddress(m.accounts.merchant),userA=getAddress(m.accounts.userA),userB=getAddress(m.accounts.userB),payout=getAddress(m.accounts.payout),nextPayout=getAddress(m.accounts.nextPayout);
  if(!same(merchant,expectedMerchant))throw new Error(`商家/部署账户必须为 ${expectedMerchant}。`);
  if(same(userA,userB)||[userA,userB].some(a=>same(a,merchant)))throw new Error('会员账户必须彼此不同，且不能与商家账户相同。');
  const tokenHash=hash(m.deploymentHash,'Token 部署交易哈希'),escrowHash=hash(m.escrowDeploymentHash,'Escrow 部署交易哈希');
  const p=new JsonRpcProvider(rpcUrl,chainId,{staticNetwork:true,cacheTimeout:-1});
  try{
    const actualChain=Number(BigInt(await p.send('eth_chainId',[])));
    if(actualChain!==chainId)throw new Error(`BOT Chain RPC 返回 Chain ID ${actualChain}，预期 ${chainId}。`);
    const [tokenReceipt,escrowReceipt,tokenCode,escrowCode]=await Promise.all([p.getTransactionReceipt(tokenHash),p.getTransactionReceipt(escrowHash),p.getCode(tokenAddress),p.getCode(escrowAddress)]);
    if(!tokenReceipt||tokenReceipt.status!==1||!same(tokenReceipt.contractAddress||'0x0000000000000000000000000000000000000000',tokenAddress))throw new Error('GYM Token 部署收据无效。');
    if(!escrowReceipt||escrowReceipt.status!==1||!same(escrowReceipt.contractAddress||'0x0000000000000000000000000000000000000000',escrowAddress))throw new Error('GymEscrow 部署收据无效。');
    const tokenArtifact=readJSON<any>('shared/artifacts/GymToken.json'),escrowArtifact=readJSON<any>('shared/artifacts/GymEscrow.json');
    if(tokenCode==='0x'||keccak256(tokenCode)!==keccak256(tokenArtifact.deployedBytecode))throw new Error('GYM Token 主网运行时代码与仓库编译产物不匹配。');
    if(escrowCode==='0x'||keccak256(escrowCode)!==keccak256(escrowArtifact.deployedBytecode))throw new Error('GymEscrow 主网运行时代码与仓库编译产物不匹配。');
    const token=new Contract(tokenAddress,tokenArtifact.abi,p),escrow=new Contract(escrowAddress,escrowArtifact.abi,p);
    const [symbol,decimals,totalSupply,balanceA,balanceB,boundToken,boundMerchant,boundPayout]=await Promise.all([token.symbol(),token.decimals(),token.totalSupply(),token.balanceOf(userA),token.balanceOf(userB),escrow.token(),escrow.merchant(),escrow.payoutAddress()]);
    if(symbol!=='GYM'||Number(decimals)!==0||totalSupply!==6000n||balanceA!==3000n||balanceB!==3000n)throw new Error('GYM Token 名称、精度、总量或会员初始额度不符合部署预期。');
    if(!same(boundToken,tokenAddress)||!same(boundMerchant,merchant)||!same(boundPayout,payout))throw new Error('GymEscrow 构造参数与部署清单不一致。');
    const id=`botchain-${escrowAddress.toLowerCase()}`;
    const links={token:`https://scan.botchain.ai/address/${tokenAddress}`,escrow:`https://scan.botchain.ai/address/${escrowAddress}`,tokenDeployment:`https://scan.botchain.ai/tx/${tokenHash}`,escrowDeployment:`https://scan.botchain.ai/tx/${escrowHash}`};
    const flow={id,chainId,dataOrigin:'public-mainnet' as const,token:tokenAddress,escrow:escrowAddress,tokenSymbol:'GYM',decimals:0,deploymentBlock:tokenReceipt.blockNumber,deploymentHash:tokenHash,accounts:{merchant,userA,userB,payout,nextPayout}};
    const dataset={...flow,adapter:'gym',name:'BOT Chain 677 健身房主网演示',users:[userA,userB],links};
    writeJSON('data/flow/deployment-botchain-677.json',flow);
    writeJSON('data/deployments/botchain-677.json',dataset);
    console.log(JSON.stringify({activated:true,chainId,token:tokenAddress,escrow:escrowAddress,deploymentBlock:tokenReceipt.blockNumber,merchant,memberA:userA,memberB:userB,payout,files:['data/flow/deployment-botchain-677.json','data/deployments/botchain-677.json'],links},null,2));
  }finally{p.destroy();}
}

await main();
