// ===================== mode =====================
// MODE "testnet": public testnet, sending ETH -> X1 is open to everyone (test tokens, no value).
// MODE "mainnet": PREVIEW = true keeps sending disabled until launch; ?dev=1 re-enables it for the operator's own tests.
const MODE = "testnet";
const PREVIEW = MODE === "mainnet";
let DEV = false;
try { DEV = new URLSearchParams(location.search).get("dev") === "1"; } catch {}
const SEND_LOCKED = PREVIEW && !DEV;
const PAGE_VERSION = "v47";

// ===================== config =====================
const NETWORKS = {
  testnet: {
    eth: { chainId: "0xaa36a7", name: "Sepolia", rpc: "https://ethereum-sepolia-rpc.publicnode.com", explorer: "https://sepolia.etherscan.io" },
    x1:  { name: "X1 testnet", rpc: "https://rpc.testnet.x1.xyz", explorer: "https://explorer.testnet.x1.xyz" },
    router: "0x048c8208b0b37157fbbd71a737a34b1c5a00f6c8",   // lockbox (proxy)
    rateIsm: "0xc60b96ab835caba72b044c8735e12b21af9b3002",  // RateLimitedIsm on Ethereum: X1 -> ETH bucket
    mailbox: "0xfFAEF09B3cd11D9b20d1a19bECca54EEC2884766",
    x1Domain: 1479626325, ethDomain: 11155111,
    x1Program: "8hA1rhuAuCr1HaWP9x66Ptua9gpqK5jS39LhmN4h41fR",
    x1Mint: "GjSYfUZueEiH7pjP6df1aJimEBzDZKdJbP17akxjCBzj",
    symEth: "VMPX", symX1: "tVMPXe",
  },
};
const NET = NETWORKS.testnet;
const SEL = { approve:"0x095ea7b3", allowance:"0xdd62ed3e", balanceOf:"0x70a08231", decimals:"0x313ce567", token:"0xfc0c546a", totalSupply:"0x18160ddd", transferRemote:"0x81b4e8b4", quote:"0x8bd90b82", bridgeFeeBps:"0x4f6aa42b", rlLevel:"0xc0bc6d84", rlCap:"0x59b6a0c9" };
// router v2: BridgeFeeTaken(bytes32 indexed messageId, address indexed payer, uint256 gross, uint256 fee)
const TOPIC_BRIDGE_FEE = "0xeaa44a0ad16da2bc6e919cf6f8ad27dddb3d8b403d42d836c8514b6cd4d2d853";
const TOPIC_DISPATCH_ID = "0x788dbc1b7152732178210e7f4d9d010ef016f9eafbe66786bd7169f56e0c353a";
const TOPIC_DISPATCH = "0x769f711d20c679153d382254f59892613b58a97cc876b249134ac25c80f9c814";   // Dispatch(sender indexed, destination, recipient, message)
const UNIT = 10n ** 9n;

