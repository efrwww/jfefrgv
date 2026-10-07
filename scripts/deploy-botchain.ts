import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ContractFactory, Interface, Wallet, parseEther, keccak256, toUtf8Bytes } from 'ethers';
import { config, readJSON, writeJSON } from '../server/config.ts';
import { compile } from './compile.ts';

const chainId = Number(process.env.BOTCHAIN_CHAIN_ID || (process.env.BOTCHAIN_RPC_URL?.includes('bohr.life') ? '968' : '677'));
const rpcUrl = process.env.BOTCHAIN_RPC_URL || (chainId === 968 ? 'https://rpc.bohr.life' : config.botchainRpc);
const explorerBase = process.env.BOTCHAIN_EXPLORER_URL || (chainId === 968 ? 'https://scan.bohr.life' : 'https://scan.botchain.ai');
const walletFile = path.resolve('.runtime/botchain-wallet.json');
const execute = process.argv.includes('--execute');
const explorer = (kind: 'tx' | 'address', value: string) => `${explorerBase}/${kind}/${value}`;

type SavedWallet = { chainId: number; network: string; accounts: Record<string, { address: string; privateKey: string }> };

function ensureWallets(): SavedWallet {
  fs.mkdirSync(path.dirname(walletFile), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(walletFile)) {
    const accounts = Object.fromEntries(['merchant', 'userA', 'userB', 'payout', 'nextPayout'].map(role => {
      const w = Wallet.createRandom();
      return [role, { address: w.address, privateKey: w.privateKey }];
    }));
    fs.writeFileSync(walletFile, JSON.stringify({ chainId: 677, network: 'BOT Chain', accounts }, null, 2), { mode: 0o600, flag: 'wx' });
  }
  const saved = readJSON<SavedWallet>(walletFile);
  if (![677, 968].includes(saved.chainId)) throw new Error('botchain-wallet.json 的 Chain ID 不受支持');
  for (const role of ['merchant', 'userA', 'userB', 'payout', 'nextPayout']) if (!saved.accounts[role]) throw new Error(`缺少账户 ${role}`);
  return saved;
}

