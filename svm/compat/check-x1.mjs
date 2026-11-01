#!/usr/bin/env node
// X1 compatibility & post-deploy verification. No dependencies (Node >= 18).
//
//   node check-x1.mjs --rpc https://rpc.testnet.x1.xyz
//   node check-x1.mjs --rpc <url> --post-deploy --mint <MINT> --program <TOKEN_PROGRAM_ID> \
//        --mailbox <MAILBOX_PROGRAM_ID> --expect-upgrade-authority <SQUADS_VAULT|none> \
//        --expect-metadata-authority <SQUADS_VAULT> --expect-owner <SQUADS_VAULT> --expect-ism <ISM_PROGRAM_ID> \
//        --expect-router <ETH_DOMAIN>:<LOCKBOX 0x…> --expect-validators <0x…,0x…> --expect-threshold <N> \
//        --expect-igp-beneficiary <PUBKEY> [--token-pda <STORAGE_PDA>] [--mainnet --deployer <DEPLOYER_PUBKEY>]
//
// --expect-owner is the X1 owner (one entity, e.g. the Squads vault). It must own: the token configuration, the
// mailbox outbox, the multisig ISM (validators and threshold) and the IGP / overhead IGP. The token storage PDA is
// derived from its seeds; --token-pda, if given, must match. --mainnet --deployer <key> fails if the deployer
// still holds any checked authority or is used as an expectation.
//
// Every check prints PASS / FAIL / WARN with the raw value. Exit code 1 on any FAIL.
// --post-deploy is an ACCEPTANCE check and fails closed (Codex M-02): every expectation above is required, a missing
// expectation or a value that cannot be resolved is a FAIL, never a WARN. "none" = immutable (no upgrade authority).
// Nothing here signs or sends transactions.

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith("--")) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true]);
    return acc;
  }, [])
);
const RPC = args.rpc || "https://rpc.testnet.x1.xyz";

// Program IDs to probe. Sources & status in docs/01-feasibility.md.
const PROGRAMS = {
  "SPL Token": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "SPL Token-2022": "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  "Associated Token Account": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
  "Metaplex Token Metadata (x1-labs fork id)": "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
  "Squads v4 (upstream id)": "SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf",
  "Squads v4 (X1 explorer id)": "DDL3Xp6ie85DXgiPkXJ7abUyS2tGv4CGEod2DeQXQ941",
  "XDEX AMM (explorer/IDL id)": "7EEuq61z9VKdkUzj7G36xGd7ncyz8KBtUwAWVjypYQHf",
  "XDEX AMM (getting-started id)": "sEsYH97wqmfnkzHedjNcw3zyJdPvUmsa9AixhS4b4fN",
};
const WXNT = "So11111111111111111111111111111111111111112";

let failures = 0;
const out = (status, name, detail) => {
  if (status === "FAIL") failures++;
  console.log(`${status.padEnd(4)}  ${name}${detail !== undefined ? "  ->  " + JSON.stringify(detail) : ""}`);
};