// ===================== i18n (EN default, PL) =====================
const I18N = {
  en: {
    locale: "en-US", title: "VMPX Bridge · Ethereum ⇄ X1 · x1watch", desc: "Move VMPX between Ethereum and X1. 1:1 backing visible live.",
    brandSub: "VMPX Bridge", brandAria: "x1watch, VMPX Bridge, home", netAria: "Network", mainTitle: "Mainnet after audit", connect: "Connect wallet",
    noticePreview: "<strong>Test mode.</strong> The bridge opens after a security audit. Everything below runs live on test networks, so you can watch it work without risking anything.",
    soon: "Coming soon",
    notice: "<strong>Public testnet is live.</strong> Test tokens only, no value. Need Sepolia ETH for gas? Get it from a faucet: <a href=\"https://cloud.google.com/application/web3/faucet/ethereum/sepolia\" target=\"_blank\" rel=\"noopener\">Google Cloud</a>, <a href=\"https://www.alchemy.com/faucets/ethereum-sepolia\" target=\"_blank\" rel=\"noopener\">Alchemy</a>, <a href=\"https://faucets.chain.link/sepolia\" target=\"_blank\" rel=\"noopener\">Chainlink</a>. <a href=\"#/tokens\">Test token addresses</a>.",
    h1: "VMPX, now on X1.",
    lede: "Move VMPX from Ethereum to X1 in about a minute, and back in seconds. Every token on X1 is backed 1:1 by VMPX locked on Ethereum. The numbers below are read live from both chains.",
    from: "From", to: "To", swapAria: "Swap direction", amount: "Amount", balance: "Balance",
    amtHint: "Test tokens, no value. You can enter up to 9 digits after the decimal point.",
    rcptX1: "Recipient address on X1", rcptEth: "Recipient address on Ethereum", myAddr: "My address", phX1: "e.g. 4Nd1mBQtrMJV…",
    youGet: "You receive", feeEth: "Relayer gas fee", feeVmpx: (p) => `Bridge fee ${p}`, feeX1: "Delivery fee (XNT, estimate)", feeX1Val: "charged when sending",
    gasEth: "Ethereum network fee", gasX1: "X1 network fee (estimate)", gasEthVal: "shown in your wallet", gasX1Val: "approx. 0.0025 XNT",
    total: "You send",
    timeE2X: "Usually arrives in 1–2 minutes (about 5 minutes on mainnet). Please don't send twice.",
    timeX2E: "Usually arrives within a minute. If the bridge is paused or busy, it arrives a bit later.",
    x1sendH: "Advanced: send from the command line",
    x1sendP: "The same transfer with hyperlane-sealevel-client. Not needed if you use an X1 wallet above.",
    connectX1: "Connect X1 wallet", x1Pick: "Choose an X1 wallet", x1Close: "Close",
    connectAny: "Connect", connectH: "Connect a wallet", connEth: "Ethereum", connEthSub: "MetaMask or another Ethereum wallet",
    connX1: "X1", connX1Sub: "Backpack, X1 Wallet", connNote: "Ethereum: send to X1. X1: send back to Ethereum.", nWallets: (n) => `${n} wallets`,
    deepH: "Open in a wallet app", deepNote: "Open this page in your wallet app. Inside the wallet's browser the connection works as usual.",
    deepMM: "Ethereum", deepPh: "Ethereum, Solana", deepBp: "X1 (switch Backpack to X1 testnet)", backBridge: "← Back to bridge", tabStats: "Statistics",
    bLive: "Bridge live", bDelays: "Delays", bPaused: "Paused", bInsolvent: "ALARM: not fully backed",
    insolventMsg: "Alarm: the lockbox on Ethereum holds less than it owes, that is the VMPXe supply on X1 plus the transfers in flight. Sending is disabled on this page until the operator explains and fixes it. Follow the status note below.", bChecked: (t) => `Checked at ${t}`,
    bChk: { solvent: (v) => v.startsWith("-") ? `Lockbox BELOW X1 supply + transfers in flight: shortfall ${v.slice(1)} VMPX` : `Lockbox ≥ X1 supply + transfers in flight (surplus ${v} VMPX)`, eth_hook: "Sending from Ethereum (PausableHook)", eth_ism: "Unlocks on Ethereum (PausableIsm)", x1_ism: "Mints on X1 (token ISM)",
      pending: (v) => `Oldest transfer on its way: ${v}`, limit: (v) => `X1 → Ethereum limit available: ${v}%`, data: (v) => `Data age: ${v}` },
    bNone: "none", pausedMsg: "The bridge is paused. Transfers on their way are not lost, they complete after it resumes.", pausedBtn: "Bridge paused", feeX1Bridge: "Bridge fee (XNT, estimate)",
    walletEthH: "Ethereum wallet", walletX1H: "X1 wallet", copyAddr: "Copy address", disconnect: "Disconnect", disconnected: "Disconnected.", disconnectAll: "Disconnect all",
    revokeNote: "Disconnected on this page. Also remove this site under connected sites in your wallet's settings.",
    statFees: "Fees collected for LP (3% in VMPX + bridge fee in XNT)", fees24: (v, x) => `Last 24 hours: ${v} VMPX + ${x} XNT. VMPX after router v2.`,
    dFeeEth: "Fee (ETH, old testnet model)", dFeeX1: "Delivery (IGP)", dFeeProto: "Bridge fee (XNT)",
    tokH: "Test tokens", tokWatch: "Add to MetaMask", tokX1Exp: "X1 explorer", tokAdded: "Added to MetaMask (Sepolia).", tokRejected: "Not added.",
    tokWarn: "<strong>Test tokens, no value.</strong> Real VMPX on mainnet is <code>0xb48E…0b9C</code> — do not confuse.",
    x1None: "No X1 wallet found in this browser. Install Backpack or X1 Wallet, switch it to X1 testnet and reload the page.",
    x1PickNote: "The wallet only signs. This page sends the transaction to X1 testnet and shows the cost first.",
    x1Fail: "Couldn't load the X1 wallet support. Reload the page and try again.", x1Rejected: "Connection rejected in the wallet.",
    sendEth: "Send to Ethereum", calc: "calculating…", xntBal: (v) => `${v} XNT`,
    errNoXnt: (n) => `Not enough XNT for fees. You need about ${n} XNT on X1 testnet.`, errNoTok: "Not enough tVMPXe in this wallet.", tooLittleX1: "Not enough tVMPXe",
    errSim: (e) => `This transfer would fail on X1 (${e}). Nothing was sent.`,
    wChanged: "The wallet changed the transaction, so it was not sent.", wNoSig: "The wallet did not sign the transaction. Nothing was sent.", txExpired: "The transaction expired before it was confirmed. Nothing was sent, try again.",
    stepsX2E: ["Sign in your X1 wallet", "Sent on X1", "Waiting for delivery (usually under a minute)", "Tokens arrived on Ethereum"],
    x2eRate: "Waiting for the daily withdrawal limit. It will be delivered automatically.",
    ledger: "Backed 1:1", lockedLbl: "Held by the bridge", lockedSub: "VMPX on Ethereum", supLbl: "Issued on X1", supSub: "tokens on X1",
    reading: "Checking both networks…",
    v11: "<b>Fully backed.</b> Every token on X1 has VMPX behind it on Ethereum.",
    vTransit: (x, d) => ` ${x} VMPX is in transit ${d === "x2e" ? "to Ethereum" : d === "e2x" ? "to X1" : "through the bridge"} and counted as owed.`,
    vSurplus: (x) => ` The lockbox also holds ${x} VMPX more than it owes (a donation or a direct transfer that nobody can claim).`,
    vUnknown: (x) => `<b>Checking.</b> The latest reading shows a gap of ${x} VMPX that is not confirmed yet: the two chains are read seconds apart. It becomes an alarm only if it holds for 30 minutes.`,
    vShort: (x) => `<b>Alarm: ${x} VMPX missing.</b> The lockbox holds less than the X1 supply plus the transfers in flight. Sending is disabled.`,
    vSimpleOk: "<b>Lockbox ≥ X1 supply</b> (simple comparison: the list of transfers in flight is unavailable right now).",
    vSimpleShort: (x) => `<b>Lockbox below the X1 supply by ${x} VMPX</b> (simple comparison: transfers in flight are unknown right now, so this may be a timing gap).`,
    readErr: "Couldn't check right now. Trying again in 30 seconds.",
    stamp: (t) => `Checked at ${t}, updates every 30 seconds`,
    noWallet: "Install an Ethereum wallet (e.g. MetaMask)", switchNet: (n) => `Switch your wallet to the ${n} network.`,
    errNum: "Enter a number, e.g. 25 or 0.5.", errDec: "Too many digits after the decimal point. The maximum is 9.", errZero: "The amount must be greater than zero.",
    okX1: "Address looks good.", badX1: "That doesn't look like an X1 wallet address.",
    okEth: "Address looks good.", badEth: "That doesn't look like an Ethereum address. It should start with 0x.", zeroAddr: "The zero address would burn the funds.",
    goCli: "Send from X1 with the Hyperlane client (below)", overBal: "The amount is higher than your balance.", tooLittle: "Not enough VMPX",
    sending: "Sending…", sendX1: "Send to X1", quoteNA: "quote unavailable", txReverted: "Transaction reverted",
    steps: ["Allow the bridge to use your VMPX", "Lock VMPX on Ethereum", "Waiting for confirmation (usually 1–2 min)", "Tokens arrived on X1"],
    tx: "transaction", viewAcct: "view account", aborted: "stopped",
    late: "Delivery is taking longer than usual. Your tokens are safe; follow the status in", txLink: "Transactions", trkRpc: "no connection, retrying",
    sendUnknown: "Result unknown: the transaction may have been sent. Do not send again; check it first:", sendUnknownNoHash: "Result unknown. Check the activity in your wallet before sending again.",
    walletChanged: "The wallet account or network changed. Check the amount and recipient again.",
    preChanged: "The wallet account or network changed before signing. Nothing was sent.", preBalance: "The balance changed and is too low now. Nothing was sent.",
    preFee: "The fee changed before signing. Check the new amount. Nothing was sent.", preAllowance: "The allowance is lower than the amount. Nothing was sent.",
    wrongNetH: (n) => `Wrong network in your wallet. The bridge works on ${n}; sending is blocked until you switch.`, switchBtn: (n) => `Switch to ${n}`,
    rpcDown: "No connection to the network (RPC). The data on this page may be out of date.", offline: "You are offline. The data on this page may be out of date.", retry: "Try again",
    x1NotSolana: "This wallet account is not a Solana / X1 account. Switch the wallet to Solana (X1 testnet) and connect again.",
    x1WrongNet: "The X1 testnet check failed (wrong network or RPC). Nothing was sent.",
    signTimeout: "The wallet did not respond within 60 seconds. Nothing was sent. Open your wallet or connect again.", reconnect: "Connect again",
    noEthGas: (n) => `Not enough ETH for gas. You need about ${n} ETH (delivery fee + network fee).`, noXntFee: "Not enough XNT for the fees of this transfer.",
    opSigning: "A transfer is being signed in another tab or wallet window. Finish or cancel it there first.",
    opSent: "Your previous transfer was sent and its result is not known yet. Sending again is blocked until it is settled:",
    opUnknown: "The result of your previous transfer is unknown. Do not send again before you check it:",
    opUnknownNoHash: "A previous send was interrupted before the page got a transaction hash. Check the activity in your wallet before sending again.",
    opCheck: "Check status", opClear: "Nothing was sent - unlock", opClearSure: "Click again to confirm (I checked my wallet)",
    noLocks: "This browser cannot lock a send across tabs (Web Locks), so sending is disabled here. Use a current Chrome, Firefox, Safari or Edge.",
    otherTabSending: "A transfer is being prepared in another tab. Finish it there first.", lostOp: "Another tab took over the operation record. Nothing was signed or sent.",
    storageFail: "The page cannot store the transfer record in this browser (storage blocked or full). Nothing was signed or sent.",
    storageHash: "Sent, but the page could not store it. Keep this transaction ID and check it before sending again:",
    opPendingBtn: "Waiting for the previous transfer", feeRoseX1: (a, b) => `The X1 fees went up from ${a} to ${b}. Nothing was sent; check the new cost and click Send again.`,
    cNet: "Network", cTo: "Recipient", cContract: "Contract", netE2X: "Sepolia → X1 testnet", netX2E: "X1 testnet → Sepolia", noId: "Sent. The message ID is not known yet; follow it in",
    cliAmt: "<AMOUNT_IN_9_DECIMAL_UNITS>", cliAddr: "<ETH_ADDRESS_AS_BYTES32>", cliKey: "<your-keypair.json>",
    trustH: "How the bridge stays safe",
    trustE2Xh: "Ethereum → X1",
    trustE2Xp: "Independent Hyperlane validators sign every transfer to X1, not the bridge operator. Only the bridge owner can change this setup, and every change is public and monitored.",
    trustX2Eh: "X1 → Ethereum",
    trustX2Ep: "The bridge operator's servers confirm the way back. In this direction you rely on the operator, much like with an exchange.",
    pauseNote: "If something goes wrong, the bridge can be paused right away. Transfers in progress aren't lost, they complete once it resumes. Code changes are announced 48 hours in advance.",
    beforeH: "Before you send",
    risk1: "<strong>It takes time.</strong> Ethereum → X1 usually takes 1–2 minutes (about 5 minutes on mainnet), the way back usually under a minute.",
    risk2: "<strong>Withdrawal limit.</strong> X1 → Ethereum works like a tank: at most its capacity C at once, refilled by C per 24 h (so up to almost 2C can leave on the first day). The page does not let you send more than is available now.",
    overCap: (c) => `This is more than the bridge can unlock in one transfer (${c} VMPX). Split it into smaller transfers.`,
    overLim: (a, h) => `Only ${a} VMPX of the X1 → Ethereum limit is available right now. Send at most that, or wait about ${h} for it to refill. Tokens burned above the limit would wait until it refills.`,
    overLimBtn: "Above the available limit",
    overLimPend: (p) => `(${p} VMPX of earlier withdrawals are still on their way and will use the limit first.)`,
    errLimit: "Could not read the X1 → Ethereum limit from Ethereum, so nothing was sent. Try again in a moment.",
    errFeeUnknown: "Could not read the bridge fee from Ethereum, so sending is blocked. Try again in a moment.",
    feeChanged: (p) => `The bridge fee has just changed to ${p}. Nothing was sent: check the amount you will receive and send again.`,
    errActStale: "The list of transfers in flight is out of date, so the available limit is unknown and nothing was sent. Try again in a minute.",
    risk3: "<strong>No external audit yet.</strong> The code has been reviewed. An independent audit comes before launch.",
    risk4: "<strong>Not an official token.</strong> VMPXe on X1 is issued by this bridge, not by the VMPX team. You can swap it back only here.",
    risk5: "<strong>Pause.</strong> While the bridge is paused, X1 → Ethereum transfers already burned on X1 wait and are delivered after the bridge resumes.",
    addr1: "Bridge contract (Ethereum)", addr2: "Token on X1", addr3: "Bridge program (X1)",
    foot: (a, b) => `Network: ${a} ⇄ ${b}`, contact: "Security contact", tgNote: "I never DM first and will never ask for your seed phrase or private keys.",
    ecoAria: "ANL ecosystem", ecoLogoAria: "ANL Protocol, home", ecoHome: "Home", ecoPart: "Part of the ANL ecosystem.", ecoWp: "Whitepaper", heroWp: "White Paper", heroPdf: "PDF",
    ecoSec: "Security", ecoPowered: "Powered by X1", ecoPartLink: "Part of the ANL Ecosystem",
    ctrH: "On-chain contracts", ctrNetAria: "Contracts: network", ctrRouter: "Bridge router (lockbox)", ctrMint: "VMPXe mint",
    disc: "VMPX Bridge is not an investment offer, financial advice or a financial instrument. It is an independent community project, not affiliated with X1 Labs. The code is reviewed with AI tools, without a paid external audit. The bridge currently runs on testnet; testnet tokens have no value. On-chain values can be verified independently. DYOR.",
    botTag: "test bot",
    actBot: "Automatic 24 h test running: about 200 transfers, marked \u201ctest bot\u201d.",
    statX1: "VMPXe on X1", statSupply: "Total supply (Ethereum)", statLock: "In the bridge (locked on Ethereum)", statTotal: "Transfers", stat24: "Last 24 hours",
    statE2X: "Ethereum → X1", statX2E: "X1 → Ethereum", statNote: "Test tokens, no value. Updated every minute from on-chain data.",
    statEth: "Outside the bridge", statPct: "Bridged to X1",
   
   
    actDone: (d) => `Delivered in ${d}`, actDoneNoTime: "Delivered",
   
    actDetails: "details", ctaBtn: "Transactions →",
    ctaP: "Every transfer through the bridge on both chains: search by address or transaction hash, filter, share a link.",
    tabsAria: "Sections", tabBridge: "Bridge", tabTx: "Transactions",
    txH: "Transactions", txSub: "Every transfer through the bridge, with links to both chains. Test tokens, no value.",
    txSearchLbl: "Search transfers", txSearchPh: "Address, transaction hash or message ID", txSearchBtn: "Search",
    txBadQ: "This doesn't look like an address, a transaction hash or a message ID.",
    fDirAria: "Direction", fBotAria: "Who sent it", fAll: "All", fAnyone: "Everyone", fHuman: "People", fBot: "Test bot",
    txPrev: "← Previous", txNext: "Next →", txPage: (p, n) => `Page ${p} of ${n}`,
    txTotal: (n) => `${n} ${n === 1 ? "transfer" : "transfers"}`,
    txEmpty: "No transfers match these filters.", txNoResults: "Nothing found. A new transfer can take up to a minute to appear.",
    txResults: (n) => `Search results: ${n}`, txClear: "Clear search",
    txErr: "Couldn't load transactions. Try again in a moment.", txBusy: "Too many requests. Try again in a few seconds.",
    txLoading: "Loading…", txBack: "← All transactions", txDetailH: "Transfer details",
    txNotFound: "Transfer not found. A new transfer can take up to a minute to appear here.",
    dStatus: "Status", dPending: (d) => `On its way · ${d}`, dDir: "Direction", dAmount: "Amount", dFrom: "From", dTo: "To",
    dFeePayer: "Fee payer (X1)", dSent: "Sent", dRecv: "Delivered", dDur: "Time", dMsg: "Message ID",
    dApprox: "approximate", dUnknown: "unknown", dNotYet: "not yet", dOn: (c) => `on ${c}`,
    copy: "Copy", copied: "Copied", share: "Copy link to this transfer",
    wpLink: "White Paper", wpPdf: "Download PDF", wpPdfPl: "PDF (PL)", wpDraft: "DRAFT — English version pending",
    wpErr: "Couldn't load the white paper. Try again in a moment.",
  },
  pl: {
    locale: "pl-PL", title: "VMPX Bridge · Ethereum ⇄ X1 · x1watch", desc: "Przenieś VMPX między Ethereum a X1. Pokrycie 1:1 widoczne na żywo.",
    brandSub: "VMPX Bridge", brandAria: "x1watch, VMPX Bridge, strona główna", netAria: "Sieć", mainTitle: "Mainnet po audycie", connect: "Połącz portfel",
    noticePreview: "<strong>Tryb testowy.</strong> Most otworzymy po audycie bezpieczeństwa. Wszystko poniżej działa na żywo w sieciach testowych, więc możesz patrzeć, jak działa, bez żadnego ryzyka.",
    soon: "Wkrótce",
    notice: "<strong>Publiczny testnet działa.</strong> Tylko tokeny testowe, bez wartości. Potrzebujesz Sepolia ETH na gaz? Weź z faucetu: <a href=\"https://cloud.google.com/application/web3/faucet/ethereum/sepolia\" target=\"_blank\" rel=\"noopener\">Google Cloud</a>, <a href=\"https://www.alchemy.com/faucets/ethereum-sepolia\" target=\"_blank\" rel=\"noopener\">Alchemy</a>, <a href=\"https://faucets.chain.link/sepolia\" target=\"_blank\" rel=\"noopener\">Chainlink</a>. <a href=\"#/tokens\">Adresy tokenów testowych</a>.",
    h1: "VMPX, teraz na X1.",
    lede: "Przenieś VMPX z Ethereum na X1 w około minutę, a z powrotem w kilka sekund. Każdy token na X1 ma pokrycie 1:1 w VMPX zablokowanym na Ethereum. Liczby poniżej czytamy na żywo z obu sieci.",
    from: "Z sieci", to: "Do sieci", swapAria: "Zamień kierunek", amount: "Kwota", balance: "Saldo",
    amtHint: "Tokeny testowe, bez wartości. Możesz wpisać do 9 cyfr po przecinku.",
    rcptX1: "Adres odbiorcy na X1", rcptEth: "Adres odbiorcy na Ethereum", myAddr: "Mój adres", phX1: "np. 4Nd1mBQtrMJV…",
    youGet: "Otrzymasz", feeEth: "Opłata za gaz relayera", feeVmpx: (p) => `Opłata za most ${p}`, feeX1: "Opłata za dostarczenie (XNT, szacunek)", feeX1Val: "naliczany przy wysyłce",
    gasEth: "Opłata sieci Ethereum", gasX1: "Opłata sieci X1 (szacunek)", gasEthVal: "pokaże portfel", gasX1Val: "ok. 0,0025 XNT",
    total: "Wysyłasz",
    timeE2X: "Zwykle dociera w 1–2 minuty (na mainnecie ok. 5 minut). Nie wysyłaj drugi raz.",
    timeX2E: "Zwykle dociera w minutę. Gdy most jest wstrzymany albo zajęty, dotrze trochę później.",
    x1sendH: "Zaawansowane: wysyłka z wiersza poleceń",
    x1sendP: "Ten sam transfer klientem hyperlane-sealevel-client. Niepotrzebne, jeśli używasz portfela X1 powyżej.",
    connectX1: "Połącz portfel X1", x1Pick: "Wybierz portfel X1", x1Close: "Zamknij",
    connectAny: "Połącz", connectH: "Połącz portfel", connEth: "Ethereum", connEthSub: "MetaMask albo inny portfel Ethereum",
    connX1: "X1", connX1Sub: "Backpack, X1 Wallet", connNote: "Ethereum: wysyłka na X1. X1: wysyłka z powrotem na Ethereum.", nWallets: (n) => `${n} portfele`,
    deepH: "Otwórz w aplikacji portfela", deepNote: "Otwórz stronę w aplikacji portfela. W przeglądarce portfela połączenie działa normalnie.",
    deepMM: "Ethereum", deepPh: "Ethereum, Solana", deepBp: "X1 (przełącz Backpack na X1 testnet)", backBridge: "← Wróć do mostu", tabStats: "Statystyki",
    bLive: "Most działa", bDelays: "Opóźnienia", bPaused: "Wstrzymany", bInsolvent: "ALARM: brak pełnego pokrycia",
    insolventMsg: "Alarm: lockbox na Ethereum ma mniej, niż jest winien, czyli mniej niż podaż VMPXe na X1 plus transfery w drodze. Wysyłka na tej stronie jest wyłączona, dopóki operator tego nie wyjaśni i nie naprawi. Śledź komunikat stanu poniżej.", bChecked: (t) => `Sprawdzono o ${t}`,
    bChk: { solvent: (v) => v.startsWith("-") ? `Lockbox PONIŻEJ podaży na X1 + transferów w drodze: niedobór ${v.slice(1)} VMPX` : `Lockbox ≥ podaż na X1 + transfery w drodze (nadwyżka ${v} VMPX)`, eth_hook: "Wysyłka z Ethereum (PausableHook)", eth_ism: "Odblokowania na Ethereum (PausableIsm)", x1_ism: "Minty na X1 (ISM tokena)",
      pending: (v) => `Najstarszy transfer w drodze: ${v}`, limit: (v) => `Dostępny limit X1 → Ethereum: ${v}%`, data: (v) => `Wiek danych: ${v}` },
    bNone: "brak", pausedMsg: "Most jest wstrzymany. Transfery w drodze nie przepadają, dojdą po wznowieniu.", pausedBtn: "Most wstrzymany", feeX1Bridge: "Opłata za most (XNT, szacunek)",
    walletEthH: "Portfel Ethereum", walletX1H: "Portfel X1", copyAddr: "Kopiuj adres", disconnect: "Rozłącz", disconnected: "Rozłączono.", disconnectAll: "Rozłącz wszystkie",
    revokeNote: "Rozłączono na tej stronie. Odłącz też stronę w ustawieniach portfela (połączone strony).",
    statFees: "Zebrane opłaty na LP (3% w VMPX + opłata za most w XNT)", fees24: (v, x) => `Ostatnie 24 h: ${v} VMPX + ${x} XNT. VMPX po routerze v2.`,
    dFeeEth: "Opłata (ETH, stary model testnetu)", dFeeX1: "Dostarczenie (IGP)", dFeeProto: "Opłata za most (XNT)",
    tokH: "Tokeny testowe", tokWatch: "Dodaj do MetaMask", tokX1Exp: "Eksplorator X1", tokAdded: "Dodano do MetaMask (Sepolia).", tokRejected: "Nie dodano.",
    tokWarn: "<strong>Tokeny testowe, bez wartości.</strong> Prawdziwy VMPX na mainnecie to <code>0xb48E…0b9C</code> — nie pomyl ich.",
    x1None: "Nie znaleziono portfela X1 w tej przeglądarce. Zainstaluj Backpack albo X1 Wallet, przełącz go na X1 testnet i odśwież stronę.",
    x1PickNote: "Portfel tylko podpisuje. Ta strona wysyła transakcję do X1 testnet i najpierw pokazuje koszt.",
    x1Fail: "Nie udało się wczytać obsługi portfela X1. Odśwież stronę i spróbuj ponownie.", x1Rejected: "Połączenie odrzucone w portfelu.",
    sendEth: "Wyślij na Ethereum", calc: "liczę…", xntBal: (v) => `${v} XNT`,
    errNoXnt: (n) => `Za mało XNT na opłaty. Potrzebujesz ok. ${n} XNT na X1 testnet.`, errNoTok: "Za mało tVMPXe w tym portfelu.", tooLittleX1: "Za mało tVMPXe",
    errSim: (e) => `Ten transfer nie przejdzie na X1 (${e}). Nic nie zostało wysłane.`,
    wChanged: "Portfel zmienił transakcję, więc nie została wysłana.", wNoSig: "Portfel nie podpisał transakcji. Nic nie zostało wysłane.", txExpired: "Transakcja wygasła przed potwierdzeniem. Nic nie zostało wysłane, spróbuj ponownie.",
    stepsX2E: ["Podpis w portfelu X1", "Wysłane na X1", "Czekamy na dostarczenie (zwykle poniżej minuty)", "Tokeny są na Ethereum"],
    x2eRate: "Czekamy na dzienny limit wypłat. Dostarczenie nastąpi automatycznie.",
    ledger: "Pokrycie 1:1", lockedLbl: "Trzyma most", lockedSub: "VMPX na Ethereum", supLbl: "Wydane na X1", supSub: "tokenów na X1",
    reading: "Sprawdzam obie sieci…",
    v11: "<b>Pełne pokrycie.</b> Za każdym tokenem na X1 stoi VMPX na Ethereum.",
    vTransit: (x, d) => ` ${x} VMPX jest w drodze ${d === "x2e" ? "na Ethereum" : d === "e2x" ? "na X1" : "przez most"} i liczy się do zobowiązań.`,
    vSurplus: (x) => ` Lockbox ma też ${x} VMPX ponad zobowiązania (darowizna albo bezpośredni przelew, którego nikt nie może odebrać).`,
    vUnknown: (x) => `<b>Sprawdzanie.</b> Ostatni odczyt pokazuje różnicę ${x} VMPX, jeszcze niepotwierdzoną: oba łańcuchy są czytane w odstępie kilku sekund. Alarm pojawi się tylko, jeśli utrzyma się przez 30 minut.`,
    vShort: (x) => `<b>Alarm: brakuje ${x} VMPX.</b> Lockbox ma mniej niż podaż na X1 plus transfery w drodze. Wysyłka jest wyłączona.`,
    vSimpleOk: "<b>Lockbox ≥ podaż na X1</b> (proste porównanie: lista transferów w drodze jest teraz niedostępna).",
    vSimpleShort: (x) => `<b>Lockbox poniżej podaży na X1 o ${x} VMPX</b> (proste porównanie: transfery w drodze są teraz nieznane, więc to może być różnica czasu odczytu).`,
    readErr: "Nie udało się teraz sprawdzić. Spróbuję za 30 sekund.",
    stamp: (t) => `Sprawdzone o ${t}, odświeża się co 30 sekund`,
    noWallet: "Zainstaluj portfel Ethereum (np. MetaMask)", switchNet: (n) => `Przełącz portfel na sieć ${n}.`,
    errNum: "Wpisz liczbę, np. 25 albo 0,5.", errDec: "Za dużo cyfr po przecinku. Najwyżej 9.", errZero: "Kwota musi być większa od zera.",
    okX1: "Adres wygląda dobrze.", badX1: "To nie wygląda na adres portfela X1.",
    okEth: "Adres wygląda dobrze.", badEth: "To nie wygląda na adres Ethereum. Powinien zaczynać się od 0x.", zeroAddr: "Adres zerowy spaliłby środki.",
    goCli: "Wyślij z X1 klientem Hyperlane (poniżej)", overBal: "Kwota większa niż saldo.", tooLittle: "Za mało VMPX",
    sending: "Trwa wysyłka…", sendX1: "Wyślij na X1", quoteNA: "wycena niedostępna", txReverted: "Transakcja odrzucona",
    steps: ["Zgoda na użycie VMPX", "Blokada VMPX na Ethereum", "Czekamy na potwierdzenie (zwykle 1–2 min)", "Tokeny są na X1"],
    tx: "transakcja", viewAcct: "zobacz konto", aborted: "przerwano",
    late: "Dostarczenie trwa dłużej niż zwykle. Tokeny są bezpieczne; status sprawdzisz w zakładce", txLink: "Transakcje", trkRpc: "brak połączenia, ponawiam",
    sendUnknown: "Wynik nieznany: transakcja mogła zostać wysłana. Nie wysyłaj ponownie, najpierw sprawdź:", sendUnknownNoHash: "Wynik nieznany. Zanim wyślesz ponownie, sprawdź aktywność w portfelu.",
    walletChanged: "Zmieniło się konto albo sieć w portfelu. Sprawdź ponownie kwotę i odbiorcę.",
    preChanged: "Konto albo sieć w portfelu zmieniły się przed podpisem. Nic nie zostało wysłane.", preBalance: "Saldo się zmieniło i jest za małe. Nic nie zostało wysłane.",
    preFee: "Opłata zmieniła się przed podpisem. Sprawdź nową kwotę. Nic nie zostało wysłane.", preAllowance: "Zgoda (allowance) jest mniejsza niż kwota. Nic nie zostało wysłane.",
    wrongNetH: (n) => `Zła sieć w portfelu. Most działa na sieci ${n}; wysyłka jest zablokowana do czasu przełączenia.`, switchBtn: (n) => `Przełącz na ${n}`,
    rpcDown: "Brak połączenia z siecią (RPC). Dane na stronie mogą być nieaktualne.", offline: "Brak internetu. Dane na stronie mogą być nieaktualne.", retry: "Spróbuj ponownie",
    x1NotSolana: "To konto portfela nie jest kontem Solana / X1. Przełącz portfel na Solana (X1 testnet) i połącz ponownie.",
    x1WrongNet: "Sprawdzenie sieci X1 testnet nie powiodło się (zła sieć albo RPC). Nic nie zostało wysłane.",
    signTimeout: "Portfel nie odpowiedział w ciągu 60 sekund. Nic nie zostało wysłane. Otwórz portfel albo połącz ponownie.", reconnect: "Połącz ponownie",
    noEthGas: (n) => `Za mało ETH na gaz. Potrzebujesz ok. ${n} ETH (opłata za dostarczenie + opłata sieci).`, noXntFee: "Za mało XNT na opłaty tego transferu.",
    opSigning: "W innej karcie albo oknie portfela trwa podpisywanie transferu. Najpierw dokończ go albo anuluj.",
    opSent: "Poprzedni transfer został wysłany, a jego wynik nie jest jeszcze znany. Nowa wysyłka jest zablokowana do czasu rozstrzygnięcia:",
    opUnknown: "Wynik poprzedniego transferu jest nieznany. Nie wysyłaj ponownie, zanim go nie sprawdzisz:",
    opUnknownNoHash: "Poprzednia wysyłka została przerwana, zanim strona dostała hash transakcji. Zanim wyślesz ponownie, sprawdź aktywność w portfelu.",
    opCheck: "Sprawdź status", opClear: "Nic nie zostało wysłane — odblokuj", opClearSure: "Kliknij ponownie, aby potwierdzić (sprawdziłem portfel)",
    noLocks: "Ta przeglądarka nie potrafi zablokować wysyłki między kartami (Web Locks), więc wysyłka jest tu wyłączona. Użyj aktualnej przeglądarki Chrome, Firefox, Safari lub Edge.",
    otherTabSending: "W innej karcie trwa przygotowanie transferu. Najpierw go tam dokończ.", lostOp: "Inna karta przejęła rekord operacji. Nic nie zostało podpisane ani wysłane.",
    storageFail: "Strona nie może zapisać rekordu transferu w tej przeglądarce (pamięć zablokowana albo pełna). Nic nie zostało podpisane ani wysłane.",
    storageHash: "Wysłane, ale strona nie mogła tego zapisać. Zachowaj ten identyfikator transakcji i sprawdź go przed ponowną wysyłką:",
    opPendingBtn: "Czekam na wynik poprzedniego transferu", feeRoseX1: (a, b) => `Opłaty X1 wzrosły z ${a} do ${b}. Nic nie zostało wysłane; sprawdź nowy koszt i kliknij Wyślij ponownie.`,
    cNet: "Sieć", cTo: "Odbiorca", cContract: "Kontrakt", netE2X: "Sepolia → X1 testnet", netX2E: "X1 testnet → Sepolia", noId: "Wysłane. ID wiadomości jeszcze nieznane; sprawdź w zakładce",
    cliAmt: "<KWOTA_W_JEDNOSTKACH_9>", cliAddr: "<ADRES_ETH_JAKO_BYTES32>", cliKey: "<twoj-keypair.json>",
    trustH: "Jak most jest zabezpieczony",
    trustE2Xh: "Ethereum → X1",
    trustE2Xp: "Każdy transfer na X1 podpisują niezależni walidatorzy Hyperlane, a nie operator mostu. Tylko właściciel mostu może zmienić te ustawienia, a każda zmiana jest publiczna i monitorowana.",
    trustX2Eh: "X1 → Ethereum",
    trustX2Ep: "Powrót potwierdzają serwery operatora mostu. W tym kierunku polegasz na operatorze, podobnie jak na giełdzie.",
    pauseNote: "Gdy coś pójdzie nie tak, most można od razu wstrzymać. Transfery w drodze nie przepadają, dochodzą po wznowieniu. Zmiany w kodzie są ogłaszane 48 godzin wcześniej.",
    beforeH: "Zanim wyślesz",
    risk1: "<strong>To trwa.</strong> Ethereum → X1 zwykle 1–2 minuty (na mainnecie ok. 5 minut), powrót zwykle poniżej minuty.",
    risk2: "<strong>Limit wypłat.</strong> X1 → Ethereum działa jak zbiornik: naraz najwyżej jego pojemność C, uzupełniana o C na 24 h (w pierwszej dobie może więc wyjść prawie 2C). Strona nie pozwoli wysłać więcej, niż jest teraz dostępne.",
    overCap: (c) => `To więcej, niż most odblokuje w jednym transferze (${c} VMPX). Podziel kwotę na mniejsze transfery.`,
    overLim: (a, h) => `Z limitu X1 → Ethereum dostępne jest teraz tylko ${a} VMPX. Wyślij najwyżej tyle albo poczekaj ok. ${h}, aż się uzupełni. Tokeny spalone ponad limit czekałyby na jego uzupełnienie.`,
    overLimBtn: "Ponad dostępny limit",
    overLimPend: (p) => `(${p} VMPX z wcześniejszych wypłat jest jeszcze w drodze i zużyje limit wcześniej.)`,
    errLimit: "Nie udało się odczytać limitu X1 → Ethereum z Ethereum, więc nic nie zostało wysłane. Spróbuj ponownie za chwilę.",
    errFeeUnknown: "Nie udało się odczytać opłaty za most z Ethereum, więc wysyłka jest zablokowana. Spróbuj ponownie za chwilę.",
    feeChanged: (p) => `Opłata za most właśnie zmieniła się na ${p}. Nic nie zostało wysłane: sprawdź, ile otrzymasz, i wyślij ponownie.`,
    errActStale: "Lista transferów w drodze jest nieaktualna, więc dostępny limit jest nieznany i nic nie zostało wysłane. Spróbuj ponownie za minutę.",
    risk3: "<strong>Jeszcze bez zewnętrznego audytu.</strong> Kod przeszedł przeglądy. Niezależny audyt będzie przed startem.",
    risk4: "<strong>To nie jest oficjalny token.</strong> VMPXe na X1 wydaje ten most, a nie zespół VMPX. Wymienisz go z powrotem tylko tutaj.",
    risk5: "<strong>Pauza.</strong> W czasie pauzy transfery X1 → Ethereum spalone na X1 czekają i zostaną dostarczone po wznowieniu.",
    addr1: "Kontrakt mostu (Ethereum)", addr2: "Token na X1", addr3: "Program mostu (X1)",
    foot: (a, b) => `Sieć: ${a} ⇄ ${b}`, contact: "Kontakt w sprawie bezpieczeństwa", tgNote: "Nigdy nie piszę pierwszy i nigdy nie poproszę o seed phrase ani klucze prywatne.",
    ecoAria: "Ekosystem ANL", ecoLogoAria: "ANL Protocol, strona główna", ecoHome: "Start", ecoPart: "Część ekosystemu ANL.", ecoWp: "Whitepaper", heroWp: "White Paper", heroPdf: "PDF",
    ecoSec: "Bezpieczeństwo", ecoPowered: "Powered by X1", ecoPartLink: "Part of the ANL Ecosystem",
    ctrH: "Kontrakty on-chain", ctrNetAria: "Kontrakty: sieć", ctrRouter: "Router mostu (lockbox)", ctrMint: "Mint VMPXe",
    disc: "VMPX Bridge nie jest ofertą inwestycyjną, doradztwem finansowym ani instrumentem finansowym. To niezależny projekt społeczności, niepowiązany z X1 Labs. Kod jest przeglądany narzędziami AI, bez płatnego audytu zewnętrznego. Most działa obecnie na testnecie; tokeny testowe nie mają wartości. Wartości on-chain możesz zweryfikować samodzielnie. DYOR.",
    botTag: "test bot",
    actBot: "Trwa automatyczny test 24 h: ok. 200 transferów, oznaczone \u201etest bot\u201d.",
    statX1: "VMPXe na X1", statSupply: "Cała podaż (Ethereum)", statLock: "W moście (zablokowane na Ethereum)", statTotal: "Transfery", stat24: "Ostatnie 24 h",
    statE2X: "Ethereum → X1", statX2E: "X1 → Ethereum", statNote: "Tokeny testowe, bez wartości. Aktualizowane co minutę z danych on-chain.",
    statEth: "Poza mostem", statPct: "Przeniesione na X1",
   
   
    actDone: (d) => `Dostarczono w ${d}`, actDoneNoTime: "Dostarczono",
   
    actDetails: "szczegóły", ctaBtn: "Transakcje →",
    ctaP: "Każdy transfer przez most w obu sieciach: wyszukiwanie po adresie lub hashu transakcji, filtry i link do udostępnienia.",
    tabsAria: "Sekcje", tabBridge: "Most", tabTx: "Transakcje",
    txH: "Transakcje", txSub: "Każdy transfer przez most, z linkami do obu sieci. Tokeny testowe, bez wartości.",
    txSearchLbl: "Szukaj transferów", txSearchPh: "Adres, hash transakcji lub message ID", txSearchBtn: "Szukaj",
    txBadQ: "Nie rozpoznaję tego formatu. Wpisz adres, hash transakcji albo message ID.",
    fDirAria: "Kierunek", fBotAria: "Kto wysłał", fAll: "Wszystkie", fAnyone: "Wszyscy", fHuman: "Ludzie", fBot: "Test bot",
    txPrev: "← Poprzednia", txNext: "Następna →", txPage: (p, n) => `Strona ${p} z ${n}`,
    txTotal: (n) => `Transferów: ${n}`,
    txEmpty: "Brak transferów dla tych filtrów.", txNoResults: "Nic nie znaleziono. Nowy transfer może pojawić się dopiero po minucie.",
    txResults: (n) => `Wyniki wyszukiwania: ${n}`, txClear: "Wyczyść wyszukiwanie",
    txErr: "Nie udało się wczytać transakcji. Spróbuj za chwilę.", txBusy: "Za dużo zapytań. Spróbuj za kilka sekund.",
    txLoading: "Wczytuję…", txBack: "← Wszystkie transakcje", txDetailH: "Szczegóły transferu",
    txNotFound: "Nie ma takiego transferu. Nowy transfer może pojawić się tu dopiero po minucie.",
    dStatus: "Status", dPending: (d) => `W drodze · ${d}`, dDir: "Kierunek", dAmount: "Kwota", dFrom: "Od", dTo: "Do",
    dFeePayer: "Opłacił (X1)", dSent: "Wysłano", dRecv: "Dostarczono", dDur: "Czas", dMsg: "Message ID",
    dApprox: "przybliżony", dUnknown: "nieznany", dNotYet: "jeszcze nie", dOn: (c) => `w sieci ${c}`,
    copy: "Kopiuj", copied: "Skopiowano", share: "Kopiuj link do tego transferu",
    wpLink: "White Paper", wpPdf: "Pobierz PDF (EN)", wpPdfPl: "PDF (PL)", wpDraft: "WERSJA ROBOCZA",
    wpErr: "Nie udało się wczytać white paper. Spróbuj za chwilę.",
  },
};
let LANG = "en";
try { const q = new URLSearchParams(location.search).get("lang"); LANG = I18N[q] ? q : (I18N[localStorage.getItem("vmpx-lang")] ? localStorage.getItem("vmpx-lang") : "en"); } catch {}
const t = (k, ...a) => { const v = I18N[LANG][k] ?? I18N.en[k]; return typeof v === "function" ? v(...a) : v; };

