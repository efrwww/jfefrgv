import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, parseUnits } from "ethers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const deployment = JSON.parse(fs.readFileSync(path.join(root, "deployments", "anvil.json"), "utf8"));
const provider = new JsonRpcProvider(deployment.rpcUrl);
const member = await provider.getSigner(2);
const merchant = await provider.getSigner(1);
const payout = await provider.getSigner(3);
const tokenAbi = JSON.parse(fs.readFileSync(path.join(root, deployment.contracts.DemoToken.abi), "utf8"));
const escrowAbi = JSON.parse(fs.readFileSync(path.join(root, deployment.contracts.PrepaidEscrow.abi), "utf8"));
const token = new Contract(deployment.contracts.DemoToken.address, tokenAbi, member);
const escrowForMember = new Contract(deployment.contracts.PrepaidEscrow.address, escrowAbi, member);
const escrowForMerchant = escrowForMember.connect(merchant);

await (await token.approve(escrowForMember.target, parseUnits("3000", 18))).wait();
const paymentTx = await escrowForMember.pay(1001, parseUnits("3000", 18));
const paymentReceipt = await paymentTx.wait();
const withdrawalTx = await escrowForMerchant.withdraw(parseUnits("1200", 18));
const withdrawalReceipt = await withdrawalTx.wait();
const balance = await token.balanceOf(escrowForMember.target);
const payoutBalance = await token.balanceOf(await payout.getAddress());

console.log(JSON.stringify({
  chainId: deployment.chainId,
  escrow: deployment.contracts.PrepaidEscrow.address,
  paymentTx: paymentReceipt.hash,
  withdrawalTx: withdrawalReceipt.hash,
  escrowBalance: balance.toString(),
  payoutBalance: payoutBalance.toString()
}, null, 2));
