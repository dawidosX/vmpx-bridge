# Warp route config (Hyperlane Sealevel client format)

Format verified against `hyperlane-monorepo@a9b3e870` → `rust/sealevel/environments/mainnet3/warp-routes/TONY-base-solanamainnet/token-config.json`
(an 18-dec ERC-20 collateral on an EVM chain ↔ 9-dec synthetic on SVM — the same shape as VMPX ↔ X1).

What the official client does for a synthetic (read in `rust/sealevel/client/src/warp_route.rs`):
1. `init_instruction` of `hyperlane-sealevel-token` → creates mint PDA.
2. `spl-token create-token --enable-metadata` (Token-2022, metadata pointer), `initialize_mint2(..., freeze_authority = None, decimals)`.
3. `initialize-metadata` name/symbol/uri with **update authority = deployer**.
4. Transfers **mint authority → mint PDA** (only the program can mint after this).

⚠ Between steps 2 and 4 the deployer key is the mint authority. Post-deploy verification
(`svm/compat/check-x1.mjs --post-deploy`) MUST confirm: mint authority == mint PDA, freeze authority == null,
supply == 0, program upgrade authority == Squads multisig (or none), metadata update authority == multisig.