function rpcCall(method: string, params: unknown[] = []): any {
  const payload = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params })).toString('base64');
  const command = `$bytes=[Convert]::FromBase64String('${payload}');$body=[Text.Encoding]::UTF8.GetString($bytes);$res=Invoke-RestMethod -Uri '${rpcUrl}' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 120;$res|ConvertTo-Json -Compress`;
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const raw = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], { encoding: 'utf8', timeout: 130000, maxBuffer: 20 * 1024 * 1024 }).trim();
      const value = JSON.parse(raw);
      if (value.error) throw new Error(`${method} RPC error: ${JSON.stringify(value.error)}`);
      return value.result;
    } catch (error) {
      lastError = error;
      if (attempt < 4) execFileSync('powershell.exe', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 3'], { timeout: 10000 });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${method} RPC failed`);
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitReceipt(hash: string, label: string) {
  for (let i = 0; i < 60; i++) {
    const r = rpcCall('eth_getTransactionReceipt', [hash]);
    if (r) {
      if (r.status !== '0x1') throw new Error(`${label} 交易失败：${hash}`);
      return { label, hash, blockNumber: Number(BigInt(r.blockNumber)), gasUsed: BigInt(r.gasUsed).toString(), explorerUrl: explorer('tx', hash) };
    }
    await wait(2000);
  }
  throw new Error(`${label} 交易在等待预算内未确认：${hash}`);
}

async function send(wallet: Wallet, tx: { to?: string; data?: string; value?: bigint; gasLimit: bigint }, label: string) {
  const nonce = Number(BigInt(rpcCall('eth_getTransactionCount', [wallet.address, 'pending'])));
  const gasPrice = BigInt(rpcCall('eth_gasPrice', []));
  const raw = await wallet.signTransaction({ chainId, nonce, gasPrice, gasLimit: tx.gasLimit, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  const hash = rpcCall('eth_sendRawTransaction', [raw]);
  return waitReceipt(hash, label);
}

async function main() {
  const saved = ensureWallets();
  try {
    const actualChainId = Number(BigInt(rpcCall('eth_chainId')));
    if (actualChainId !== chainId) throw new Error(`RPC 网络不匹配：期望 ${chainId}，实际 ${actualChainId}`);
    compile();
    const tokenArtifact = readJSON<any>('shared/artifacts/GymToken.json');
    const escrowArtifact = readJSON<any>('shared/artifacts/GymEscrow.json');
    const merchant = new Wallet(saved.accounts.merchant.privateKey);
    const userA = new Wallet(saved.accounts.userA.privateKey);
    const userB = new Wallet(saved.accounts.userB.privateKey);
    const balances = Object.fromEntries(Object.entries(saved.accounts).map(([role, account]) => [role, BigInt(rpcCall('eth_getBalance', [account.address, 'latest'])).toString()]));
    const publicAccounts = Object.fromEntries(Object.entries(saved.accounts).map(([role, account]) => [role, account.address]));
    const plan = { chainId, network: chainId === 968 ? 'BOT Chain Test' : 'BOT Chain', rpcUrl, execute, merchant: merchant.address, accounts: publicAccounts, nativeBalancesWei: balances, generatedAt: new Date().toISOString(), links: { explorer: explorerBase, faucet: chainId === 968 ? 'https://faucet.bohr.life' : 'https://faucet.botchain.ai/zh/basic', rpc: rpcUrl } };
    writeJSON('artifacts/acceptance/botchain-deployment-plan.json', plan);
    console.log(JSON.stringify({ stage: 'preflight', ...plan, merchantExplorer: explorer('address', merchant.address) }));
    if (!execute) return;
    if (BigInt(balances.merchant) < parseEther('0.08')) throw new Error('部署账户 BOT 余额不足，至少准备 0.08 BOT 后再执行；未发送交易。');

    const transactions: any[] = [];
    const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, merchant);
    const tokenTx = await tokenFactory.getDeployTransaction([userA.address, userB.address, merchant.address], [30000, 30000, 30000]);
    const tokenReceipt = await send(merchant, { data: tokenTx.data as string, gasLimit: 1_500_000n }, 'deploy GymToken');
    const tokenCreation = rpcCall('eth_getTransactionReceipt', [tokenReceipt.hash]);
    const deployedToken = tokenCreation.contractAddress as string;
    if (!deployedToken) throw new Error('RPC 未返回 GYM Token 合约地址');
    const escrowFactory = new ContractFactory(escrowArtifact.abi, escrowArtifact.bytecode, merchant);
    const escrowTx = await escrowFactory.getDeployTransaction(deployedToken, merchant.address, saved.accounts.payout.address);
    const escrowReceipt = await send(merchant, { data: escrowTx.data as string, gasLimit: 2_800_000n }, 'deploy GymEscrow');
    const escrowCreation = rpcCall('eth_getTransactionReceipt', [escrowReceipt.hash]);
    const escrowAddress = escrowCreation.contractAddress as string;
    if (!escrowAddress) throw new Error('RPC 未返回 GymEscrow 合约地址');
    transactions.push(tokenReceipt, escrowReceipt);

    for (const [label, to] of [['fund userA', userA.address], ['fund userB', userB.address]] as const) {
      transactions.push(await send(merchant, { to, value: parseEther('0.01'), gasLimit: 21000n }, label));
    }

    const tokenIface = new Interface(tokenArtifact.abi), escrowIface = new Interface(escrowArtifact.abi);
    const tokenAmount = 3000n;
    transactions.push(await send(userA, { to: deployedToken, data: tokenIface.encodeFunctionData('approve', [escrowAddress, tokenAmount]), gasLimit: 100000n }, 'userA approve 3000 GYM'));
    transactions.push(await send(userA, { to: escrowAddress, data: escrowIface.encodeFunctionData('deposit', [tokenAmount]), gasLimit: 250000n }, 'userA deposit 3000 GYM'));
    const sessionKey = keccak256(toUtf8Bytes(`today-gym-botchain-${Date.now()}`));
    transactions.push(await send(merchant, { to: escrowAddress, data: escrowIface.encodeFunctionData('requestConsumption', [userA.address, sessionKey]), gasLimit: 300000n }, 'merchant request consumption'));
    const requestId = 1n;
    transactions.push(await send(userA, { to: escrowAddress, data: escrowIface.encodeFunctionData('confirmConsumption', [requestId]), gasLimit: 250000n }, 'userA confirm consumption'));
    transactions.push(await send(merchant, { to: escrowAddress, data: escrowIface.encodeFunctionData('withdraw', [30n]), gasLimit: 250000n }, 'merchant withdraw 30 GYM'));

    const tokenBalanceHex = rpcCall('eth_call', [{ to: deployedToken, data: tokenIface.encodeFunctionData('balanceOf', [escrowAddress]) }, 'latest']);
    const tokenBalance = BigInt(tokenBalanceHex);
    const proof = {
      chainId, network: chainId === 968 ? 'BOT Chain Test' : 'BOT Chain', rpcUrl, token: deployedToken, escrow: escrowAddress,
      accounts: { merchant: merchant.address, userA: userA.address, userB: userB.address, payout: saved.accounts.payout.address, nextPayout: saved.accounts.nextPayout.address },
      deploymentBlock: transactions[0].blockNumber, deploymentHash: transactions[0].hash, transactions,
      links: { token: explorer('address', deployedToken), escrow: explorer('address', escrowAddress), merchant: explorer('address', merchant.address), userA: explorer('address', userA.address), payout: explorer('address', saved.accounts.payout.address), scan: explorerBase, bridge: chainId === 968 ? 'https://bridge.bohr.life' : 'https://bridge.botchain.ai', dex: chainId === 968 ? 'https://dex.bohr.life' : 'https://dex.botchain.ai', wallet: chainId === 968 ? 'https://wallet.bohr.life' : 'https://wallet.botchain.ai', faucet: chainId === 968 ? 'https://faucet.bohr.life' : 'https://faucet.botchain.ai/zh/basic' },
      verification: { tokenEscrowBalance: tokenBalance.toString(), consumedAmount: '30', merchantWithdrawn: '30', sessionKey, requestId: requestId.toString() },
      completedAt: new Date().toISOString()
    };
    writeJSON('artifacts/acceptance/botchain-deployment-proof.json', proof);
    writeJSON('data/deployments/botchain.json', { id: `botchain-${escrowAddress.toLowerCase()}`, chainId, dataOrigin: 'public-testnet', adapter: 'gym', name: chainId === 968 ? 'BOT Chain Test 健身房演示' : 'BOT Chain 健身房演示', token: deployedToken, escrow: escrowAddress, merchant: merchant.address, payout: saved.accounts.payout.address, nextPayout: saved.accounts.nextPayout.address, users: [userA.address, userB.address], tokenSymbol: 'GYM', decimals: 0, deploymentBlock: proof.deploymentBlock, deploymentHash: proof.deploymentHash, links: proof.links });
    writeJSON('data/flow/deployment-botchain.json', { id: `botchain-${escrowAddress.toLowerCase()}`, chainId, dataOrigin: 'public-testnet', token: deployedToken, escrow: escrowAddress, tokenSymbol: 'GYM', decimals: 0, deploymentBlock: proof.deploymentBlock, deploymentHash: proof.deploymentHash, accounts: { merchant: merchant.address, userA: userA.address, userB: userB.address, payout: saved.accounts.payout.address, nextPayout: saved.accounts.nextPayout.address } });
    console.log(JSON.stringify({ deployed: true, ...proof }));
  } finally { }
}

await main();