// ===================== state =====================
const $ = (id) => document.getElementById(id);
const CORE = window.BRIDGE_CORE;
const S = { dir: "e2x", account: null, token: null, dec: 18, bal: null, quote: null, busy: false, ledger: null, steps: null, goKey: null, act: null, actErr: false,
  lock: CORE.sendLock(), opGen: 0, trackSeq: 0, rcptEdited: false, ethBal: null, rpcDown: false, changedNote: false };

// ===================== utils =====================
async function rpc(url, method, params) {
  let j;
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    j = await r.json();
  } catch (e) { netState(false); throw new Error("RPC: " + (e.message || "network")); }
  netState(true);
  if (j.error) throw new Error(j.error.message || "RPC"); return j.result;
}
// NET-08: a visible banner when the RPC (or the internet) is down; NET-03: a permanent banner for the wrong EVM network
function netState(ok) { if (S.rpcDown === !ok) return; S.rpcDown = !ok; renderNet(); }
function renderNet() {
  const wrong = !!(S.account && S.wrongChain);
  $("chainBar").classList.toggle("hidden", !wrong);
  if (wrong) { $("chainBarMsg").textContent = t("wrongNetH", NET.eth.name); $("chainBarBtn").textContent = t("switchBtn", NET.eth.name); }
  const off = navigator.onLine === false, down = off || S.rpcDown;
  $("rpcBar").classList.toggle("hidden", !down);
  if (down) { $("rpcBarMsg").textContent = off ? t("offline") : t("rpcDown"); $("rpcBarBtn").textContent = t("retry"); }
}
function retryReads() { refreshLedger(); refreshActivity(); refreshBalance().then(validate).catch(() => {}); }
const ethCall = (to, data) => rpc(NET.eth.rpc, "eth_call", [{ to, data }, "latest"]);
const word = (hex) => hex.replace(/^0x/, "").padStart(64, "0");
const u256 = (n) => n.toString(16).padStart(64, "0");
const addrWord = (a) => word(a.toLowerCase());
const b58ToHex32 = (s) => CORE.x1AddrToHex32(s);   // F-04: exactly 32 bytes, canonical, not the zero key
function fmt(v, dec, max = 4) {
  if (v === null || v === undefined) return "—";
  const neg = v < 0n; if (neg) v = -v;
  const base = 10n ** BigInt(dec); const i = v / base; const f = (v % base).toString().padStart(dec, "0").slice(0, max).replace(/0+$/, "");
  const sep = LANG === "pl" ? "," : ".";
  return (neg ? "-" : "") + i.toLocaleString(t("locale")) + (f ? sep + f : "");
}
function plain(v, dec, max) { // no grouping, "." decimal: for putting back into the input
  const base = 10n ** BigInt(dec); const f = (v % base).toString().padStart(dec, "0").slice(0, max).replace(/0+$/, "");
  return (v / base).toString() + (f ? "." + f : "");
}
function parseAmount(str) {
  let s = str.trim().replace(/[\s ]/g, "");
  s = s.includes(".") ? s.replace(/,/g, "") : s.replace(",", ".");
  if (!s) return { empty: true };
  if (!/^\d+(\.\d+)?$/.test(s)) return { err: t("errNum") };
  const [i, f = ""] = s.split(".");
  if (f.length > 9) return { err: t("errDec") };
  const v18 = BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
  if (v18 === 0n) return { err: t("errZero") };
  return { v18, v9: v18 / UNIT };
}
const short = (a) => a.length > 14 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===================== live backing =====================
async function x1Supply() {
  const r = await rpc(NET.x1.rpc, "getTokenSupply", [NET.x1Mint, { commitment: "finalized" }]);
  return BigInt(r.value.amount);
}
function renderLedger() {
  const L = S.ledger, v = $("verdict");
  if (!L) { v.className = "verdict"; v.textContent = t("reading"); return; }
  if (L.err) { v.className = "verdict"; v.textContent = t("readErr"); return; }
  $("locked").textContent = fmt(L.locked, 18, 2);
  $("supply").textContent = fmt(L.sup18, 18, 2);
  // Codex round 4, R4-09: the verdict uses the full rule of the indexer (lockbox vs X1 supply + transfers in flight,
  // both directions); surplus (donations) is shown apart from amounts in flight. Without fresh indexer data the
  // panel falls back to the plain balance comparison and says so.
  const c = actFresh() ? ((S.act.status && S.act.status.checks) || []).find((x) => x.id === "solvent" && x.value != null) : null;
  if (c) {
    const bal = BigInt(c.value), pe = BigInt(c.pending_e2x || 0), px = BigInt(c.pending_x2e || 0);
    const dir = pe > 0n && px > 0n ? "" : pe > 0n ? "e2x" : "x2e";
    if (c.ok === false) { v.className = "verdict bad"; v.innerHTML = t("vShort", fmt(-bal, 18, 2)); }
    else if (bal < 0n) { v.className = "verdict"; v.innerHTML = t("vUnknown", fmt(-bal, 18, 2)); }
    else {
      v.className = "verdict ok";
      v.innerHTML = t("v11") + (pe + px > 0n ? esc(t("vTransit", fmt(pe + px, 18, 2), dir)) : "") + (bal > 0n ? esc(t("vSurplus", fmt(bal, 18, 2))) : "");
    }
  } else {
    const diff = L.locked - L.sup18;
    if (diff >= 0n) { v.className = "verdict ok"; v.innerHTML = t("vSimpleOk"); }
    else { v.className = "verdict"; v.innerHTML = t("vSimpleShort", fmt(-diff, 18, 2)); }
  }
  $("stamp").textContent = t("stamp", L.at.toLocaleTimeString(t("locale")));
  renderStats();
}
async function refreshLedger() {
  try {
    if (!S.token) {
      S.token = "0x" + (await ethCall(NET.router, SEL.token)).slice(-40); S.dec = parseInt(await ethCall(S.token, SEL.decimals), 16);
      if (S.account) refreshBalance().then(validate).catch(() => {});   // a wallet restored before the token address was known
    }
    if (S.feeBps == null) { await refreshFeeBps(); validate(); }   // also retries after a failed read
    const [lockedHex, sup9, totalHex] = await Promise.all([ethCall(S.token, SEL.balanceOf + addrWord(NET.router)), x1Supply(), ethCall(S.token, SEL.totalSupply)]);
    const locked = BigInt(lockedHex), sup18 = sup9 * UNIT, diff = locked - sup18;
    const ratio = locked === 0n ? 0 : Number((diff * 10000n) / (locked || 1n)) / 10000;
    $("beam").style.transform = `rotate(${Math.max(-9, Math.min(9, -ratio * 60))}deg)`;
    S.ledger = { locked, sup18, total: BigInt(totalHex), at: new Date() };
  } catch { S.ledger = { ...(S.ledger || {}), err: true }; if (S.ledger.locked === undefined) S.ledger = { err: true }; }
  renderLedger(); if (S.ledger.err && S.ledger.locked !== undefined) delete S.ledger.err;
}

// ===================== wallet (Ethereum) =====================
// silentAccount: an account the wallet already authorized (eth_accounts, no prompt) - the page restores it after a reload
async function connect(silentAccount) {
  if (!window.ethereum) { if (isMobile()) return openSheet("deep"); $("go").textContent = t("noWallet"); return; }
  const a = silentAccount || (await window.ethereum.request({ method: "eth_requestAccounts" }))[0];
  if (!a) return;
  try { localStorage.removeItem("vmpx-eth-off"); } catch {}
  S.account = a;
  // NET-03: the address is shown at once; a wrong network gets a permanent banner with a switch button and blocks sending
  $("wallet").textContent = short(a); $("wallet").classList.add("on"); if (!silentAccount) $("x1pick").classList.add("hidden"); renderAnyWallet();
  await checkChain();
  applyDefaultRcpt(); await refreshBalance().catch(() => {}); validate(); resumeOps();
}
async function checkChain() {
  try { S.chainId = await window.ethereum.request({ method: "eth_chainId" }); } catch { S.chainId = null; }
  S.wrongChain = S.chainId !== NET.eth.chainId; renderNet();
}
async function switchChain() {
  try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NET.eth.chainId }] }); } catch {}
  await checkChain(); validate();
}
// NET-04: anything the wallet changes (account, network, disconnect) voids the prepared operation: quote, preview,
// balances and summary. A send in progress compares S.opGen before every signature; a transfer already sent is
// tracked by its message ID and is not affected.
function invalidate() {
  S.opGen++; S.quote = null; S.x2eQuote = null; S.bal = null; S.ethBal = null; S.changedNote = true;
  ["cFee", "cTotal", "cGet"].forEach((id) => { $(id).textContent = "—"; });
  applyDefaultRcpt(); validate();
  refreshBalance().then(validate).catch(() => {});
}
// Disconnect: forget the account on this page; ask the wallet to drop the permission (EIP-2255
// wallet_revokePermissions, MetaMask and others); if it can't, tell the user to remove the site in the wallet.
async function disconnectEth(silent) {
  let revoked = false;
  if (window.ethereum && !silent) {
    try { await window.ethereum.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }); revoked = true; } catch {}
  }
  if (!silent) try { localStorage.setItem("vmpx-eth-off", "1"); } catch {}
  S.account = null; S.bal = null; S.ethBal = null; S.quote = null; S.wrongChain = false; S.opGen++; renderNet();
  $("wallet").textContent = t("connect"); $("wallet").classList.remove("on");
  $("selfBtn").classList.add("hidden"); $("bal").textContent = "—";
  forgetWalletStorage(); renderAnyWallet();
  // disconnected from the header ×: if the wallet keeps its permission, still show the "remove the site in the wallet" note
  if (!revoked && !silent && $("x1pick").classList.contains("hidden")) { S.sheet = "connect"; $("x1pick").classList.remove("hidden"); }
  if (S.sheet === "ethMenu" || S.sheet === "connect") {
    if (S.sheet === "ethMenu") S.sheet = "connect";
    renderSheet(revoked || silent ? t("disconnected") : t("revokeNote"));
    if (!isMobile() && revoked) $("x1pick").classList.add("hidden");
  }
  if (!revoked && !silent) { $("amtHint").className = "hint"; }
  applyDefaultRcpt(); validate();
}
async function disconnectAll() { await disconnectX1(); await disconnectEth(); }
// the page itself keeps no wallet data in localStorage; this removes any key a wallet library might add later
function forgetWalletStorage() {
  try { Object.keys(localStorage).filter((k) => /^(vmpx-wallet|walletconnect|wc@|wallet-standard)/i.test(k)).forEach((k) => localStorage.removeItem(k)); } catch {}
}
async function refreshBalance() {
  if (S.dir === "x2e") return refreshX1Bal();
  if (!S.account || !S.token) return;
  if (S.dir === "e2x") {
    const [b, e] = await Promise.all([ethCall(S.token, SEL.balanceOf + addrWord(S.account)), rpc(NET.eth.rpc, "eth_getBalance", [S.account, "latest"])]);
    S.bal = BigInt(b); S.ethBal = BigInt(e); renderEthBal();
  }
  else renderX1Bal();
}
function renderEthBal() { if (S.dir === "e2x") $("bal").textContent = S.bal === null ? "—" : `${fmt(S.bal, 18)} · ${S.ethBal === null ? "—" : fmt(S.ethBal, 18, 4)} ETH`; }
// FUN-03/05: the default recipient is the connected wallet on the destination chain; an address the user typed on purpose stays
const ownDest = () => (S.dir === "e2x" ? (S.x1 && S.x1.address) : S.account) || null;
function applyDefaultRcpt() {
  const cur = $("rcpt").value.trim();
  const v = CORE.defaultRecipient({ dir: S.dir, ethAccount: S.account, x1Address: S.x1 && S.x1.address, current: cur, edited: S.rcptEdited });
  if (v !== cur) $("rcpt").value = v;
  $("selfBtn").classList.toggle("hidden", !ownDest());
}

