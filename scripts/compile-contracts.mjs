import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sources = {};
for (const file of ["DemoToken.sol", "PrepaidEscrow.sol"]) {
  const sourcePath = path.join(root, "contracts", file);
  sources[`contracts/${file}`] = { content: fs.readFileSync(sourcePath, "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } }
  }
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter((item) => item.severity === "error");
if (errors.length) {
  for (const error of errors) console.error(error.formattedMessage);
  process.exit(1);
}

fs.mkdirSync(path.join(root, "abi"), { recursive: true });
fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
for (const [sourceName, contracts] of Object.entries(output.contracts || {})) {
  for (const [contractName, artifact] of Object.entries(contracts)) {
    if (!artifact.evm?.bytecode?.object) continue;
    const value = {
      contractName,
      sourceName,
      abi: artifact.abi,
      bytecode: `0x${artifact.evm.bytecode.object}`
    };
    fs.writeFileSync(
      path.join(root, "abi", `${contractName}.json`),
      `${JSON.stringify(value.abi, null, 2)}\n`
    );
    fs.writeFileSync(
      path.join(root, "artifacts", `${contractName}.json`),
      `${JSON.stringify(value, null, 2)}\n`
    );
    console.log(`compiled ${contractName}`);
  }
}
