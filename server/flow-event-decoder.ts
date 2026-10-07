import {Interface,getAddress} from 'ethers';
import type {RawLog} from './rpc.ts';

export type DecodedFlowTransfer={
  from:string;
  to:string;
  amount:string;
  blockNumber:number;
  blockHash:string;
  txHash:string;
  transactionIndex:number;
  logIndex:number;
  token:string;
};

/**
 * Decode one ERC-20 Transfer log returned by eth_getLogs.
 * The decoder is deliberately strict: malformed logs are ignored by the
 * caller instead of becoming synthetic ledger entries or agent evidence.
 */
export function decodeFlowTransfer(log:RawLog,token:string,abi:unknown[]):DecodedFlowTransfer|null{
  if(log.removed||log.address.toLowerCase()!==token.toLowerCase())return null;
  let parsed;
  try{parsed=new Interface(abi as any).parseLog(log as any);}catch{return null;}
  if(!parsed||parsed.name!=='Transfer')return null;
  const from=getAddress(String(parsed.args.from)),to=getAddress(String(parsed.args.to));
  return {
    from,
    to,
    amount:String(parsed.args.value),
    blockNumber:Number(BigInt(log.blockNumber)),
    blockHash:log.blockHash,
    txHash:log.transactionHash,
    transactionIndex:Number(BigInt(log.transactionIndex)),
    logIndex:Number(BigInt(log.logIndex)),
    token:getAddress(token),
  };
}
