# Contributing

Thank you for testing the bridge. It is an independent, testnet-only project (see the warning in [README.md](README.md)).

- **Security vulnerabilities: never in public issues.** Use private reporting, see [SECURITY.md](SECURITY.md).
- **Bugs and proposals:** open an issue from a template (*Page bug*, *Bridge bug*, *Proposal*). One problem per issue; include the page version (`vNN` in the footer), wallet and its version, browser, steps and transaction hashes.
- **Pull requests:** small and focused, with a test. Run before opening:
  - `cd evm && forge test`
  - `node --test monitoring/test/*.mjs && bash monitoring/test/auto-pause.test.sh`
  - `node --test frontend/tests/core.test.mjs`
  - `python3 -B -m unittest indexer/test_activity.py indexer/test_api.py`
- Never commit keys, seed phrases, RPC URLs with API keys, server names or addresses. Code and comments in English; most documentation is in Polish.
- By contributing you agree that your contribution is licensed under the repository's license.