// ===================== validation and quote =====================
// VMPX bridge fee of router v2, same arithmetic as VmpxCollateralRouter._bridgeFee. The router is v2 on this network,
// so a failed read means "fee unknown" (null) and blocks sending; it is never shown as 0% (Codex round 3, R-09).
async function refreshFeeBps() {
  try { S.feeBps = BigInt(await ethCall(NET.router, SEL.bridgeFeeBps)); return true; } catch { S.feeBps = null; return false; }
}
function bridgeFeeOf(v18) {
  const raw = (v18 * (S.feeBps || 0n)) / 10000n;
  return raw - (raw % 1000000000n);
}
function pctOf(bps) { return (Number(bps) / 100).toString().replace(".", LANG === "pl" ? "," : ".") + "%"; }
let quoteTimer;
// NET-04: after a wallet change the note stays next to whatever else the amount hint says, until the user edits the form
function validate() {
  validateForm();
  const ah = $("amtHint");
  if (S.changedNote && !ah.textContent.includes(t("walletChanged"))) { ah.textContent = (ah.textContent === t("amtHint") ? "" : ah.textContent + " ") + t("walletChanged"); ah.className = "hint err"; }
}
function validateForm() {
  const a = parseAmount($("amt").value);
  const ah = $("amtHint"), rh = $("rcptHint");
  ah.className = "hint"; rh.className = "hint"; rh.textContent = "";
  ah.textContent = a.err || t("amtHint");
  if (a.err) ah.className = "hint err";
  let rc = null; const r = $("rcpt").value.trim();
  if (S.dir === "e2x") {
    if (r) { rc = b58ToHex32(r); rh.textContent = rc ? t("okX1") : t("badX1"); if (!rc) rh.className = "hint err"; }
  } else {
    if (r) { rc = /^0x[0-9a-fA-F]{40}$/.test(r) ? "0x" + addrWord(r) : null; rh.textContent = rc ? t("okEth") : t("badEth"); if (!rc) rh.className = "hint err"; if (rc && /^0x0{40}$/.test(r)) { rc = null; rh.className = "hint err"; rh.textContent = t("zeroAddr"); } }
  }
  const ok = a.v18 && rc;
  const vf = S.dir === "e2x" && a.v18 ? bridgeFeeOf(a.v18) : 0n;
  $("cGet").textContent = a.v18 ? `${fmt(a.v18 - vf, 18, 9)} ${S.dir === "e2x" ? NET.symX1 : NET.symEth}` : "—";
  $("cVmpxRow").classList.toggle("hidden", !(S.dir === "e2x" && S.feeBps > 0n));
  if (S.dir === "e2x" && S.feeBps > 0n) { $("cVmpxLbl").textContent = t("feeVmpx", pctOf(S.feeBps)); $("cVmpx").textContent = a.v18 ? `−${fmt(vf, 18, 9)} VMPX` : "—"; }
  renderSummary(rc ? r : null);
  if (S.dir === "x2e") { renderCli(a, r); return validateX2E(a, rc); }
  if (S.bal !== null && a.v18 && a.v18 > S.bal) { ah.className = "hint err"; ah.textContent = t("overBal"); setGo(false, t("tooLittle")); return; }
  if (S.feeBps === undefined) { setGo(false, t("calc")); return; }   // the bridge fee is not read yet (page start): no send before it is known
  if (S.feeBps === null) { ah.className = "hint err"; ah.textContent = t("errFeeUnknown"); setGo(false, t("sendX1")); $("go").disabled = true; return; }
  $("cTotal").textContent = a.v18 ? `${fmt(a.v18, 18, 9)} VMPX` : "—";
  if (!S.account) setGo(true, t("connect"));
  else if (S.wrongChain) { setGo(false, t("sendX1")); ah.className = "hint err"; ah.textContent = t("switchNet", NET.eth.name); return; }
  else setGo(!!ok && !S.busy, S.busy ? t("sending") : t("sendX1"));
  if (S.quote !== null) $("cFee").textContent = fmt(S.quote, 18, 6) + " ETH";
  if (ok && S.account && S.quote !== null && CORE.ethGasShort(S.ethBal, S.quote)) { ah.className = "hint err"; ah.textContent = t("noEthGas", fmt(S.quote + CORE.ETH_GAS_RESERVE, 18, 4)); }
  clearTimeout(quoteTimer);
  if (ok) quoteTimer = setTimeout(() => getQuote(a.v18, rc), 400); else { $("cFee").textContent = "—"; S.quote = null; }
}
// SEC-10: what the signature does, next to the amounts: network, recipient and the contract that receives the call
function renderSummary(r) {
  const e2x = S.dir === "e2x";
  $("cNet").textContent = t(e2x ? "netE2X" : "netX2E");
  $("cTo").textContent = r ? short(r) : "—"; $("cTo").title = r || "";
  const c = e2x ? NET.router : NET.x1Program, href = e2x ? `${NET.eth.explorer}/address/${c}` : `${NET.x1.explorer}/address/${c}`;
  $("cContract").innerHTML = `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(short(c))}</a>`;
}
function setGo(enabled, text) {
  if (SEND_LOCKED) { enabled = false; text = t("soon"); }
  else if (S.paused) { enabled = false; text = t("pausedBtn"); }
  else if (!S.busy && blockingOp()) { enabled = false; text = t("opPendingBtn"); }
  $("go").disabled = !enabled; $("go").textContent = text;
}
async function getQuote(v18, rc) {
  try {
    const data = SEL.quote + u256(BigInt(NET.x1Domain)) + rc.replace(/^0x/, "") + u256(v18);
    const h = (await ethCall(NET.router, data)).replace(/^0x/, "");
    // Quote[] = (address token, uint256 amount)[]; first element = fee in native ETH
    const amount = BigInt("0x" + h.slice(64 * 3, 64 * 4));
    S.quote = amount; $("cFee").textContent = fmt(amount, 18, 6) + " ETH";
    // VAL-04 (real-wallet E2E): the gas warning needs the quote, which arrives after validate() ran
    if (S.account && S.dir === "e2x" && !S.busy && CORE.ethGasShort(S.ethBal, amount)) { $("amtHint").className = "hint err"; $("amtHint").textContent = t("noEthGas", fmt(amount + CORE.ETH_GAS_RESERVE, 18, 4)); }
    const bps = S.feeBps; await refreshFeeBps(); if (bps !== S.feeBps) validate();
  } catch { $("cFee").textContent = t("quoteNA"); S.quote = null; }
}

// ===================== send ETH → X1 =====================
// R7-05: the last awaits before the wallet are the chain and account reads; right after them (synchronously) the frozen
// operation is compared with the current state, and the transaction goes out FROM the frozen account
async function sendTx(tx, op, onHash) {
  const [cid, accs] = await Promise.all([window.ethereum.request({ method: "eth_chainId" }), window.ethereum.request({ method: "eth_accounts" })]);
  if (cid !== NET.eth.chainId) throw new Error(t("switchNet", NET.eth.name));
  guardOp(op, accs && accs[0]);
  let hash;
  try { hash = await window.ethereum.request({ method: "eth_sendTransaction", params: [{ from: op.from, ...tx }] }); }
  catch (e) { if (CORE.sendErrorClass(e, { sent: false }) !== "rejected") e.maybeSent = true; throw e; }   // the wallet may have broadcast it
  onHash && onHash(hash);
  // receipt: RPC errors are retried (the transaction is already out); after 15 min the result is "unknown", never "failed"
  for (const t0 = Date.now(); Date.now() - t0 < 15 * 60000; await sleep(3000)) {
    const r = await rpc(NET.eth.rpc, "eth_getTransactionReceipt", [hash]).catch(() => null);
    if (r) { if (r.status !== "0x1") throw new Error(t("txReverted")); return r; }
  }
  throw new Error("receipt-timeout");
}
// step extras are stored as data and rendered in the current language
function extra(x) {
  if (!x) return "";
  if (x.k === "tx") return ` · <a href="${NET.eth.explorer}/tx/${x.v}" target="_blank" rel="noopener">${t("tx")}</a>`;
  if (x.k === "x1tx") return ` · <a href="${NET.x1.explorer}/tx/${x.v}" target="_blank" rel="noopener">${t("tx")}</a>`;
  if (x.k === "rate") return " · " + t("x2eRate");
  if (x.k === "acct") return ` · <a href="${NET.x1.explorer}/address/${x.v}" target="_blank" rel="noopener">${t("viewAcct")}</a>`;
  if (x.k === "txt") return " · " + String(x.v).replace(/[<>&]/g, "");
  if (x.k === "aborted") return " · " + t("aborted");
  const idLink = (id) => /^0x[0-9a-f]{64}$/.test(id || "") ? ` <a href="#/tx/${id}">${esc(t("txLink"))}</a>` : ` <a href="#/tx">${esc(t("txLink"))}</a>`;
  if (x.k === "late") return " · " + esc(t("late")) + idLink(x.v) + ".";
  if (x.k === "noid") return " · " + esc(t("noId")) + idLink(null) + ".";
  if (x.k === "storage") return " · " + esc(t("storageHash")) + ` <code>${esc(x.v)}</code> <button type="button" class="copy" data-copy="${esc(x.v)}">${esc(t("copy"))}</button>`;
  if (x.k === "rpcwait") return " · " + esc(String(x.v)) + " · " + esc(t("trkRpc"));
  if (x.k === "detail") return /^0x[0-9a-f]{64}$/.test(x.v || "") ? ` · <a href="#/tx/${x.v}">${esc(t("actDetails"))}</a>` : "";
  if (x.k === "unknown") {
    const okHash = x.c === "x1" ? /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(x.v || "") : /^0x[0-9a-fA-F]{64}$/.test(x.v || "");
    if (!okHash) return " · " + esc(t("sendUnknownNoHash"));
    return " · " + esc(t("sendUnknown")) + ` <a href="${x.c === "x1" ? NET.x1.explorer : NET.eth.explorer}/tx/${x.v}" target="_blank" rel="noopener">${esc(t("tx"))}</a>`;
  }
  if (x.k === "reconnect") return " · " + esc(t("signTimeout")) + ` <button type="button" class="copy" data-reconnect="1">${esc(t("reconnect"))}</button>`;
  return "";
}
function renderSteps(state) {
  if (state) S.steps = state; if (!S.steps) return;
  $("track").classList.remove("hidden");
  $("steps").innerHTML = t(S.stepsKey || "steps").map((s, i) => `<li class="${S.steps[i]?.c || ""}">${s}${extra(S.steps[i]?.x)}</li>`).join("");
}
// ===================== the operation (v39: R7-05, R7-06) =====================
// R7-05: an operation is fixed when the user clicks Send: direction, sender, recipient, amount, wallet generation and
// opKey(). The form is locked until it ends. guardOp() runs right before every wallet call (no await in between).
function currentKey() {
  const a = parseAmount($("amt").value), e2x = S.dir === "e2x";
  return CORE.opKey({ dir: S.dir, account: e2x ? S.account : S.x1 && S.x1.address, chainId: e2x ? S.chainId : "", x1: "", amount: a.v18 ?? "", rcpt: $("rcpt").value.trim() });
}
function freezeOp(dir, from, to, v18) { return { dir, from, to, v18, gen: S.opGen, key: currentKey(), feeShown: S.feeBps }; }
function guardOp(op, walletAccount) {
  const same = op.dir === "e2x" ? !!walletAccount && walletAccount.toLowerCase() === op.from.toLowerCase() && S.account && S.account.toLowerCase() === op.from.toLowerCase()
    : !!S.x1 && S.x1.address === op.from;
  if (!same || S.opGen !== op.gen || currentKey() !== op.key) throw new Error("changed");
  // R8-02: once the record is reserved, this tab must still own it (same opId, owner = this tab), or nothing is signed/sent
  if (op.reserved) { const cur = loadOp(); if (!cur || cur.opId !== op.opId || cur.owner !== TAB_ID) throw new Error("lost-op"); }
}
function lockForm(on) { ["amt", "rcpt", "swap", "maxBtn", "selfBtn"].forEach((id) => { $(id).disabled = on; }); }
// before every Ethereum signature (NET-04): network, account, balance and the fee the user saw
async function preSignE2X(op) {
  const bal = BigInt(await ethCall(S.token, SEL.balanceOf + addrWord(op.from)));
  if (!(await refreshFeeBps())) throw new Error(t("errFeeUnknown"));
  const p = CORE.preSignProblems({ dir: "e2x", chainId: S.chainId, wantChainId: NET.eth.chainId, account: S.account, prepared: op.gen, current: S.opGen, balance: bal, amount: op.v18, fee: S.feeBps, feeShown: op.feeShown });
  if (p.length) throw new Error(p[0] === "wrongChain" ? t("switchNet", NET.eth.name) : p[0] === "balance" ? t("preBalance") : p[0] === "fee" ? t("preFee") : "changed");
}
// R7-06: the operation record in localStorage ("vmpx-op", see core.js readOp): written before the transfer signature,
// updated with the hash / signature the moment it exists, then with the message ID. It blocks a new send in every tab
// while the result is not known; a reload reconciles it first.
const OP_KEY = "vmpx-op", SEND_LOCK = "vmpx-send";
const TAB_ID = CORE.newId(8);   // R8-02: owner of the records this tab writes
let hbTimer = null;
function loadOp() { let raw = null; try { raw = localStorage.getItem(OP_KEY); } catch {} return CORE.readOp(raw, Date.now()); }
/** R8-04: a write counts only if the stored text reads back identical; returns the stored record or null */
function writeOp(r) {
  const txt = JSON.stringify(r);
  try { localStorage.setItem(OP_KEY, txt); if (localStorage.getItem(OP_KEY) !== txt) return null; } catch { return null; }
  renderOp(); return r;
}
/** R8-03: write only if the stored record is still `seen` (same opId and revision); bumps the revision */
function saveOpIf(seen, next) {
  const cur = loadOp();
  if (seen && !CORE.sameOp(cur, seen)) return null;
  return writeOp({ ...next, opId: next.opId || (seen && seen.opId), rev: (cur ? cur.rev : 0) + 1 });
}
/** R8-03 / R9-02: remove only the record that was read (same opId AND revision) */
function clearOpIf(seen) {
  const cur = loadOp();
  if (!cur || !seen || !CORE.sameOp(cur, seen)) return false;   // already gone, or another operation / a newer state by now
  stopHb(); try { localStorage.removeItem(OP_KEY); } catch {} renderOp(); return true;
}
function clearOp() { stopHb(); try { localStorage.removeItem(OP_KEY); } catch {} renderOp(); }
function startHb(op) { stopHb(); hbTimer = setInterval(() => { const r = loadOp(); if (r && r.stage === "signing" && r.opId === op.opId && r.owner === TAB_ID) saveOpIf(r, { ...r, hb: Date.now() }); else stopHb(); }, CORE.OP.hbMs); }
function stopHb() { clearInterval(hbTimer); hbTimer = null; }
const opOwner = (r) => (r.dir === "e2x" ? S.account : S.x1 && S.x1.address);
/** the operation that blocks a new send for the connected wallet (any tab), or null; also a hash this tab could not
 *  store (R8-04) */
function blockingOp() {
  if (S.unsaved) return S.unsaved;
  const r = loadOp(); return r && CORE.opBlocks(r, Date.now()) && CORE.ownsOp(r, opOwner(r)) ? r : null;
}
/** R8-02: the whole send (from the first preparation to the stored hash) runs under an exclusive Web Lock shared by
 *  all tabs of this origin; without Web Locks sending is refused */
/** R9-01 / R9-02: every change that creates or removes an operation (send, migration, manual unlock) runs under the
 *  same exclusive lock; `busy` is called when another tab holds it */
