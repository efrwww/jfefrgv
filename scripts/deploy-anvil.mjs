import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ContractFactory, JsonRpcProvider, parseUnits } from "ethers";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
const provider = new JsonRpcProvider(rpcUrl);
const network = await provider.getNetwork();
const deployer = await provider.getSigner(0);
const merchant = await provider.getSigner(1);
const payout = await provider.getSigner(3);
const deployerAddress = await deployer.getAddress();
const merchantAddress = await merchant.getAddress();
const payoutAddress = await payout.getAddress();

function artifact(name) {
  return JSON.parse(fs.readFileSync(path.join(root, "artifacts", `${name}.json`), "utf8"));
}

const tokenArtifact = artifact("DemoToken");
const escrowArtifact = artifact("PrepaidEscrow");
const tokenFactory = new ContractFactory(tokenArtifact.abi, tokenArtifact.bytecode, deployer);
const token = await tokenFactory.deploy(deployerAddress, parseUnits("1000000", 18));
await token.waitForDeployment();

const escrowFactory = new ContractFactory(escrowArtifact.abi, escrowArtifact.bytecode, deployer);
const escrow = await escrowFactory.deploy(token.target, merchantAddress, payoutAddress);
await escrow.waitForDeployment();

const member1 = await provider.getSigner(2);
const member1Address = await member1.getAddress();
const member2 = await provider.getSigner(4);
const member2Address = await member2.getAddress();
await (await token.mint(member1Address, parseUnits("10000", 18))).wait();
await (await token.mint(member2Address, parseUnits("10000", 18))).wait();

const deployment = {
  chainId: Number(network.chainId),
  network: "anvil",
  rpcUrl,
  deployedAt: new Date().toISOString(),
  deployer: deployerAddress,
  merchant: merchantAddress,
  payoutAddress,
  accounts: {
    member1: member1Address,
    member2: member2Address
  },
  contracts: {
    DemoToken: {
      address: token.target,
      abi: "abi/DemoToken.json",
      decimals: 18
    },
    PrepaidEscrow: {
      address: escrow.target,
      abi: "abi/PrepaidEscrow.json"
    }
  }
};

fs.mkdirSync(path.join(root, "deployments"), { recursive: true });
fs.writeFileSync(
  path.join(root, "deployments", "anvil.json"),
  `${JSON.stringify(deployment, null, 2)}\n`
);
console.log(JSON.stringify(deployment, null, 2));
