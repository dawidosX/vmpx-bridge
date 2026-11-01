// Builds a minimal Hyperlane agent config for sepolia + x1testnet.
// Field names follow hyperlane-monorepo rust/main/config/testnet_config.json (solanatestnet / sepolia entries).
import fs from "node:fs";
const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith("--") && acc.push([v.slice(2), arr[i + 1]]), acc), []));
const yaml = (p) => Object.fromEntries(fs.readFileSync(p, "utf8").split("\n").filter((l) => /^\w+:\s*\S/.test(l)).map((l) => { const [k, ...v] = l.split(":"); return [k.trim(), v.join(":").trim().replace(/"/g, "")]; }));
const sa = yaml(`${a.registry}/chains/sepolia/addresses.yaml`);
const cfg = {
  chains: {
    sepolia: {
      name: "sepolia", domainId: 11155111, chainId: 11155111, protocol: "ethereum", isTestnet: true,
      rpcUrls: [{ http: a["sepolia-rpc"] }],
      // relayer waits as long as the validators that sign this origin (upstream registry): Sepolia 2 blocks,
      // Ethereum mainnet 15. Waiting longer ("finalized") adds ~13 min for users and no safety: process() is
      // permissionless, so reorg safety rests on the validators' reorgPeriod alone (docs/03, "Finalność").
      blocks: { confirmations: 1, estimateBlockTime: 13, reorgPeriod: 2 },
      nativeToken: { decimals: 18, name: "Ether", symbol: "ETH" },
      mailbox: sa.mailbox, merkleTreeHook: sa.merkleTreeHook, validatorAnnounce: sa.validatorAnnounce,
      interchainGasPaymaster: sa.interchainGasPaymaster,
      index: { from: Number(a["sepolia-from"]) },
    },
    x1testnet: {
      name: "x1testnet", domainId: 1479626325, chainId: 1479626325, protocol: "sealevel", isTestnet: true,
      rpcUrls: [{ http: a["x1-rpc"] }],
      blocks: { confirmations: 1, estimateBlockTime: 0.4, reorgPeriod: 0 },
      nativeToken: { decimals: 9, name: "XNT", symbol: "XNT", denom: "lamport" },
      mailbox: a["x1-mailbox"], merkleTreeHook: a["x1-mailbox"], validatorAnnounce: a["x1-va"],
      interchainGasPaymaster: a["x1-igp"],
      // sequence mode: "from" is the LOWEST SEQUENCE indexed (not a slot). A fresh deploy has messages and IGP
      // payments from sequence 0; upstream solanatestnet uses 1 only because its history is long.
      index: { from: 0, mode: "sequence", chunk: 20 },
      maxSupportedTransactionVersion: 1,
    },
  },
  defaultRpcConsensusType: "fallback",
};
process.stdout.write(JSON.stringify(cfg, null, 2) + "\n");