async function underOpLock(fn, busy) {
  if (!(navigator.locks && navigator.locks.request)) return busy && busy("nolocks");
  return navigator.locks.request(SEND_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => (lock ? fn() : busy && busy("held")));
}
async function withSendLock(fn) {
  const ah = $("amtHint");
  if (!(navigator.locks && navigator.locks.request)) { ah.className = "hint err"; ah.textContent = t("noLocks"); return; }
  if (S.lock.held) return;   // a second click in this tab
  return navigator.locks.request(SEND_LOCK, { mode: "exclusive", ifAvailable: true }, async (lock) => {
    if (!lock) { ah.className = "hint err"; ah.textContent = t("otherTabSending"); return; }
    if (blockingOp()) { renderOp(); return; }
    return fn();
  });
}
let armed = null;   // R9-02: { opId, rev, tx, at } of the record the first "unlock" click was about
function renderOp() {
  const r = blockingOp(), bar = $("opBar");
  bar.classList.toggle("hidden", !r || (S.busy && S.opActive));
  if (!r || (S.busy && S.opActive)) return;
  if (armed && (Date.now() - armed.at > 10000 || armed.opId !== (r.opId || null) || armed.rev !== (r.rev || 0) || armed.tx !== (r.tx || null))) armed = null;   // the record changed: the confirmation is void
  const st = r === S.unsaved ? "unknown" : CORE.opState(r, Date.now()), e2x = r.dir === "e2x";
  const link = r.tx ? ` <a href="${e2x ? NET.eth.explorer : NET.x1.explorer}/tx/${r.tx}" target="_blank" rel="noopener">${esc(t("tx"))}</a> <button type="button" class="copy" data-copy="${esc(r.tx)}">${esc(t("copy"))}</button>` : "";
  $("opBarMsg").innerHTML = esc(t(st === "signing" ? "opSigning" : st === "sent" ? "opSent" : r.tx ? "opUnknown" : "opUnknownNoHash")) + link;
  $("opCheckBtn").textContent = t("opCheck"); $("opCheckBtn").classList.toggle("hidden", st === "signing");
  $("opClearBtn").classList.toggle("hidden", st !== "unknown");
  $("opClearBtn").textContent = armed ? t("opClearSure") : t("opClear");
}
// After a reload, a wallet (re)connection or "Check status": settle the recorded operation before anything else.
// R8-03: one reconcile at a time (a newer call invalidates older ones), and every write/removal is conditional on the
// record still being the one that was read. R8-06: every record from storage, also "tracking", is checked against its
// transaction (sender, route, message ID taken from the transaction) before it is shown or tracked.
let recGen = 0;
const verifiedOps = new Set();   // operations this tab created or already checked
/** EVM: the receipt of a transferRemote by `from` through our router -> { status, id } */
async function verifyE2X(hash, from) {
  const rec = await rpc(NET.eth.rpc, "eth_getTransactionReceipt", [hash]);
  if (!rec) return { status: "pending" };
  if (rec.from.toLowerCase() !== from.toLowerCase()) return { status: "mismatch" };
  if (rec.status !== "0x1") return { status: "failed" };
  const mb = NET.mailbox.toLowerCase(), routerWord = "0x" + addrWord(NET.router);
  const dispatch = rec.logs.find((l) => l.address.toLowerCase() === mb && l.topics[0] === TOPIC_DISPATCH && (l.topics[1] || "").toLowerCase() === routerWord);
  const ev = dispatch && rec.logs.find((l) => l.address.toLowerCase() === mb && l.topics[0] === TOPIC_DISPATCH_ID && parseInt(l.logIndex, 16) === parseInt(dispatch.logIndex, 16) + 1);
  return ev ? { status: "ok", id: ev.topics[1].toLowerCase() } : { status: "mismatch" };
}
async function reconcileOp() {
  const g = ++recGen;
  let r = loadOp();
  if (!r || !CORE.ownsOp(r, opOwner(r)) || (S.busy && S.opActive)) { renderOp(); return; }
  if (!r.opId) { r = saveOpIf(null, { ...r, opId: CORE.newId() }) || r; }   // a v39 record: give it an identity first
  const seen = r, alive = () => g === recGen && CORE.sameOp(loadOp(), seen);
  const e2x = r.dir === "e2x", txx = r.tx ? { k: e2x ? "tx" : "x1tx", v: r.tx } : null;
  S.stepsKey = e2x ? "steps" : "stepsX2E";
  const st = [{ c: "done" }, { c: "done", x: txx }, { c: "now" }];
  const state = CORE.opState(r, Date.now());
  if (state === "signing") { renderOp(); return; }   // another tab has the wallet window open
  if (r.stage === "tracking" && verifiedOps.has(r.opId)) return track(r, st);
  if (!r.tx) { saveOpIf(seen, { ...r, stage: "unknown" }); st[1] = { c: "fail", x: { k: "unknown", v: null, c: e2x ? "eth" : "x1" } }; st.length = 2; renderSteps(st); return; }
  try {
    let v;
    if (e2x) {
      v = await verifyE2X(r.tx, r.from);
      if (!alive()) return;
      if (v.status === "pending") {
        const tx = await rpc(NET.eth.rpc, "eth_getTransactionByHash", [r.tx]);
        if (!alive()) return;
        saveOpIf(seen, { ...r, stage: tx ? "sent" : "unknown" });
        st[1] = { c: tx ? "now" : "fail", x: { k: "unknown", v: r.tx, c: "eth" } }; st.length = 2; renderSteps(st);
        if (tx) setTimeout(reconcileOp, 15000);
        return;
      }
      if (v.status === "failed") { clearOpIf(seen); st[1] = { c: "fail", x: { k: "txt", v: t("txReverted") } }; st.length = 2; renderSteps(st); return; }
    } else {
      const X = await loadX1(), res = await X.reconcile(r.tx, 3);
      if (!alive()) return;
      if (res.status === "failed") { clearOpIf(seen); st[1] = { c: "fail", x: { k: "txt", v: "tx-failed" } }; st.length = 2; renderSteps(st); return; }
      if (res.status === "none") { saveOpIf(seen, { ...r, stage: "unknown" }); st[1] = { c: "fail", x: { k: "unknown", v: r.tx, c: "x1" } }; st.length = 2; renderSteps(st); return; }
      if (res.status === "pending") { st[1] = { c: "now", x: { k: "x1tx", v: r.tx } }; st.length = 2; renderSteps(st); setTimeout(reconcileOp, 10000); return; }   // confirmed, not finalized yet
      v = await X.verifyX2E(r.tx, r.from);
      if (!alive()) return;
      if (v.status === "pending") { st[1] = { c: "done", x: txx }; st[2] = { c: "now", x: { k: "rpcwait", v: "" } }; renderSteps(st); setTimeout(reconcileOp, 10000); return; }
    }
    if (v.status === "mismatch") { clearOpIf(seen); return; }   // not this wallet's transfer through our route
    if (r.id && r.id !== v.id) { clearOpIf(seen); return; }    // the stored ID does not belong to this transaction
    const tr = saveOpIf(seen, { ...r, stage: "tracking", id: v.id });
    if (!tr) return;
    verifiedOps.add(tr.opId); validate(); return track(tr, st);
  } catch { if (!alive()) return; st[1] = { c: "now", x: { k: "rpcwait", v: "" } }; st.length = 2; renderSteps(st); setTimeout(reconcileOp, 15000); }
}
// v37/v38 records (ID and hash, no sender). R8-05: the old key is removed only after the new record is stored and read
// back, or when the old data is definitely not ours / unusable; missing RPC data leaves it for a later retry.
// R8-06: the message ID comes from the transaction, not from the old record.
async function migrateOldPending() {
  for (const [dir, key] of [["e2x", "vmpx-pending"], ["x2e", "vmpx-pending-x2e"]]) {
    let raw = null; try { raw = localStorage.getItem(key); } catch {}
    if (!raw) continue;
    const owner = dir === "e2x" ? S.account : S.x1 && S.x1.address;
    if (!owner) continue;   // wait until the wallet of that direction is connected
    const drop = () => { try { if (localStorage.getItem(key) === raw) localStorage.removeItem(key); } catch {} };
    const p = CORE.migratePending(raw, dir, Date.now());
    if (!p || !p.tx) { drop(); continue; }
    // R9-01: under the same lock as a send; another tab sending = try again later
    await underOpLock(async () => {
      if (loadOp()) return;   // a current operation first; the old record waits
      let v;
      try { v = dir === "e2x" ? await verifyE2X(p.tx, owner) : await (await loadX1()).verifyX2E(p.tx, owner); } catch { v = { status: "pending" }; }
      if (v.status === "pending") { setTimeout(() => resumeOps(), 15000); return; }
      if (v.status !== "ok") { drop(); return; }
      if (loadOp()) return;   // re-checked after the await: never replace an existing operation
      const rec = writeOp({ v: 1, dir, from: owner, to: "", amount: "", t: p.t, hb: p.t, stage: "tracking", tx: p.tx, id: v.id, opId: CORE.newId(), owner: TAB_ID, rev: 1 });
      const back = loadOp();
      if (rec && back && back.opId === rec.opId && back.id === v.id) { verifiedOps.add(rec.opId); drop(); }
    }, () => setTimeout(() => resumeOps(), 15000));
  }
}
async function resumeOps() { await migrateOldPending(); await reconcileOp(); validate(); }
// the public RPC is load-balanced: right after the approve receipt a lagging node can still answer with the old
// allowance (real-wallet E2E, v39). Re-read for up to 30 s before declaring it too low.
async function allowanceReaches(op) {
  for (let i = 0; i < 10; i++) {
    try { if (BigInt(await ethCall(S.token, SEL.allowance + addrWord(op.from) + addrWord(NET.router))) >= op.v18) return true; } catch { /* RPC error: try again */ }
    await sleep(3000);
  }
  return false;
}
async function sendE2X() {
  if (SEND_LOCKED) return;
  const a = parseAmount($("amt").value); const r = $("rcpt").value.trim(); const rc = b58ToHex32(r);
  if (!a.v18 || !rc || !S.account) return;
  if (!S.lock.acquire()) return;   // NET-06: one send at a time in this tab (the Web Lock covers the other tabs)
  const op = freezeOp("e2x", S.account, r, a.v18);
  op.opId = CORE.newId();
  S.busy = true; S.opActive = true; lockForm(true); validate();
  let sent = null, released = false, tracking = null;
  const st = [{ c: "now" }]; S.stepsKey = "steps"; S.trackSeq++; renderSteps(st);
  const release = () => { if (released) return; released = true; S.lock.release(); S.busy = false; S.opActive = false; lockForm(false); };
  const unsaved = (h) => { S.unsaved = { v: 1, dir: "e2x", from: op.from, stage: "unknown", tx: h, t: Date.now() }; renderOp(); };   // R8-04
  try {
    await preSignE2X(op);
    const allowance = BigInt(await ethCall(S.token, SEL.allowance + addrWord(op.from) + addrWord(NET.router)));
    const ap = CORE.approveAmount(allowance, op.v18);   // SEC-10: exactly the amount, never unlimited
    if (ap !== null) { await sendTx({ to: S.token, data: SEL.approve + addrWord(NET.router) + u256(ap) }, op, (h) => { sent = h; }); sent = null; }
    st[0] = { c: "done" }; st[1] = { c: "now" }; renderSteps(st);
    await getQuote(op.v18, rc);
    if (S.quote === null) throw new Error(t("quoteNA"));
    await preSignE2X(op);
    // SEC-10: the transfer uses exactly the frozen amount; an allowance the user lowered in the wallet stops it here
    if (!(await allowanceReaches(op))) throw new Error(t("preAllowance"));
    const value = S.quote * 11n / 10n; // 10% overpay, the contract refunds the difference
    // R8-04: no stored reservation, no signature
    const res = writeOp({ v: 1, dir: "e2x", from: op.from, to: r, amount: op.v18.toString(), t: Date.now(), hb: Date.now(), stage: "signing", tx: null, id: null, opId: op.opId, owner: TAB_ID, rev: 1 });
    if (!res) throw new Error("storage");
    op.reserved = true; startHb(op); verifiedOps.add(op.opId);
    const rec = await sendTx({ to: NET.router, value: "0x" + value.toString(16), data: SEL.transferRemote + u256(BigInt(NET.x1Domain)) + rc.slice(2) + u256(op.v18) }, op, (h) => {
      sent = h; stopHb();
      const cur = loadOp();
      if (!(cur && cur.opId === op.opId && saveOpIf(cur, { ...cur, hb: Date.now(), stage: "sent", tx: h }))) unsaved(h);
    });
    const v = await verifyE2X(rec.transactionHash, op.from);
    st[1] = { c: "done", x: { k: "tx", v: rec.transactionHash } }; st[2] = { c: "now", x: { k: "txt", v: "0:00" } }; renderSteps(st);
    if (S.unsaved) { st[2] = { c: "now", x: { k: "storage", v: rec.transactionHash } }; renderSteps(st); return; }
    const cur = loadOp();
    if (v.status !== "ok") { if (cur && cur.opId === op.opId) saveOpIf(cur, { ...cur, stage: "unknown" }); st[2] = { c: "now", x: { k: "noid" } }; renderSteps(st); return; }
    tracking = cur && cur.opId === op.opId ? saveOpIf(cur, { ...cur, stage: "tracking", id: v.id }) : null;
    if (!tracking) { unsaved(rec.transactionHash); st[2] = { c: "now", x: { k: "storage", v: rec.transactionHash } }; renderSteps(st); return; }
    release(); $("amt").value = ""; S.quote = null; validate();
  } catch (e) {
    const cur = loadOp(), mine = cur && cur.opId === op.opId;
    if (sent || (e && e.maybeSent)) {
      if (/reverted/i.test((e && e.message) || "") && sent) { if (mine) clearOpIf(cur); }
      else if (!(mine && saveOpIf(cur, { ...cur, stage: "unknown", tx: sent || cur.tx })) && sent && !S.unsaved) unsaved(sent);
    } else if (mine && cur.stage === "signing" && !cur.tx) clearOpIf(cur);
    failStep(st, e, sent, "eth");
  }
  finally { stopHb(); release(); renderOp(); refreshBalance().then(validate).catch(() => validate()); }
  if (tracking) track(tracking, st);   // outside the send lock: delivery tracking does not block other sends
}
function failStep(st, e, sent, chain) {
  const cls = CORE.sendErrorClass(e, { sent: !!sent || !!(e && e.maybeSent) });
  const m = (e && e.message) || "";
  const x = cls === "rejected" ? { k: "aborted" } : cls === "unknown" ? { k: "unknown", v: sent || (e && e.signature) || null, c: chain } : cls === "rpc" ? { k: "txt", v: t("rpcDown") }
    : m === "sign-timeout" ? { k: "reconnect" } : m === "wrong-network" ? { k: "txt", v: t("x1WrongNet") } : m === "wallet-changed-tx" ? { k: "txt", v: t("wChanged") }
    : m === "wallet-no-signature" ? { k: "txt", v: t("wNoSig") } : m === "changed" ? { k: "txt", v: t("preChanged") }
    : m === "lost-op" ? { k: "txt", v: t("lostOp") } : m === "storage" ? { k: "txt", v: t("storageFail") } : { k: "txt", v: m.slice(0, 120) };
  const i = st.findIndex((s) => s.c === "now"); st[i < 0 ? 0 : i] = { c: "fail", x }; renderSteps(st);
}
// FUN-03 / NET-05: delivery is tracked by MESSAGE ID in both directions (Ethereum -> X1: the mailbox's processed-message
// account on X1; X1 -> Ethereum: Mailbox.processedAt on Sepolia), never by a balance. Past the limit the step says so and
// links the transfer in Transactions, and keeps checking. Only one transfer is shown; a newer send stops the old loop.
async function ethDelivered(id) { return parseInt(await ethCall(NET.mailbox, "0x07a2fda1" + id.slice(2)), 16) || 0; }
async function track(r, st) {
  const seq = ++S.trackSeq, dir = r.dir;
  const lateMs = dir === "e2x" ? CORE.TRACK.e2xLateMs : CORE.TRACK.x2eLateMs;
  for (;;) {
    let delivered = 0, err = false;
    try { delivered = dir === "e2x" ? ((await (await loadX1()).isProcessed(r.id)) ? 1 : 0) : await ethDelivered(r.id); } catch { err = true; }
    if (seq !== S.trackSeq) return;
    const state = CORE.trackState({ delivered: delivered > 0, startedAt: r.t, now: Date.now(), lateMs });
    if (state === "done") {
      let x = { k: "detail", v: r.id };
      if (dir === "x2e") {
        const logs = await rpc(NET.eth.rpc, "eth_getLogs", [{ fromBlock: "0x" + delivered.toString(16), toBlock: "0x" + delivered.toString(16), address: NET.mailbox,
          topics: ["0x1cae38cdd3d3919489272725a5ae62a4f48b2989b0dae843d3c279fee18073a9", r.id] }]).catch(() => []);
        if (logs[0]) x = { k: "tx", v: logs[0].transactionHash };
      }
      st[2] = { c: "done" }; st[3] = { c: "done", x }; renderSteps(st);
      const cur = loadOp(); if (cur && cur.opId === r.opId && cur.id === r.id) clearOpIf(cur);
      refreshLedger(); refreshBalance().then(validate).catch(() => {}); return;
    }
    const sec = Math.floor((Date.now() - r.t) / 1000), clock = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    st[2] = { c: "now", x: state === "late" ? { k: "late", v: r.id } : err ? { k: "rpcwait", v: clock } : dir === "x2e" && sec > 600 ? { k: "rate" } : { k: "txt", v: clock } };
    renderSteps(st);
    await sleep(state === "late" ? 30000 : dir === "e2x" ? 10000 : 5000);
  }
}

// ===================== X1 → ETH direction =====================
function renderCli(a, r) {
  const amt = a.v9 ? a.v9.toString() : t("cliAmt");
  const rc = /^0x[0-9a-fA-F]{40}$/.test(r) ? "0x" + addrWord(r) : t("cliAddr");
  $("cli").textContent = `hyperlane-sealevel-client -u ${NET.x1.rpc} -k ${t("cliKey")} -b 250000 \\\n  token transfer-remote --program-id ${NET.x1Program} \\\n  ${t("cliKey")} ${amt} ${NET.ethDomain} ${rc} synthetic`;
}
function labelDir() {
  const e2x = S.dir === "e2x";
  $("rcptLabel").textContent = e2x ? t("rcptX1") : t("rcptEth");
  $("rcpt").placeholder = e2x ? t("phX1") : "0x…";
  $("cFeeLbl").textContent = e2x ? t("feeEth") : t("feeX1");
  if (!e2x) $("cFee").textContent = S.x2eQuote ? xnt(S.x2eQuote.deliveryCost) : t("feeX1Val");
  // X1 -> ETH: the mailbox protocol fee (bridge fee in XNT) on its own row, shown once a quote says it is not zero
  const pf = !e2x && S.x2eQuote && S.x2eQuote.protocolFee > 0n;
  $("cProtoRow").classList.toggle("hidden", !pf); if (pf) $("cProto").textContent = xnt(S.x2eQuote.protocolFee);
  $("cGasLbl").textContent = e2x ? t("gasEth") : t("gasX1");
  $("cGas").textContent = e2x ? t("gasEthVal") : (S.x2eQuote ? xnt(S.x2eQuote.networkFee) : t("gasX1Val"));
  $("timeText").textContent = e2x ? t("timeE2X") : t("timeX2E");
}
function setDir(d) {
  S.dir = d; const e2x = d === "e2x";
  $("fromName").textContent = e2x ? "Ethereum" : "X1"; $("toName").textContent = e2x ? "X1" : "Ethereum";
  $("fromBox").className = "chain " + (e2x ? "eth" : "x1"); $("toBox").className = "chain " + (e2x ? "x1" : "eth");
  $("amtSym").textContent = e2x ? NET.symEth : NET.symX1;
  $("cFee").textContent = "—"; S.quote = null; $("cTotal").textContent = "—";
  $("x1send").classList.toggle("hidden", e2x); $("rcpt").value = ""; $("rcptHint").textContent = ""; S.rcptEdited = false;
  applyDefaultRcpt();
  if (!e2x) loadX1().catch(() => {});
  labelDir(); refreshBalance(); validate();
}

