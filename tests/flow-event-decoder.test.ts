import assert from 'node:assert/strict';
import test from 'node:test';
import {Interface,ZeroAddress} from 'ethers';
import {decodeFlowTransfer} from '../server/flow-event-decoder.ts';
import {readJSON} from '../server/config.ts';

const token='0x0000000000000000000000000000000000000001';
const from='0x0000000000000000000000000000000000000002';
const to='0x0000000000000000000000000000000000000003';
const abi=readJSON('shared/artifacts/GymToken.json').abi;
const iface=new Interface(abi);
const encoded=iface.encodeEventLog(iface.getEvent('Transfer')!,[from,to,123n]);
const raw:any={address:token,topics:encoded.topics,data:encoded.data,blockNumber:'0x10',blockHash:'0x'+'a'.repeat(64),transactionHash:'0x'+'b'.repeat(64),transactionIndex:'0x2',logIndex:'0x3'};

test('RPC Transfer decoder returns normalized, exact chain fields',()=>{
  assert.deepEqual(decodeFlowTransfer(raw,token,abi),{from,to,amount:'123',blockNumber:16,blockHash:raw.blockHash,txHash:raw.transactionHash,transactionIndex:2,logIndex:3,token});
});

test('RPC Transfer decoder rejects removed logs, wrong token, and preserves mint logs for caller filtering',()=>{
  assert.equal(decodeFlowTransfer({...raw,removed:true},token,abi),null);
  assert.equal(decodeFlowTransfer(raw,'0x0000000000000000000000000000000000000004',abi),null);
  const mint=iface.encodeEventLog(iface.getEvent('Transfer')!,[ZeroAddress,to,123n]);
  assert.equal(decodeFlowTransfer({...raw,topics:mint.topics,data:mint.data},token,abi)?.from,ZeroAddress);
  assert.equal(decodeFlowTransfer({...raw,data:'0x00'},token,abi),null);
});