// Public X1 RPC sits behind a load balancer: a backend sometimes answers with an HTML error page (not JSON),
// and backends lag each other. So: retry non-JSON / HTTP errors, and read accounts at "finalized" commitment.
async function rpc(method, params = [], tries = 3) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      const text = await r.text();
      let j;
      try { j = JSON.parse(text); } catch { throw new Error(`${method}: HTTP ${r.status}, non-JSON reply: ${text.slice(0, 80)}`); }
      if (j.error) throw Object.assign(new Error(`${method}: ${JSON.stringify(j.error)}`), { final: true });
      return j.result;
    } catch (e) {
      if (e.final || i >= tries) throw e;
      console.log(`WARN  ${String(e.message || e).slice(0, 120)}  (retry ${i}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
}
const FIN = { commitment: "finalized" };

async function preDeploy() {
  console.log(`# X1 compatibility check @ ${RPC}  (${new Date().toISOString()})`);
  out("INFO", "genesisHash", await rpc("getGenesisHash"));
  const v = await rpc("getVersion");
  out(/^4\./.test(v["solana-core"]) ? "PASS" : "WARN", "node version (expect Tachyon 4.x)", v);
  const s1 = await rpc("getSlot", [{ commitment: "finalized" }]);
  await new Promise((r) => setTimeout(r, 4000));
  const s2 = await rpc("getSlot", [{ commitment: "finalized" }]);
  out(s2 > s1 ? "PASS" : "FAIL", "finalized slot advances", { s1, s2 });
  const va = await rpc("getVoteAccounts");
  out("INFO", "vote accounts (current/delinquent)", { current: va.current.length, delinquent: va.delinquent.length });

  for (const [name, id] of Object.entries(PROGRAMS)) {
    const acc = await rpc("getAccountInfo", [id, { encoding: "base64", ...FIN }]);
    const ok = acc.value && acc.value.executable;
    const critical = /Token|Associated/.test(name);
    out(ok ? "PASS" : critical ? "FAIL" : "WARN", `program ${name}`, ok ? { owner: acc.value.owner } : "missing / not executable");
  }
  const w = await rpc("getAccountInfo", [WXNT, { encoding: "jsonParsed", ...FIN }]);
  out(w.value ? "PASS" : "FAIL", "WXNT native mint", w.value?.data?.parsed?.info ?? null);

  const fees = await rpc("getRecentPrioritizationFees", []);
  out("INFO", "recent prioritization fee samples", fees.slice(-3));
}

import { createHash } from "node:crypto";
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58dec = (s) => { let n = 0n; for (const c of s) { const i = B58.indexOf(c); if (i < 0) throw new Error("bad base58 " + s); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; } for (const c of s) { if (c !== "1") break; out.unshift(0); }
  return Uint8Array.from(out); };
// ed25519 point decompression check (RFC 8032 5.1.3): a PDA must NOT be a valid curve point
const P25519 = 2n ** 255n - 19n, D25519 = (((-121665n * modpow(121666n, P25519 - 2n, P25519)) % P25519) + P25519) % P25519;
function modpow(b, e, m) { let r = 1n; b %= m; if (b < 0n) b += m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function onCurve(bytes) {
  const y = BigInt("0x" + Buffer.from(Uint8Array.from(bytes).reverse()).toString("hex")) & ((1n << 255n) - 1n);
  if (y >= P25519) return false;
  const y2 = (y * y) % P25519, u = (y2 - 1n + P25519) % P25519, v = (D25519 * y2 + 1n) % P25519;
  const x = (u * modpow(v, 3n, P25519) % P25519) * modpow(u * modpow(v, 7n, P25519) % P25519, (P25519 - 5n) / 8n, P25519) % P25519;
  const vx2 = (v * x % P25519) * x % P25519;
  return vx2 === u || vx2 === (P25519 - u) % P25519;
}
function findPda(seeds, programId) {
  const prog = b58dec(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = createHash("sha256");
    for (const sd of seeds) h.update(typeof sd === "string" ? Buffer.from(sd) : Buffer.from(sd));
    h.update(Buffer.from([bump])); h.update(Buffer.from(prog)); h.update(Buffer.from("ProgramDerivedAddress"));
    const d = h.digest();
    if (!onCurve(d)) return b58(d);
  }
  throw new Error("no PDA");
}
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const b58 = (u8) => { let n = 0n; for (const x of u8) n = n * 256n + BigInt(x); let s = ""; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const x of u8) { if (x !== 0) break; s = "1" + s; } return s; };
// fail-closed comparison: a missing expectation or an unresolved actual value is a FAIL
const seenAuthorities = [];
function expectEq(name, actual, flag) {
  const exp = args[flag];
  seenAuthorities.push([name, actual, exp]);
  if (exp === undefined || exp === true) return out("FAIL", `${name}: missing --${flag} (acceptance check fails closed)`, actual);
  const want = exp === "none" ? null : exp;
  out(actual === undefined ? "FAIL" : actual === want ? "PASS" : "FAIL", name, { actual, expected: want });
}
async function upgradeAuthority(programId) {
  const p = await rpc("getAccountInfo", [programId, { encoding: "jsonParsed", ...FIN }]);
  const pd = p.value?.data?.parsed?.info?.programData;
  if (!pd) return undefined;
  const a = await rpc("getAccountInfo", [pd, { encoding: "jsonParsed", ...FIN }]);
  const info = a.value?.data?.parsed?.info;
  return info ? (info.authority ?? null) : undefined;
}
// HyperlaneToken storage (hyperlane-sealevel-token, f556e18): AccountData { initialized u8, bump u8, mailbox 32,
// mailbox_process_authority 32, dispatch_authority_bump u8, decimals u8, remote_decimals u8, owner Option<Pubkey>,
// interchain_security_module Option<Pubkey>, interchain_gas_paymaster Option<(Pubkey, enum{Igp|OverheadIgp}(Pubkey))>,
// destination_gas HashMap<u32,u64>, remote_routers HashMap<u32,H256>, plugin_data … }
function parseTokenStorage(d) {
  let o = 69; const opt = () => (d[o] === 1 ? (o += 33, b58(d.subarray(o - 32, o))) : (o += 1, null));
  const r = { initialized: d[0], mailbox: b58(d.subarray(2, 34)), decimals: d[67], remoteDecimals: d[68] };
  r.owner = opt(); r.ism = opt();
  if (d[o] === 1) { r.igp = { program: b58(d.subarray(o + 1, o + 33)), kind: d[o + 33], account: b58(d.subarray(o + 34, o + 66)) }; o += 1 + 32 + 1 + 32; }
  else { r.igp = null; o += 1; }
  const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
  const ng = dv.getUint32(o, true); o += 4 + 12 * ng;
  const nr = dv.getUint32(o, true); o += 4; r.routers = {};
  for (let i = 0; i < nr; i++) { r.routers[dv.getUint32(o, true)] = "0x" + Buffer.from(d.subarray(o + 4, o + 36)).toString("hex"); o += 36; }
  return r;
}

async function postDeploy() {
  const mint = args.mint, program = args.program;
  if (!mint || !program) throw new Error("--mint and --program required for --post-deploy");
  if (!args.mailbox || args.mailbox === true) out("FAIL", "missing --mailbox (acceptance check fails closed)");
  if (args.mainnet && (!args.deployer || args.deployer === true)) out("FAIL", "--mainnet needs --deployer <pubkey> (the key that must hold nothing)");
  const m = await rpc("getAccountInfo", [mint, { encoding: "jsonParsed", ...FIN }]);
  const info = m.value?.data?.parsed?.info;
  if (!info) return out("FAIL", "mint account parse", m.value);
  out(m.value.owner === PROGRAMS["SPL Token-2022"] ? "PASS" : "FAIL", "mint owned by Token-2022", m.value.owner);
  // Codex round 3, R-06: --mint must be THE mint of this token program (upstream plugin.rs: hyperlane_token-mint)
  const mintPda = findPda(["hyperlane_token", "-", "mint"], program);
  out(mint === mintPda ? "PASS" : "FAIL", "mint is the mint PDA of the token program", { given: mint, derived: mintPda });
  out(info.decimals === 9 ? "PASS" : "FAIL", "decimals == 9", info.decimals);
  // hyperlane-sealevel-token: the mint PDA is its own mint authority
  out(info.mintAuthority === mint ? "PASS" : "FAIL", "mint authority == mint PDA (program-only minting)", info.mintAuthority);
  out(info.freezeAuthority == null ? "PASS" : "FAIL", "freeze authority == none", info.freezeAuthority);
  out("INFO", "supply (9-dec units)", info.supply);
  const ext = info.extensions || [];
  const md = ext.find((e) => e.extension === "tokenMetadata")?.state;
  if (md) {
    out("INFO", "metadata", { name: md.name, symbol: md.symbol, uri: md.uri });
    expectEq("metadata update authority", md.updateAuthority ?? null, "expect-metadata-authority");
  } else out("FAIL", "tokenMetadata extension not found", ext.map((e) => e.extension));
  const unexpected = ext.filter((e) => !["metadataPointer", "tokenMetadata"].includes(e.extension));
  out(unexpected.length ? "FAIL" : "PASS", "no unexpected Token-2022 extensions (fees/hooks/permanent delegate)", unexpected.map((e) => e.extension));

  expectEq("token program upgrade authority", await upgradeAuthority(program), "expect-upgrade-authority");

  // token configuration (owner changes ISM and routers), ISM and enrolled router; storage PDA derived from its seeds
  const tp = findPda(["hyperlane_message_recipient", "-", "handle", "-", "account_metas"], program);
  if (args["token-pda"] && args["token-pda"] !== true) out(args["token-pda"] === tp ? "PASS" : "FAIL", "token storage PDA matches its seeds", { derived: tp, given: args["token-pda"] });
  {
    const a = await rpc("getAccountInfo", [tp, { encoding: "base64", ...FIN }]);
    if (!a.value) out("FAIL", "token storage PDA not found", tp);
    else {
      out(a.value.owner === program ? "PASS" : "FAIL", "token storage owned by the token program", a.value.owner);
      const t = parseTokenStorage(Buffer.from(a.value.data[0], "base64"));
      out(t.initialized === 1 && t.decimals === 9 && t.remoteDecimals === 18 ? "PASS" : "FAIL", "token storage initialized, 9 / 18 decimals", t);
      if (args.mailbox && args.mailbox !== true) out(t.mailbox === args.mailbox ? "PASS" : "FAIL", "token mailbox", { actual: t.mailbox, expected: args.mailbox });
      expectEq("token config owner (sets ISM and routers)", t.owner, "expect-owner");
      expectEq("token ISM", t.ism, "expect-ism");
      const er = args["expect-router"];
      if (!er || er === true) out("FAIL", "missing --expect-router <domain>:<0x…> (acceptance check fails closed)", t.routers);
      else {
        const [dom, addr] = er.split(":"); const want = "0x" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
        out(t.routers[dom] === want && Object.keys(t.routers).length === 1 ? "PASS" : "FAIL", "enrolled remote router (only this one)", { actual: t.routers, expected: { [dom]: want } });
      }
      if (t.ism) {
        expectEq("ISM program upgrade authority", await upgradeAuthority(t.ism), "expect-upgrade-authority");
        await checkMultisigIsm(t.ism, Number((args["expect-router"] || "").split(":")[0]));
      }
      await checkIgp(t.igp);
    }
  }
  if (args.mailbox && args.mailbox !== true) {
    expectEq("mailbox program upgrade authority", await upgradeAuthority(args.mailbox), "expect-upgrade-authority");
    // Outbox: initialized u8, local_domain u32, outbox_bump u8, owner Option<Pubkey>, … (owner sets the protocol fee)
    const ob = findPda(["hyperlane", "-", "outbox"], args.mailbox);
    const a = await rpc("getAccountInfo", [ob, { encoding: "base64", ...FIN }]);
    if (!a.value) out("FAIL", "mailbox outbox PDA not found", ob);
    else { const d = Buffer.from(a.value.data[0], "base64"); const o = 1 + 4 + 1;
      expectEq("mailbox owner (outbox)", d[o] === 1 ? b58(d.subarray(o + 1, o + 33)) : null, "expect-owner"); }
  }
  if (args.mainnet) {
    const dep = args.deployer;
    const held = seenAuthorities.filter(([, actual]) => actual === dep).map(([n]) => n);
    const asExp = seenAuthorities.filter(([, , exp]) => exp === dep).map(([n]) => n);
    out(dep && dep !== true && !held.length ? "PASS" : "FAIL", "mainnet: deployer holds no authority", held);
    out(dep && dep !== true && !asExp.length ? "PASS" : "FAIL", "mainnet: deployer is not used as an expected authority", asExp);
  }
}

// multisig-ism-message-id: AccessControl PDA (owner) and DomainData PDA for the origin domain (validators, threshold)
async function checkMultisigIsm(ism, domain) {
  const ac = findPda(["multisig_ism_message_id", "-", "access_control"], ism);
  const a = await rpc("getAccountInfo", [ac, { encoding: "base64", ...FIN }]);
  if (!a.value) return out("FAIL", "ISM access control PDA not found", ac);
  const d = Buffer.from(a.value.data[0], "base64");   // initialized u8, bump u8, owner Option<Pubkey>
  expectEq("ISM owner (sets validators and threshold)", d[2] === 1 ? b58(d.subarray(3, 35)) : null, "expect-owner");
  if (!domain) return out("FAIL", "ISM validators: origin domain unknown (needs --expect-router <domain>:…)");
  const dd = findPda(["multisig_ism_message_id", "-", u32le(domain), "-", "domain_data"], ism);
  const b = await rpc("getAccountInfo", [dd, { encoding: "base64", ...FIN }]);
  if (!b.value) return out("FAIL", `ISM domain data for ${domain} not found`, dd);
  const x = Buffer.from(b.value.data[0], "base64");   // initialized u8, bump u8, Vec<H160> (u32 len + 20*n), threshold u8
  const n = x.readUInt32LE(2); const vals = [];
  for (let i = 0; i < n; i++) vals.push("0x" + x.subarray(6 + 20 * i, 26 + 20 * i).toString("hex"));
  const thr = x[6 + 20 * n];
  const ev = args["expect-validators"], et = args["expect-threshold"];
  if (!ev || ev === true) out("FAIL", "ISM validators: missing --expect-validators (acceptance check fails closed)", vals);
  else { const want = ev.split(",").map((v) => v.trim().toLowerCase()).sort(); const got = vals.map((v) => v.toLowerCase()).sort();
    out(JSON.stringify(want) === JSON.stringify(got) ? "PASS" : "FAIL", `ISM validators for domain ${domain}`, { actual: got, expected: want }); }
  if (!et || et === true) out("FAIL", "ISM threshold: missing --expect-threshold (acceptance check fails closed)", thr);
  else out(Number(et) === thr ? "PASS" : "FAIL", `ISM threshold for domain ${domain}`, { actual: thr, expected: Number(et) });
}

// IGP: token config -> (igp program, Igp | OverheadIgp account). IGP program accounts are discriminator-prefixed:
// initialized u8, discriminator [u8; 8], then Igp { bump, salt 32, owner Option, beneficiary 32, … } or
// OverheadIgp { bump, salt 32, owner Option, inner 32 (the Igp), … }
async function checkIgp(igp) {
  if (!igp) return out("FAIL", "token has no IGP configured (delivery gas is not paid)");
  const read = async (acc) => { const a = await rpc("getAccountInfo", [acc, { encoding: "base64", ...FIN }]); return a.value; };
  const parse = (d) => { let o = 1 + 8 + 1 + 32; const owner = d[o] === 1 ? b58(d.subarray(o + 1, o + 33)) : null; o += d[o] === 1 ? 33 : 1; return { owner, next: b58(d.subarray(o, o + 32)) }; };
  let acc = igp.account;
  const first = await read(acc);
  if (!first) return out("FAIL", "IGP account not found", acc);
  out(first.owner === igp.program ? "PASS" : "FAIL", "IGP account owned by the IGP program", first.owner);
  let x = parse(Buffer.from(first.data[0], "base64"));
  if (igp.kind === 1) {   // OverheadIgp -> inner Igp
    expectEq("overhead IGP owner", x.owner, "expect-owner");
    acc = x.next; const inner = await read(acc);
    if (!inner) return out("FAIL", "inner IGP account not found", acc);
    out(inner.owner === igp.program ? "PASS" : "FAIL", "inner IGP account owned by the IGP program", inner.owner);
    x = parse(Buffer.from(inner.data[0], "base64"));
  }
  expectEq("IGP owner (gas oracles, overheads)", x.owner, "expect-owner");
  expectEq("IGP beneficiary (receives the gas payments)", x.next, "expect-igp-beneficiary");
  // Codex round 3, R-06: the IGP program runs inside every transfer (CPI with the payer): its code must be as
  // locked down as the token, mailbox and ISM programs
  expectEq("IGP program upgrade authority", await upgradeAuthority(igp.program), "expect-upgrade-authority");
}

try {
  if (args["post-deploy"]) await postDeploy();
  else await preDeploy();
} catch (e) {
  out("FAIL", "rpc error", String(e.message || e));
}
console.log(failures ? `\n${failures} FAIL` : "\nOK");
process.exit(failures ? 1 : 0);