// ===================== X1 → ETH in the browser (x1.js + local web3.js, loaded on demand) =====================
const X1_LIB = { src: "vendor/solana-web3-1.98.4.iife.min.js", sri: "sha384-I45YF+S0YGWIolUyTksLk9TNtTqaDgZg8e6T1OoBoJvvFmphqYNIPZw3Kl0TkZNN", app: "x1.js?v=7" };
let x1Lib = null;
function loadScript(src, integrity) {
  return new Promise((res, rej) => {
    const el = document.createElement("script"); el.src = src; if (integrity) { el.integrity = integrity; el.crossOrigin = "anonymous"; }
    el.onload = res; el.onerror = () => rej(new Error("load " + src)); document.head.appendChild(el);
  });
}
function loadX1() {
  if (!x1Lib) x1Lib = loadScript(X1_LIB.src, X1_LIB.sri).then(() => loadScript(X1_LIB.app)).then(() => {
    window.X1BRIDGE.onWallets((ws) => { S.x1wallets = ws; if (!$("x1pick").classList.contains("hidden") && S.sheet === "x1") renderX1Picker(); });
    return window.X1BRIDGE;
  });
  x1Lib.catch(() => { x1Lib = null; });
  return x1Lib;
}
const xnt = (lamports) => fmt(BigInt(lamports), 9, 6) + " XNT";
// one sheet for three lists: X1 wallets (Wallet Standard), the phone "Connect" chooser, and wallet-app deep links
// phones and tablets (iPadOS reports a desktop UA, so a coarse pointer counts too)
const isMobile = () => /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia("(pointer: coarse)").matches;
function openSheet(mode) { S.sheet = mode; $("x1pick").classList.remove("hidden"); renderSheet(); }
function renderSheet(msg) {
  const mode = S.sheet || "x1";
  $("x1pickMsg").textContent = msg || "";
  $("x1pickMsg").className = msg && (msg === t("x1Fail") || msg === t("x1Rejected")) ? "hint err" : "hint";
  if (mode === "x1") return renderX1Picker(msg);
  const item = (i, icon, title, sub, href) => `<li>${href ? `<a class="pick" href="${esc(href)}" rel="noopener">` : `<button type="button" class="pick" data-i="${i}">`}<span><b>${esc(title)}</b><small>${esc(sub)}</small></span>${href ? "</a>" : "</button>"}</li>`;
  if (mode === "connect") {
    $("x1pickH").textContent = t("connectH"); $("x1pickNote").textContent = t("connNote");
    const row = (key, title, addr, sub) => addr
      ? `<li><div class="pick on"><span><b>${esc(title)}</b><small class="num">${esc(short(addr))}</small></span><button type="button" class="copy" data-dis="${key}">${esc(t("disconnect"))}</button></div></li>`
      : `<li><button type="button" class="pick" data-con="${key}"><span><b>${esc(title)}</b><small>${esc(sub)}</small></span></button></li>`;
    $("x1pickList").innerHTML = row("eth", t("connEth"), S.account, t("connEthSub")) + row("x1", t("connX1"), S.x1 && S.x1.address, t("connX1Sub"));
    $("x1pickList").querySelectorAll("[data-con]").forEach((b) => b.onclick = () => (b.dataset.con === "eth" ? connect() : openX1Picker()));
    $("x1pickList").querySelectorAll("[data-dis]").forEach((b) => b.onclick = () => (b.dataset.dis === "eth" ? disconnectEth() : disconnectX1()));
    return;
  }
  if (mode === "ethMenu" || mode === "x1Menu") {   // a connected wallet: copy the address or disconnect
    const eth = mode === "ethMenu", addr = eth ? S.account : S.x1 && S.x1.address;
    if (!addr) { $("x1pick").classList.add("hidden"); return; }
    $("x1pickH").textContent = t(eth ? "walletEthH" : "walletX1H"); $("x1pickNote").textContent = "";
    $("x1pickList").innerHTML = `<li><code class="addrfull">${esc(addr)}</code></li>
      <li><button type="button" class="pick" data-copy="${esc(addr)}">${esc(t("copyAddr"))}</button></li>
      <li><button type="button" class="pick" id="disBtn">${esc(t("disconnect"))}</button></li>` +
      (S.account && S.x1 ? `<li><button type="button" class="pick" id="disAllBtn">${esc(t("disconnectAll"))}</button></li>` : "");
    $("disBtn").onclick = () => (eth ? disconnectEth() : disconnectX1());
    if ($("disAllBtn")) $("disAllBtn").onclick = disconnectAll;
    return;
  }
  // deep links (formats from the wallets' docs: MetaMask link.metamask.io/dapp, Phantom and Backpack ul/.../browse)
  const here = location.origin + location.pathname + location.hash, ref = location.origin;
  $("x1pickH").textContent = t("deepH"); $("x1pickNote").textContent = t("deepNote");
  $("x1pickList").innerHTML =
    item(0, "", "MetaMask", t("deepMM"), "https://link.metamask.io/dapp/" + here.replace(/^https?:\/\//, "")) +
    item(1, "", "Phantom", t("deepPh"), `https://phantom.com/ul/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`) +
    item(2, "", "Backpack", t("deepBp"), `https://backpack.app/ul/v1/browse/${encodeURIComponent(here)}?ref=${encodeURIComponent(ref)}`);
}
function renderAnyWallet() {
  // header pills: an × next to each connected wallet's address
  $("walletX").classList.toggle("hidden", !S.account); $("walletPill").classList.toggle("on", !!S.account);
  $("wallet1X").classList.toggle("hidden", !S.x1); $("wallet1Pill").classList.toggle("on", !!S.x1);
  const n = (S.account ? 1 : 0) + (S.x1 ? 1 : 0);
  $("walletAny").textContent = n === 2 ? t("nWallets", 2) : n ? short(S.account || S.x1.address) : t("connectAny");
  $("walletAny").classList.toggle("on", n > 0);
}
function renderX1Picker(msg) {
  S.sheet = "x1";
  $("x1pickH").textContent = t("x1Pick"); $("x1pickNote").textContent = t("x1PickNote");
  const ws = S.x1wallets || [];
  if (!ws.length && isMobile()) return renderSheetDeepFromX1(msg);
  $("x1pickList").innerHTML = ws.length
    ? ws.map((w, i) => `<li><button type="button" class="pick" data-i="${i}">${w.icon ? `<img src="${esc(w.icon)}" alt="" width="24" height="24">` : ""}<span>${esc(w.name)}</span></button></li>`).join("")
    : `<li class="muted">${esc(t("x1None"))}</li>`;
  $("x1pickMsg").textContent = msg || ""; $("x1pickMsg").className = msg ? "hint err" : "hint";
  $("x1pickList").querySelectorAll("button.pick").forEach((b) => b.onclick = () => connectX1(ws[+b.dataset.i]));
}
function renderSheetDeepFromX1(msg) { S.sheet = "deep"; renderSheet(msg); }
async function openX1Picker() {
  S.sheet = "x1"; $("x1pick").classList.remove("hidden"); $("x1pickList").innerHTML = `<li class="muted">${"…"}</li>`;
  try { await loadX1(); setTimeout(() => (S.sheet === "x1" ? renderX1Picker() : null), 300); } catch { renderX1Picker(t("x1Fail")); }
}
// silent: restore after a reload (Wallet Standard connect({ silent: true }), no prompt, no direction change)
async function connectX1(w, silent) {
  try {
    const X = await loadX1();
    S.x1 = await X.connect(w.wallet, silent);
    try { localStorage.setItem("vmpx-x1-wallet", w.name); } catch {}   // only the wallet's name, to restore it after a reload
    // NET-04: an account switch or disconnect in the X1 wallet voids the prepared operation
    S.x1off && S.x1off();
    S.x1off = X.onAccountChange(S.x1, (addr) => {
      if (!S.x1) return;
      if (!addr) { disconnectX1(true); return; }
      if (addr !== S.x1.address) { S.x1 = { ...S.x1, address: addr, account: S.x1.wallet.accounts[0] }; $("wallet1").textContent = short(addr); renderAnyWallet(); S.x1bal = null; invalidate(); refreshX1Bal().then(validate); }
    });
    if (!silent) $("x1pick").classList.add("hidden");
    $("wallet1").textContent = short(S.x1.address); $("wallet1").classList.add("on"); renderAnyWallet(); applyDefaultRcpt();
    if (S.dir !== "x2e" && !silent) setDir("x2e"); else { await refreshX1Bal(); validate(); }
    resumeOps();
  } catch (e) {
    if (silent) { try { localStorage.removeItem("vmpx-x1-wallet"); } catch {} return; }
    renderX1Picker(/^x1-(notSolana|badKey)$/.test(e && e.message) ? t("x1NotSolana") : t("x1Rejected"));
  }
}
function restoreX1() {
  let name = null; try { name = localStorage.getItem("vmpx-x1-wallet"); } catch {}
  if (!name) return;
  loadX1().then((X) => {
    let done = false;
    X.onWallets((ws) => { if (done || S.x1) return; const w = ws.find((x) => x.name === name); if (w) { done = true; connectX1(w, true); } });
  }).catch(() => {});
}
async function restoreEth() {
  if (!window.ethereum) return;
  try { if (localStorage.getItem("vmpx-eth-off")) return; } catch {}
  try { const [a] = await window.ethereum.request({ method: "eth_accounts" }); if (a && !S.account) await connect(a); } catch {}
}
async function disconnectX1(fromWallet) {
  const X = await loadX1().catch(() => null); if (X && S.x1 && !fromWallet) await X.disconnect(S.x1.wallet);   // Wallet Standard standard:disconnect
  S.x1off && S.x1off(); S.x1off = null; S.opGen++;
  try { localStorage.removeItem("vmpx-x1-wallet"); } catch {}
  S.x1 = null; S.x1bal = null; S.x2eQuote = null; $("wallet1").textContent = t("connectX1"); $("wallet1").classList.remove("on");
  forgetWalletStorage(); renderAnyWallet();
  if (!$("x1pick").classList.contains("hidden") && (S.sheet === "connect" || S.sheet === "x1Menu")) {
    if (isMobile() || S.sheet === "connect") { S.sheet = "connect"; renderSheet(t("disconnected")); } else $("x1pick").classList.add("hidden");
  }
  if (S.dir === "x2e") $("bal").textContent = "—";
  applyDefaultRcpt(); renderX1Bal(); validate();
}
async function refreshX1Bal() {
  if (!S.x1) { renderX1Bal(); return; }
  try { S.x1bal = await (await loadX1()).balances(S.x1.address); } catch {}
  renderX1Bal();
}
function renderX1Bal() {
  if (S.dir !== "x2e") return;
  $("bal").textContent = S.x1bal ? `${fmt(S.x1bal.token9 * UNIT, 18)} · ${t("xntBal", fmt(S.x1bal.xnt, 9, 4))}` : "—";
}
let x2eTimer, x2eSeq = 0;
// X1 -> ETH rate limit (Codex M-01): a burn larger than what the Ethereum RateLimitedIsm can release would wait for
// governance (above capacity) or for the refill (above the current level), so the page refuses it before signing.
// Returns true only after a successful read; a failed read clears the old limit (Codex round 3, R-05), so nothing
// can be signed against a stale value.
async function refreshLimit(force) {
  if (!force && S.lim && S.limAt && Date.now() - S.limAt < 30000) return true;
  if (!force && S.limFailAt && Date.now() - S.limFailAt < 10000) return false;   // validate() calls this: no retry storm
  try {
    const [lvl, cap] = await Promise.all([ethCall(NET.rateIsm, SEL.rlLevel), ethCall(NET.rateIsm, SEL.rlCap)]);
    const changed = !S.lim || S.lim.level !== BigInt(lvl) || S.lim.cap !== BigInt(cap);
    S.lim = { level: BigInt(lvl), cap: BigInt(cap) }; S.limAt = Date.now();
    if (changed && S.dir === "x2e") validate();
    return true;
  } catch { S.lim = null; S.limAt = 0; S.limFailAt = Date.now(); return false; }
}
// the in-flight sum is only as good as the indexer's last run (it updates every minute)
const ACT_MAX_AGE_S = 300;
// fresh AND complete (Codex round 4 R4-01, round 5 R5-02): a snapshot without the index block is unknown, not complete
function actFresh() { return !!(S.act && S.act.updated && Math.floor(Date.now() / 1000) - S.act.updated <= ACT_MAX_AGE_S && S.act.index && S.act.index.complete === true); }
// X1 -> ETH transfers already burned but not yet delivered consume the same bucket on delivery (activity.json lists
// every undelivered transfer), so they are subtracted from what this transfer can use
function inflightX2E() {
  const it = (S.act && S.act.items) || [];
  return it.filter((x) => x.dir === "x2e" && x.status !== "delivered").reduce((s, x) => s + BigInt(x.amount || 0), 0n);
}
function limitError(v18) {
  if (!S.lim || !v18) return null;
  if (v18 > S.lim.cap) return t("overCap", fmt(S.lim.cap, 18, 0));
  const pend = inflightX2E(), avail = S.lim.level > pend ? S.lim.level - pend : 0n;
  if (v18 > avail) {
    const perSec = S.lim.cap / 86400n, need = v18 - avail;
    const s = perSec > 0n ? Number(need / perSec) + 60 : 86400;
    const h = s < 3600 ? `${Math.ceil(s / 60)} min` : `${(s / 3600).toFixed(1).replace(".", LANG === "pl" ? "," : ".")} h`;
    return t("overLim", fmt(avail, 18, 2), h) + (pend > 0n ? " " + t("overLimPend", fmt(pend, 18, 2)) : "");
  }
  return null;
}
function validateX2E(a, rc) {
  const ah = $("amtHint");
  refreshLimit();
  if (!S.x1) { setGo(true, t("connectX1")); return; }
  if (S.x1bal && a.v9 && a.v9 > S.x1bal.token9) { ah.className = "hint err"; ah.textContent = t("errNoTok"); setGo(false, t("tooLittleX1")); return; }
  const le = limitError(a.v18);
  if (le) { ah.className = "hint err"; ah.textContent = le; setGo(false, t("overLimBtn")); S.x2eQuote = null; clearTimeout(x2eTimer); return; }
  const ok = a.v9 && rc && !S.busy;
  $("cTotal").textContent = a.v9 ? `${fmt(a.v18, 18, 9)} ${NET.symX1}` + (S.x2eQuote ? ` + ≈${xnt(S.x2eQuote.total)}` : "") : "—";   // X1 fees are an estimate (simulation)
  // R7-08: a fee preview is valid for 60 s; an older one is recalculated before the button is enabled again
  if (S.x2eQuote && !CORE.quoteFresh(S.x2eQuote, Date.now()) && !S.busy) S.x2eQuote = null;
  setGo(!!ok && !!S.x2eQuote && S.x2eQuote.key === x2eKey(a, rc), S.busy ? t("sending") : t("sendEth"));
  if (S.x2eQuote && S.x1bal && CORE.xntShort(S.x1bal.xnt, S.x2eQuote.total)) { ah.className = "hint err"; ah.textContent = t("noXntFee"); }
  clearTimeout(x2eTimer);
  if (!a.v9 || !rc) { S.x2eQuote = null; labelDir(); return; }
  if (S.x2eQuote && S.x2eQuote.key === x2eKey(a, rc)) return;
  $("cFee").textContent = t("calc"); $("cGas").textContent = t("calc");
  const seq = ++x2eSeq;
  x2eTimer = setTimeout(async () => {
    try {
      const q = await (await loadX1()).preview({ owner: S.x1.address, recipientEth: rc.slice(-40).replace(/^/, "0x"), amount9: a.v9 });
      if (seq !== x2eSeq) return;
      if (!q.ok) { S.x2eQuote = null; labelDir(); showSimErr(q); setGo(false, t("sendEth")); return; }
      S.x2eQuote = { ...q, key: x2eKey(a, rc), at: Date.now() }; labelDir(); validate();
    } catch (e) { if (seq === x2eSeq) { S.x2eQuote = null; ah.className = "hint err"; ah.textContent = t("errSim", e.message || "RPC"); } }
  }, 500);
}
const x2eKey = (a, rc) => `${S.x1 && S.x1.address}|${a.v9}|${rc}`;
function showSimErr(q) {
  const ah = $("amtHint"), e = JSON.stringify(q.err || "");
  ah.className = "hint err";
  if (/InsufficientFunds|AccountNotFound|insufficient lamports/i.test(e + q.logs.join(" "))) ah.textContent = t("errNoXnt", "0.06");
  else if (/"Custom":1\b/.test(e) || q.logs.some((l) => /insufficient funds/i.test(l))) ah.textContent = t("errNoTok");
  else ah.textContent = t("errSim", e.slice(0, 80));
}
async function sendX2E() {
  if (SEND_LOCKED || S.busy || !S.x1 || !S.x2eQuote) return;
  const a = parseAmount($("amt").value), r = $("rcpt").value.trim();
  if (!a.v9 || !/^0x[0-9a-fA-F]{40}$/.test(r)) return;
  if (!S.lock.acquire()) return;   // NET-06
  const op = freezeOp("x2e", S.x1.address, r, a.v18), conn = S.x1, shown = S.x2eQuote;
  op.opId = CORE.newId();
  let sent = null, broadcast = false, released = false, tracking = null;
  const st = [{ c: "now" }];
  const release = () => { if (released) return; released = true; S.lock.release(); S.busy = false; S.opActive = false; lockForm(false); };
  try {
    const limOk = await refreshLimit(true);   // fresh read right before signing: the limit may have been used meanwhile
    const stop = !limOk ? "errLimit" : !actFresh() ? "errActStale" : null;
    if (stop || limitError(a.v18)) { validate(); if (stop) { $("amtHint").className = "hint err"; $("amtHint").textContent = t(stop); } return; }
    S.busy = true; S.opActive = true; lockForm(true); validate();
    S.stepsKey = "stepsX2E"; S.trackSeq++; renderSteps(st);
    const X = await loadX1();
    // R7-08: a fresh fee estimate right before the signature; a noticeably higher cost needs a new click
    const fresh = await X.preview({ owner: op.from, recipientEth: r, amount9: a.v9 });
    if (!fresh.ok) { showSimErr(fresh); throw new Error(t("errSim", JSON.stringify(fresh.err || "").slice(0, 60))); }
    if (CORE.feeRose(shown.total, fresh.total)) {
      S.x2eQuote = { ...fresh, key: x2eKey(a, "0x" + addrWord(r)), at: Date.now() };
      throw new Error(t("feeRoseX1", xnt(shown.total), xnt(fresh.total)));
    }
    // NET-04: right before the signature: the same wallet account, nothing changed since the preview, enough tokens and XNT
    const b = await X.balances(op.from);
    const pr = CORE.preSignProblems({ dir: "x2e", account: S.x1 && S.x1.address === op.from ? op.from : null, prepared: op.gen, current: S.opGen, balance: b.token9, amount: a.v9 });
    if (pr.length) throw new Error(pr[0] === "balance" ? t("preBalance") : "changed");
    if (CORE.xntShort(b.xnt, fresh.total)) throw new Error(t("noXntFee"));
    const res0 = writeOp({ v: 1, dir: "x2e", from: op.from, to: r, amount: op.v18.toString(), t: Date.now(), hb: Date.now(), stage: "signing", tx: null, id: null, opId: op.opId, owner: TAB_ID, rev: 1 });
    if (!res0) throw new Error("storage");   // R8-04
    op.reserved = true; startHb(op); verifiedOps.add(op.opId);
    const res = await X.send({ conn, recipientEth: r, amount9: a.v9,
      check: () => guardOp(op),   // R7-05 / R8-02: after the last await before the wallet, and again after the signature
      onSigned: (sig, lastValid) => {
        stopHb();
        const cur = loadOp();
        // R8-04: before the first broadcast: nothing goes out without a stored signature
        if (!(cur && cur.opId === op.opId && saveOpIf(cur, { ...cur, hb: Date.now(), stage: "sent", tx: sig, lastValid }))) throw new Error("storage");
        sent = sig;
      },
      steps: (k, sig) => { if (k === "sent") { broadcast = true; st[0] = { c: "done" }; st[1] = { c: "now", x: { k: "x1tx", v: sig } }; renderSteps(st); } } });
    st[1] = { c: "done", x: { k: "x1tx", v: res.signature } }; st[2] = { c: "now", x: { k: "txt", v: "0:00" } }; renderSteps(st);
    const cur = loadOp();
    if (!res.messageId) { if (cur && cur.opId === op.opId) saveOpIf(cur, { ...cur, stage: "unknown" }); st[2] = { c: "now", x: { k: "noid" } }; renderSteps(st); return; }
    tracking = cur && cur.opId === op.opId ? saveOpIf(cur, { ...cur, stage: "tracking", id: res.messageId }) : null;
    if (!tracking) { S.unsaved = { v: 1, dir: "x2e", from: op.from, stage: "unknown", tx: res.signature, t: Date.now() }; renderOp(); st[2] = { c: "now", x: { k: "storage", v: res.signature } }; renderSteps(st); return; }
    release(); $("amt").value = ""; S.x2eQuote = null; refreshX1Bal().then(validate);
  } catch (e) {
    const m = (e && e.message) || "", cur = loadOp(), mine = cur && cur.opId === op.opId;
    if (sent && broadcast) {
      if (/^tx-failed/.test(m)) { if (mine) clearOpIf(cur); }
      else if (!(mine && saveOpIf(cur, { ...cur, stage: "unknown", tx: sent }))) { S.unsaved = { v: 1, dir: "x2e", from: op.from, stage: "unknown", tx: sent, t: Date.now() }; renderOp(); }
    } else if (mine && !broadcast && (cur.stage === "signing" || cur.stage === "sent")) clearOpIf(cur);   // nothing was broadcast
    failStep(st, e, /^tx-failed/.test(m) || !broadcast ? null : sent, "x1");
  } finally { stopHb(); release(); renderOp(); validate(); }
  if (tracking) track(tracking, st);
}
// ===================== addresses =====================
function renderAddresses() {
  const rows = [
    [t("addr1"), `<a href="${NET.eth.explorer}/address/${NET.router}" target="_blank" rel="noopener"><code>${NET.router}</code></a>`],
    [t("addr2"), `<a href="${NET.x1.explorer}/address/${NET.x1Mint}" target="_blank" rel="noopener"><code>${NET.x1Mint}</code></a>`],
    [t("addr3"), `<a href="${NET.x1.explorer}/address/${NET.x1Program}" target="_blank" rel="noopener"><code>${NET.x1Program}</code></a>`],
  ];
  $("addrTable").innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  $("foot").textContent = t("foot", NET.eth.name, NET.x1.name) + " · " + PAGE_VERSION;
}

// ===================== recent transfers (activity.json from the server-side indexer) =====================
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u) ? u : null);
function dur(sec) {
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${Math.floor(sec / 3600)} h ${Math.round((sec % 3600) / 60)} min`;
}
// VMPX amount in a stat tile: compact above 1M (108.62M / 108,62 mln), full value in the tooltip
function setAmt(id, v) {
  const el = $(id);
  if (v === null || v === undefined) { el.textContent = "—"; el.removeAttribute("title"); return; }
  const full = fmt(v, 18, 9) + " VMPX";
  if (v >= 1000000n * 10n ** 18n) {
    el.textContent = new Intl.NumberFormat(t("locale"), { notation: "compact", maximumFractionDigits: 2 }).format(Number(v / 10n ** 14n) / 10000);
    el.title = full;
  } else { el.textContent = fmt(v, 18, 2); el.title = full; }
}
function renderStats() {
  const L = S.ledger, St = S.act && S.act.stats;
  setAmt("stX1", L && L.sup18 !== undefined ? L.sup18 : null);
  setAmt("stLock", L && L.locked !== undefined ? L.locked : null);
  const okTotal = L && L.total !== undefined && L.locked !== undefined && L.total >= L.locked;
  setAmt("stEth", okTotal ? L.total - L.locked : null);
  setAmt("stSupply", L && L.total !== undefined ? L.total : null);
  if (okTotal && L.total > 0n) {
    const bp = Number((L.locked * 1000000n) / L.total) / 10000;   // percent with 4 decimals
    const sep = LANG === "pl" ? "," : ".";
    $("stPct").textContent = (bp > 0 && bp < 0.01 ? "<0" + sep + "01" : bp.toFixed(2).replace(".", sep)) + " %";
  } else $("stPct").textContent = "—";
  const n = (v) => (Number.isInteger(v) ? v.toLocaleString(t("locale")) : "—");
  $("stTotal").textContent = St ? n(St.total) : "—";
  $("st24").textContent = St ? n(St.last24h) : "—";
  $("stE2X").textContent = St && Number.isInteger(St.median_e2x_s) ? dur(St.median_e2x_s) : "—";
  $("stX2E").textContent = St && Number.isInteger(St.median_x2e_s) ? dur(St.median_x2e_s) : "—";
  $("actBot").classList.toggle("hidden", !(St && St.last24h_bot > 0));
  const F = St && St.fees, big = (v) => { try { return BigInt(v); } catch { return 0n; } };
  if (F) {
    // only revenue that goes to the LP: VMPX (3 %, router v2) and the X1 mailbox protocol fee in XNT; ETH and IGP are cost coverage
    $("stFees").textContent = `${fmt(big(F.lp_vmpx), 18, 2)} VMPX + ${fmt(big(F.lp_xnt_lamports), 9, 4)} XNT`;
    $("stFees").title = `${fmt(big(F.lp_vmpx), 18, 18)} VMPX + ${fmt(big(F.lp_xnt_lamports), 9, 9)} XNT`;
    $("stFees24").textContent = t("fees24", fmt(big(F.lp_vmpx_24h), 18, 2), fmt(big(F.lp_xnt_lamports_24h), 9, 4));
  } else { $("stFees").textContent = "—"; $("stFees24").textContent = ""; }
}
function renderActivity() { if (S.ledger && !S.ledger.err) renderLedger(); else renderStats(); renderStatus(); }
// ---------- bridge status (computed by the indexer every minute; the page adds the age of the data) ----------
function bridgeState() {
  const A = S.act; if (!A || !A.status) return null;
  const age = Math.max(0, Math.floor(Date.now() / 1000) - (A.updated || 0));
  const checks = (A.status.checks || []).concat([{ id: "data", ok: age <= 300, value: age }]);
  let st = A.status.state;
  if (st === "live" && age > 300) st = "delays";
  return { st, checks, at: A.status.at, note: A.status.note };
}
function checkLine(c) {
  const f = t("bChk")[c.id]; if (!f) return null;
  const v = c.id === "pending" ? (c.value ? dur(c.value) : t("bNone")) : c.id === "data" ? dur(c.value || 0) : c.id === "limit" ? String(c.value ?? "?").replace(".", LANG === "pl" ? "," : ".") : c.id === "solvent" ? (c.value != null ? (BigInt(c.value) < 0n ? "-" : "") + fmt(BigInt(c.value) < 0n ? -BigInt(c.value) : BigInt(c.value), 18, 2) : "?") : null;
  return { mark: c.ok === true ? "✓" : c.ok === false ? "✗" : "?", cls: c.ok === true ? "ok" : c.ok === false ? (["eth_hook", "eth_ism", "x1_ism", "solvent"].includes(c.id) ? "bad" : "warn") : "warn", text: typeof f === "function" ? f(v) : f };
}
function renderStatus() {
  const B = bridgeState(), el = $("bStat"), box = $("bStatBox");
  const prev = S.paused; S.paused = !!B && (B.st === "paused" || B.st === "insolvent");
  if (!B) { el.classList.add("hidden"); box.classList.add("hidden"); return; }
  const label = t(B.st === "live" ? "bLive" : B.st === "insolvent" ? "bInsolvent" : B.st === "paused" ? "bPaused" : "bDelays");
  const when = new Date(B.at * 1000).toLocaleTimeString(t("locale"));
  const lines = B.checks.map(checkLine).filter(Boolean);
  el.className = "bstat " + B.st; el.classList.remove("hidden"); $("bStatTxt").textContent = label;
  el.title = `${label} · ${t("bChecked", when)}\n` + lines.map((l) => `${l.mark} ${l.text}`).join("\n");
  el.setAttribute("aria-label", el.title);
  box.className = "card bstatbox " + B.st;
  box.innerHTML = `<div class="bhead"><span class="dot" aria-hidden="true"></span><span>${esc(label)}</span><small class="muted">${esc(t("bChecked", when))}</small></div>` +
    `<ul>${lines.map((l) => `<li class="${l.cls}"><b>${l.mark}</b>${esc(l.text)}</li>`).join("")}</ul>` +
    (B.note && (B.note[LANG] || B.note.en) ? `<p class="small u-note">${esc(B.note[LANG] || B.note.en)}</p>` : "");
  const note = B.note && (B.note[LANG] || B.note.en);
  $("bNote").classList.toggle("hidden", !note); $("bNote").textContent = note || "";
  $("pauseMsg").classList.toggle("hidden", !S.paused); $("pauseMsg").textContent = !S.paused ? "" : B.st === "insolvent" ? t("insolventMsg") : t("pausedMsg");
  if (prev !== S.paused) validate();
}   // the list moved to the Transactions tab; activity.json still feeds the stats

async function refreshActivity() {
  try {
    const r = await fetch("activity.json?t=" + Date.now(), { cache: "no-store" });
    if (!r.ok) throw new Error(String(r.status));
    S.act = await r.json(); S.actErr = false;
  } catch { S.actErr = true; }
  renderActivity();
}

// ===================== transactions tab (read-only /api/ on the same origin) =====================
// Routes: #/ bridge · #/tx?dir=&bot=&page= list · #/tx?q= search · #/tx/<messageId> details
const RE_ETH_ADDR = /^0x[0-9a-fA-F]{40}$/, RE_HASH32 = /^0x[0-9a-fA-F]{64}$/;
const RE_X1_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/, RE_X1_SIG = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/;
const validQ = (q) => RE_ETH_ADDR.test(q) || RE_HASH32.test(q) || RE_X1_ADDR.test(q) || RE_X1_SIG.test(q);
const TX = { route: null, data: null, err: null, loading: false, timer: null, seq: 0 };
function txFilters() {
  let f = { dir: "all", bot: "all" };
  try { const v = JSON.parse(localStorage.getItem("vmpx-tx-filters") || "{}"); if (["all", "e2x", "x2e"].includes(v.dir)) f.dir = v.dir; if (["all", "human", "bot"].includes(v.bot)) f.bot = v.bot; } catch {}
  return f;
}
function parseRoute() {
  const h = location.hash.replace(/^#/, "");
  if (/^\/wp(\?|$)/.test(h)) return { view: "wp" };   // White Paper, rendered by wp.js from wp/<lang>.json
  if (h.startsWith("/stats")) {
    const b = new URLSearchParams(h.split("?")[1] || "").get("bot");
    return { view: "stats", bot: ["all", "human", "bot"].includes(b) ? b : "all" };
  }
  if (!h.startsWith("/tx")) return { view: "bridge" };
  const m = h.match(/^\/tx\/(0x[0-9a-fA-F]{64})$/);
  if (m) return { view: "detail", id: m[1].toLowerCase() };
  const qs = new URLSearchParams(h.split("?")[1] || "");
  const q = (qs.get("q") || "").trim();
  if (q) return { view: "search", q };
  const f = txFilters();
  const dir = ["all", "e2x", "x2e"].includes(qs.get("dir")) ? qs.get("dir") : f.dir;
  const bot = ["all", "human", "bot"].includes(qs.get("bot")) ? qs.get("bot") : f.bot;
  const page = Math.min(1000, Math.max(1, parseInt(qs.get("page") || "1", 10) || 1));
  return { view: "list", dir, bot, page };
}
// dir and bot are ALWAYS written, also "all": a missing parameter falls back to the filter remembered in localStorage
// (parseRoute), so leaving "all" out made "All" impossible to choose after another filter had been used (since 11cd406)
function listHash(r) {
  const p = new URLSearchParams({ dir: r.dir, bot: r.bot });
  if (r.page > 1) p.set("page", r.page);
  return "#/tx?" + p.toString();
}
async function apiGet(path) {
  const r = await fetch(path, { headers: { accept: "application/json" } });
  if (r.status === 429) throw new Error("busy");
  if (!r.ok && r.status !== 400) throw new Error(String(r.status));
  const j = await r.json(); if (r.status === 400) throw new Error("bad");
  return j;
}
async function loadTx(quiet) {
  const r = TX.route, seq = ++TX.seq;
  if (!quiet) { TX.loading = true; TX.data = null; TX.err = null; renderTx(); }
  let path;
  if (r.view === "list") path = `/api/transfers?page=${r.page}&dir=${r.dir}&bot=${r.bot}`;
  else path = "/api/search?q=" + encodeURIComponent(r.view === "detail" ? r.id : r.q);
  try {
    const d = await apiGet(path);
    if (seq !== TX.seq) return;
    TX.data = d; TX.err = null;
    if (r.view === "search" && d.items.length === 1 && (RE_HASH32.test(r.q) || RE_X1_SIG.test(r.q))) { location.replace("#/tx/" + d.items[0].id); return; }
  } catch (e) { if (seq !== TX.seq) return; TX.err = e.message === "busy" ? "txBusy" : e.message === "bad" ? "txBadQ" : "txErr"; }
  TX.loading = false; renderTx(); scheduleTx();
}
function scheduleTx() {
  clearTimeout(TX.timer);
  const r = TX.route; if (!r || r.view === "bridge") return;
  if (r.view === "detail" && TX.data && TX.data.items[0] && TX.data.items[0].status !== "delivered") TX.timer = setTimeout(() => loadTx(true), 15000);
  else if (r.view === "list" && r.page === 1) TX.timer = setTimeout(() => loadTx(true), 30000);
}
// v47: a view change (tab, link #/tx, #/stats, #/wp, White Paper button, paging, filters, search) never leaves the ANL bar
// and the wallet header off screen. A position above the tabs is kept; below the tabs the page goes back to the very
// top, instantly, and is checked again after the view's asynchronous content has rendered, unless the user has scrolled
// in the meantime. The browser's own scroll restoration is off: hash routes are handled here.
try { history.scrollRestoration = "manual"; } catch {}
let userScrollAt = 0, routeAt = 0, revealWanted = false;
["wheel", "touchmove", "keydown"].forEach((ev) => addEventListener(ev, () => { userScrollAt = Date.now(); }, { passive: true }));
// A position is kept only while the ANL bar is still fully on screen (it is the first element of the page, so in
// practice: the very top). Anything lower — inside the header or below the tabs — goes back to the top, so that the ANL
// bar, the wallet header and the tabs are visible after every view change (owner, 1 Nov 2026).
function barKeepY() { const b = $("ecoBar"); return b ? Math.max(0, Math.round(b.getBoundingClientRect().top + window.scrollY)) : 0; }
// The decision is taken from the position BEFORE the view changes: a shorter new view makes the browser clamp the
// scroll position to its new maximum, which can land just above the tabs with the ANL bar and the header still hidden.
function revealTop() {
  if (!revealWanted || userScrollAt > routeAt) return;
  if (window.scrollY !== 0) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
}
function revealAfterRender() { revealTop(); requestAnimationFrame(() => requestAnimationFrame(revealTop)); }
function onRoute(focus) {
  const r = parseRoute(); TX.route = r;
  if (focus) { routeAt = Date.now(); revealWanted = window.scrollY > barKeepY(); revealTop(); }
  const stats = r.view === "stats", wp = r.view === "wp", tx = r.view !== "bridge" && !stats && !wp;
  $("viewBridge").classList.toggle("hidden", tx || stats || wp); $("viewTx").classList.toggle("hidden", !tx); $("viewStats").classList.toggle("hidden", !stats);
  $("viewWp").classList.toggle("hidden", !wp);
  $("tabBridge").setAttribute("aria-current", tx || stats || wp ? "false" : "page"); $("tabTx").setAttribute("aria-current", tx ? "page" : "false");
  $("tabStats").setAttribute("aria-current", stats ? "page" : "false");
  clearTimeout(TX.timer);
  if (!wp && window.WP) window.WP.hide();
  if (wp) {   // the White Paper lives in wp.js, loaded on first use; DOM built with createElement/textContent only
    (window.__wpLib ||= loadScript("wp.js?v=2")).then(() => window.WP.show(focus)).then(() => { if (focus) revealAfterRender(); }).catch(() => { $("wpBody").textContent = t("wpErr"); });
    return;
  }
  if (stats) {   // the Statistics tab lives in stats.js, loaded on first use
    (window.__statsLib ||= loadScript("stats.js?v=9")).then(() => window.STATS.show(r, focus)).then(() => { if (focus) revealAfterRender(); }).catch(() => { $("stBody").textContent = t("txErr"); });
    return;
  }
  if (!tx) {
    if (location.hash === "#/tokens") setTimeout(() => $("tokens").scrollIntoView({ block: "start" }), 0);
    else if (focus) revealAfterRender();
    return;
  }
  if (r.view === "list") try { localStorage.setItem("vmpx-tx-filters", JSON.stringify({ dir: r.dir, bot: r.bot })); } catch {}
  $("txQ").value = r.view === "search" ? r.q : ""; $("txHint").textContent = ""; $("txHint").className = "hint";
  loadTx(false).then(() => { if (focus) revealAfterRender(); }).catch(() => {});
  if (focus) { revealAfterRender(); $("txH").focus({ preventScroll: true }); }
}
const chainOf = (a) => (a && a.startsWith("0x") ? "Ethereum" : "X1");
const amtOf = (i, max) => (/^\d+$/.test(String(i.amount)) ? fmt(BigInt(i.amount), 18, max) : "?") + " " + (i.dir === "e2x" ? NET.symEth : NET.symX1);
const whenOf = (ts) => (ts ? new Date(ts * 1000).toLocaleString(t("locale"), { dateStyle: "medium", timeStyle: "medium" }) : "");
function statusOf(i) {
  const now = Math.floor(Date.now() / 1000);
  return i.status === "delivered"
    ? `<span class="ok">${esc(i.seconds != null ? t("actDone", dur(i.seconds)) : t("actDoneNoTime"))}</span>`
    : `<span class="wait">${esc(t("dPending", i.sent ? dur(Math.max(0, now - i.sent)) : "?"))}</span>`;
}
function txRow(i) {
  const e2x = i.dir === "e2x";
  const who = (i.sender ? esc(short(i.sender)) + " → " : "→ ") + esc(short(i.recipient || "—"));
  const tag = i.bot === true ? `<span class="tag">${esc(t("botTag"))}</span>` : "";
  const when = i.sent ? new Date(i.sent * 1000).toLocaleString(t("locale"), { dateStyle: "short", timeStyle: "short" }) : "";
  return `<li><span class="dir ${e2x ? "e2x" : "x2e"}"><a href="#/tx/${esc(i.id)}">${e2x ? "Ethereum → X1" : "X1 → Ethereum"}</a>${tag}</span><span class="who">${who}</span><span class="amt num">${esc(amtOf(i, 4))}</span><span class="meta">${esc(when)} · ${statusOf(i)} · <a href="#/tx/${esc(i.id)}">${esc(t("actDetails"))}</a></span></li>`;
}
const copyBtn = (v) => `<button type="button" class="copy" data-copy="${esc(v)}">${esc(t("copy"))}</button>`;
function linkOr(text, url) { const u = safeUrl(url); return u ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text); }
function txDetail(i) {
  const e2x = i.dir === "e2x", src = e2x ? "Ethereum" : "X1", dst = e2x ? "X1" : "Ethereum";
  const addr = (a) => (a ? `<code>${esc(a)}</code>${copyBtn(a)}` : `<span class="muted">${esc(t("dUnknown"))}</span>`);
  const txl = (h, url, ts, approx) => (h || url
    ? `${esc(whenOf(ts))}${approx ? ` <span class="muted">(${esc(t("dApprox"))})</span>` : ""}<br>${h ? `${linkOr(h, url)}${copyBtn(h)}` : linkOr(t("tx"), url)}`
    : esc(ts ? whenOf(ts) : t("dNotYet")));
  const rows = [
    [t("dStatus"), statusOf(i) + (i.bot ? `<span class="tag">${esc(t("botTag"))}</span>` : "")],
    [t("dDir"), `<span class="dir ${e2x ? "e2x" : "x2e"}">${src} → ${dst}</span>`],
    [t("dAmount"), `<span class="num">${esc(amtOf(i, 9))}</span>`],
    [`${t("dFrom")} <span class="muted">(${src})</span>`, addr(i.sender)],
  ];
  if (i.fee_payer && i.fee_payer !== i.sender) rows.push([t("dFeePayer"), addr(i.fee_payer)]);
  rows.push([`${t("dTo")} <span class="muted">(${dst})</span>`, addr(i.recipient)],
    [`${t("dSent")} <span class="muted">(${src})</span>`, txl(i.sent_tx, i.sent_link, i.sent, false)],
    [`${t("dRecv")} <span class="muted">(${dst})</span>`, i.status === "delivered" ? txl(i.delivered_tx, i.delivered_link, i.delivered, i.approx) : esc(t("dNotYet"))]);
  if (i.seconds != null) rows.push([t("dDur"), esc(dur(i.seconds))]);
  if (e2x && /^\d+$/.test(String(i.fee_wei || ""))) rows.push([t("dFeeEth"), `<span class="num">${esc(fmt(BigInt(i.fee_wei), 18, 6))} ETH</span>`]);
  if (!e2x && Number.isInteger(i.protocol_lamports)) rows.push([t("dFeeProto"), `<span class="num">${esc(fmt(BigInt(i.protocol_lamports), 9, 6))} XNT</span>`]);
  if (!e2x && Number.isInteger(i.igp_lamports)) rows.push([t("dFeeX1"), `<span class="num">${esc(fmt(BigInt(i.igp_lamports), 9, 6))} XNT</span>`]);
  rows.push([t("dMsg"), `<code>${esc(i.id)}</code>${copyBtn(i.id)}`]);
  return `<h2 class="txdh">${esc(t("txDetailH"))}</h2><dl class="txd">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <p><button type="button" class="txbtn ghost" data-copy="${esc(location.origin + location.pathname + "#/tx/" + i.id)}">${esc(t("share"))}</button></p>`;
}
function renderTx() {
  const r = TX.route; if (!r || r.view === "bridge" || r.view === "wp") return;
  const list = r.view === "list";
  $("txFilters").classList.toggle("hidden", !list); $("txPager").classList.toggle("hidden", !list);
  $("txBack").classList.toggle("hidden", list);
  document.querySelectorAll("#fDir button").forEach((b) => b.setAttribute("aria-pressed", list && b.dataset.v === r.dir));
  document.querySelectorAll("#fBot button").forEach((b) => b.setAttribute("aria-pressed", list && b.dataset.v === r.bot));
  const body = $("txBody"), D = TX.data;
  if (TX.loading && !D) { body.innerHTML = `<p class="muted">${esc(t("txLoading"))}</p>`; $("txInfo").textContent = ""; return; }
  if (TX.err && !D) { body.innerHTML = `<p class="hint err">${esc(t(TX.err))}</p>`; $("txInfo").textContent = ""; return; }
  if (!D) return;
  if (r.view === "detail") {
    $("txInfo").textContent = "";
    body.innerHTML = D.items[0] ? txDetail(D.items[0]) : `<p class="muted">${esc(t("txNotFound"))}</p>`;
    return;
  }
  if (r.view === "search") {
    $("txInfo").innerHTML = `${esc(t("txResults", D.items.length))} · <a href="${listHash({ ...txFilters(), page: 1 })}">${esc(t("txClear"))}</a>`;
    body.innerHTML = D.items.length ? `<ol class="acts txl">${D.items.map(txRow).join("")}</ol>` : `<p class="muted">${esc(t("txNoResults"))}</p>`;
    return;
  }
  $("txInfo").textContent = t("txTotal", D.total);
  body.innerHTML = D.items.length ? `<ol class="acts txl">${D.items.map(txRow).join("")}</ol>` : `<p class="muted">${esc(t("txEmpty"))}</p>`;
  $("txPageNo").textContent = t("txPage", D.page, D.pages);
  $("txPrevBtn").disabled = D.page <= 1; $("txNextBtn").disabled = D.page >= D.pages;
}
function initTx() {
  document.querySelectorAll("#fDir button").forEach((b) => b.onclick = () => { location.hash = listHash({ ...TX.route, dir: b.dataset.v, page: 1 }); });
  document.querySelectorAll("#fBot button").forEach((b) => b.onclick = () => { location.hash = listHash({ ...TX.route, bot: b.dataset.v, page: 1 }); });
  $("txPrevBtn").onclick = () => { location.hash = listHash({ ...TX.route, page: TX.route.page - 1 }); };
  $("txNextBtn").onclick = () => { location.hash = listHash({ ...TX.route, page: TX.route.page + 1 }); };
  $("txSearch").onsubmit = (e) => {
    e.preventDefault();
    const q = $("txQ").value.trim();
    if (!q) { location.hash = listHash({ ...txFilters(), page: 1 }); return; }
    if (!validQ(q)) { $("txHint").textContent = t("txBadQ"); $("txHint").className = "hint err"; return; }
    location.hash = RE_HASH32.test(q) ? "#/tx?q=" + q.toLowerCase() : "#/tx?q=" + encodeURIComponent(q);
  };
  $("txQ").oninput = () => { $("txHint").textContent = ""; $("txHint").className = "hint"; };
  document.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-copy]"); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); const old = b.textContent; b.textContent = t("copied"); setTimeout(() => { b.textContent = old; }, 1500); } catch {}
  });
  window.addEventListener("hashchange", () => onRoute(true));
  onRoute(false);
}

