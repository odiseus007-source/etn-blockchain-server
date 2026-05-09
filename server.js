require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());
app.use(cors());

// ── ETN Smart Chain 설정 ──────────────────────────
const ETN_RPC = 'https://rpc.electroneum.com';

// ── 환경변수 ─────────────────────────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const MAX_DAILY   = parseInt(process.env.MAX_DAILY || '3');
const MAX_ETN_PER_CLAIM = parseInt(process.env.MAX_ETN || '10');

if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY 환경변수가 없습니다!');
  process.exit(1);
}

// ── Provider / Wallet ────────────────────────────
const provider = new ethers.providers.JsonRpcProvider(ETN_RPC);
const wallet   = new ethers.Wallet(PRIVATE_KEY, provider);
console.log('✅ 보상 지갑:', wallet.address);

// ── 하루 클레임 카운터 ────────────────────────────
let claimLog = {};

function todayKey(address) {
  return address.toLowerCase() + '_' + new Date().toISOString().slice(0, 10);
}
function getDailyClaims(address) { return claimLog[todayKey(address)] || 0; }
function addClaim(address) {
  const k = todayKey(address);
  claimLog[k] = (claimLog[k] || 0) + 1;
}
// 매시간 오래된 로그 정리
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  Object.keys(claimLog).forEach(k => { if (!k.includes(today)) delete claimLog[k]; });
}, 3600000);

// ── 잔액 조회 ────────────────────────────────────
async function getBalance() {
  const bal = await provider.getBalance(wallet.address);
  return parseFloat(ethers.utils.formatEther(bal));
}

// ── ETN 전송 ─────────────────────────────────────
async function sendETN(toAddress, amount) {
  const amountWei = ethers.utils.parseEther(amount.toString());
  const balance   = await provider.getBalance(wallet.address);
  if (balance.lt(amountWei)) throw new Error('보상 지갑 잔액 부족');

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: amountWei,
    gasLimit: 21000,
  });
  console.log(`📤 전송: ${amount} ETN → ${toAddress} | tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ 완료: ${receipt.transactionHash}`);
  return receipt.transactionHash;
}

// ── 라우트 ───────────────────────────────────────

// 헬스체크
app.get('/health', async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({ status: 'ok', wallet: wallet.address, balance: balance.toFixed(2) + ' ETN' });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// 풀 정보
app.get('/pool-info', async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({ success: true, poolEtn: Math.floor(balance * 10) / 10, online: Math.floor(Math.random() * 20) + 3 });
  } catch (e) {
    res.json({ success: false, poolEtn: 0, online: 1 });
  }
});

// ETN 전송
app.post('/send-etn', async (req, res) => {
  const { address, amount, score, lines } = req.body;

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return res.status(400).json({ success: false, message: '올바른 ETN 주소가 아닙니다 (0x로 시작)' });

  const etnAmount = parseInt(amount);
  if (!etnAmount || etnAmount <= 0)
    return res.status(400).json({ success: false, message: '전송할 ETN이 없습니다' });

  if (etnAmount > MAX_ETN_PER_CLAIM)
    return res.status(400).json({ success: false, message: `최대 ${MAX_ETN_PER_CLAIM} ETN까지 가능합니다` });

  if (getDailyClaims(address) >= MAX_DAILY)
    return res.status(429).json({ success: false, message: `하루 최대 ${MAX_DAILY}회까지 가능합니다` });

  if (lines < etnAmount * 10)
    return res.status(400).json({ success: false, message: '게임 기록과 ETN 수량이 맞지 않습니다' });

  try {
    console.log(`🎮 클레임: ${address} | ${etnAmount} ETN | 줄:${lines}`);
    const txHash = await sendETN(address, etnAmount.toString());
    addClaim(address);
    res.json({ success: true, txHash, message: `${etnAmount} ETN 전송 완료!` });
  } catch (e) {
    console.error('❌ 실패:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── 시작 ─────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 서버 실행중 포트 ${PORT}`);
  console.log(`💰 지갑: ${wallet.address}`);
});