// ===================== language switch =====================
function setLang(l) {
  LANG = I18N[l] ? l : "en";
  try { localStorage.setItem("vmpx-lang", LANG); } catch {}
  document.documentElement.lang = LANG;
  document.title = t("title");
  document.querySelector('meta[name="description"]').content = t("desc");
  document.querySelectorAll("[data-i18n]").forEach((el) => { if (!(el.id === "wallet" && S.account) && !(el.id === "wallet1" && S.x1) && el.id !== "walletAny" && el.id !== "go") el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  document.querySelectorAll("[data-i18n-aria]").forEach((el) => el.setAttribute("aria-label", t(el.dataset.i18nAria)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => el.title = t(el.dataset.i18nTitle));
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => el.placeholder = t(el.dataset.i18nPh));
  document.querySelectorAll("a[data-href-pl]").forEach((a) => {
    if (!a.dataset.hrefEn) a.dataset.hrefEn = a.getAttribute("href");
    a.setAttribute("href", LANG === "pl" ? a.dataset.hrefPl : a.dataset.hrefEn);
  });
  $("lnEN").setAttribute("aria-pressed", LANG === "en"); $("lnPL").setAttribute("aria-pressed", LANG === "pl");
  renderEthBal(); renderNet();
  if (S.dir === "x2e") renderX1Bal();
  if (S.x1) $("wallet1").textContent = short(S.x1.address);
  if (!$("x1pick").classList.contains("hidden")) renderSheet();
  renderAnyWallet();
  labelDir(); renderAddresses(); renderLedger(); renderSteps(); renderActivity(); renderTx(); validate();
  if (window.STATS) window.STATS.rerender();
  if (window.WP) window.WP.rerender();
}

// ===================== start =====================
$("lnEN").onclick = () => setLang("en");
$("lnPL").onclick = () => setLang("pl");
$("wallet").onclick = () => (S.account ? openSheet("ethMenu") : connect());
$("swap").onclick = () => setDir(S.dir === "e2x" ? "x2e" : "e2x");
$("amt").oninput = () => { S.changedNote = false; validate(); };
$("rcpt").oninput = () => { const v = $("rcpt").value.trim(); S.rcptEdited = !!v && v !== ownDest(); S.changedNote = false; validate(); };
$("maxBtn").onclick = () => {
  if (S.bal !== null && S.dir === "e2x") { $("amt").value = plain(S.bal - (S.bal % UNIT), 18, 9); validate(); }
  if (S.x1bal && S.dir === "x2e") { $("amt").value = plain(S.x1bal.token9 * UNIT, 18, 9); validate(); }
};
$("selfBtn").onclick = () => { const own = ownDest(); if (own) { $("rcpt").value = own; S.rcptEdited = false; validate(); } };
$("chainBarBtn").onclick = switchChain;
$("rpcBarBtn").onclick = retryReads;
window.addEventListener("online", () => { renderNet(); retryReads(); });
window.addEventListener("offline", renderNet);
document.addEventListener("click", (e) => { if (e.target.closest("button[data-reconnect]")) disconnectX1().then(openX1Picker); });
$("form").onsubmit = (e) => {
  e.preventDefault(); if (SEND_LOCKED) return;
  if (S.dir === "x2e") return S.x1 ? withSendLock(sendX2E) : openX1Picker();
  if (!S.account) return connect(); withSendLock(sendE2X);
};
$("wallet1").onclick = () => (S.x1 ? openSheet("x1Menu") : openX1Picker());
$("walletAny").onclick = () => openSheet("connect");
$("walletX").onclick = () => disconnectEth();
$("wallet1X").onclick = () => disconnectX1();
// EIP-747: offer the test VMPX token to the wallet, on Sepolia
$("watchBtn").onclick = async () => {
  const hint = $("watchHint"); hint.className = "hint"; hint.textContent = "";
  if (!window.ethereum) { if (isMobile()) return openSheet("deep"); hint.textContent = t("noWallet"); return; }
  try {
    if ((await window.ethereum.request({ method: "eth_chainId" })) !== NET.eth.chainId)
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: NET.eth.chainId }] });
    const ok = await window.ethereum.request({ method: "wallet_watchAsset", params: { type: "ERC20", options: { address: "0xCC0c84755384b041470C021D338639EDa8831E09", symbol: "VMPX", decimals: 18 } } });
    hint.textContent = ok ? t("tokAdded") : t("tokRejected");
  } catch { hint.className = "hint err"; hint.textContent = t("tokRejected"); }
};
// footer "On-chain contracts": Testnet / Mainnet chip sets (static markup, only visibility changes)
function setCtrNet(main) {
  $("chipsTest").classList.toggle("hidden", main); $("chipsMain").classList.toggle("hidden", !main);
  $("ctrTest").setAttribute("aria-pressed", String(!main)); $("ctrMain").setAttribute("aria-pressed", String(main));
}
$("ctrTest").onclick = () => setCtrNet(false);
$("ctrMain").onclick = () => setCtrNet(true);
// ecosystem bar on a narrow screen: scroll the tab row so the current page (VMPX Bridge) is visible
function ecoInView() {
  const row = $("ecoTabs"), on = row && row.querySelector(".ecotab.on");
  if (on && on.offsetLeft + on.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = on.offsetLeft + on.offsetWidth - row.clientWidth;
  ecoEdge();
}
// the fade on the right edge hints at more tabs; gone once the row is scrolled to its end
function ecoEdge() { const row = $("ecoTabs"); row.classList.toggle("end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 1); }
$("ecoTabs").addEventListener("scroll", ecoEdge, { passive: true });
ecoInView(); window.addEventListener("resize", ecoInView); if (document.fonts) document.fonts.ready.then(ecoInView);
$("x1pickClose").onclick = () => $("x1pick").classList.add("hidden");
if (PREVIEW) document.querySelector(".notice").dataset.i18nHtml = "noticePreview";
// NET-04 (EIP-1193 events): another account, another network or a disconnect void the prepared operation, without a reload
// (a reload would also stop the tracking of a transfer in flight)
if (window.ethereum && window.ethereum.on) {
  window.ethereum.on("accountsChanged", (a) => {
    const n = Array.isArray(a) && a[0];
    if (!n) { if (S.account) disconnectEth(true); return; }
    if (S.account && n.toLowerCase() !== S.account.toLowerCase()) { S.account = n; $("wallet").textContent = short(n); renderAnyWallet(); invalidate(); }
  });
  window.ethereum.on("chainChanged", (cid) => { S.chainId = cid; S.wrongChain = cid !== NET.eth.chainId; renderNet(); if (S.account) invalidate(); });
  window.ethereum.on("disconnect", () => { if (S.account) invalidate(); });
}
setLang(LANG); setDir("e2x"); refreshLedger(); setInterval(refreshLedger, 30000);
refreshActivity(); setInterval(refreshActivity, 30000);
initTx();
renderNet(); renderOp(); restoreEth(); restoreX1();
// R7-06: other tabs see the operation record change; a stale "signing" record turns into "unknown" without any event
window.addEventListener("storage", (e) => { if (e.key === OP_KEY || e.key === null) { renderOp(); validate(); } });
setInterval(() => { renderOp(); if (S.dir === "x2e" && S.x2eQuote && !CORE.quoteFresh(S.x2eQuote, Date.now()) && !S.busy) validate(); }, 5000);
$("opCheckBtn").onclick = () => reconcileOp();
$("opClearBtn").onclick = async () => {
  const r = blockingOp();
  if (!r) return;
  // R9-02: the first click remembers WHICH operation (opId + revision); the second must find the very same one
  if (!armed || armed.opId !== (r.opId || null) || armed.rev !== (r.rev || 0) || armed.tx !== (r.tx || null) || Date.now() - armed.at > 10000) {
    armed = { opId: r.opId || null, rev: r.rev || 0, tx: r.tx || null, at: Date.now() }; renderOp(); return;
  }
  const a = armed; armed = null;
  if (r === S.unsaved) { S.unsaved = null; renderOp(); validate(); return; }
  if (!a.opId) { renderOp(); return; }   // a record without identity is first reconciled (it gets one), then it can be unlocked
  await underOpLock(() => { clearOpIf(a); renderOp(); validate(); }, () => { $("amtHint").className = "hint err"; $("amtHint").textContent = t("otherTabSending"); renderOp(); });
};
