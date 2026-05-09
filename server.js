require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());
app.use(cors());

// ── ETN Smart Chain 설정 ──────────────────────────
const ETN_RPC = 'https://rpc.electroneum.com';
const CHAIN_ID = 52014;
const ETN_PER_REWARD = '1'; // 1 ETN per reward

// ── 환경변수 (Railway에서 설정) ───────────────────
const PRIVATE_KEY = process.env.PRIVATE_KEY;       // 보상 지갑 개인키
const MAX_DAILY    = parseInt(process.env.MAX_DAILY || '3');
const MAX_ETN_PER_CLAIM = parseInt(process.env.MAX_ETN || '10'); // 1회 최대 ETN

if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY 환경변수가 없습니다!');
  process.exit(1);
}

// ── Provider / Wallet 초기화 ─────────────────────
const provider = new ethers.JsonRpcProvider(ETN_RPC, {
  chainId: CHAIN_ID,
  name: 'electroneum'
});

const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
console.log('✅ 보상 지갑 주소:', wallet.address);

// ── 하루 클레임 카운터 (메모리, 날짜 바뀌면 초기화) ──
let claimLog = {}; // { 'address_YYYY-MM-DD': count }

function todayKey(address) {
  const today = new Date().toISOString().slice(0, 10);
  return `${address.toLowerCase()}_${today}`;
}

function getDailyClaims(address) {
  return claimLog[todayKey(address)] || 0;
}

function addClaim(address) {
  const key = todayKey(address);
  claimLog[key] = (claimLog[key] || 0) + 1;
}

// 자정마다 오래된 로그 정리
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  Object.keys(claimLog).forEach(k => {
    if (!k.includes(today)) delete claimLog[k];
  });
}, 1000 * 60 * 60); // 1시간마다

// ── 잔액 조회 ────────────────────────────────────
async function getBalance() {
  const bal = await provider.getBalance(wallet.address);
  return parseFloat(ethers.formatEther(bal));
}

// ── ETN 전송 함수 ─────────────────────────────────
async function sendETN(toAddress, amount) {
  const amountWei = ethers.parseEther(amount.toString());

  // 잔액 체크
  const balance = await provider.getBalance(wallet.address);
  const gasEstimate = ethers.parseEther('0.01'); // 여유 가스비
  if (balance < amountWei + gasEstimate) {
    throw new Error('보상 지갑 잔액 부족');
  }

  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: amountWei,
    gasLimit: 21000,
  });

  console.log(`📤 전송중: ${amount} ETN → ${toAddress} | tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ 완료: ${receipt.hash}`);
  return receipt.hash;
}

// ── API 라우트 ────────────────────────────────────

// 풀 정보 (잔액 + 접속자 시뮬레이션)
app.get('/pool-info', async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({
      success: true,
      poolEtn: Math.floor(balance * 10) / 10,
      online: Math.floor(Math.random() * 20) + 3
    });
  } catch (e) {
    res.json({ success: false, poolEtn: 0, online: 1 });
  }
});

// 헬스체크
app.get('/health', async (req, res) => {
  try {
    const balance = await getBalance();
    res.json({
      status: 'ok',
      wallet: wallet.address,
      balance: balance.toFixed(2) + ' ETN'
    });
  } catch (e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ETN 전송 요청
app.post('/send-etn', async (req, res) => {
  const { address, amount, score, lines } = req.body;

  // ── 입력값 검증 ──
  if (!address || typeof address !== 'string') {
    return res.status(400).json({ success: false, message: '주소가 없습니다' });
  }

  // ETN-SC 주소 형식 검증 (0x로 시작하는 42자리)
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ success: false, message: '올바른 ETN 주소가 아닙니다 (0x로 시작하는 주소)' });
  }

  const etnAmount = parseInt(amount);
  if (!etnAmount || etnAmount <= 0) {
    return res.status(400).json({ success: false, message: '전송할 ETN이 없습니다' });
  }

  if (etnAmount > MAX_ETN_PER_CLAIM) {
    return res.status(400).json({ success: false, message: `최대 ${MAX_ETN_PER_CLAIM} ETN까지 가능합니다` });
  }

  // ── 하루 클레임 횟수 체크 ──
  const dailyClaims = getDailyClaims(address);
  if (dailyClaims >= MAX_DAILY) {
    return res.status(429).json({
      success: false,
      message: `하루 최대 ${MAX_DAILY}회까지 가능합니다`
    });
  }

  // ── 게임 점수 최소 검증 (10줄 = 1 ETN 이므로) ──
  if (lines < etnAmount * 10) {
    return res.status(400).json({
      success: false,
      message: '게임 기록과 ETN 수량이 맞지 않습니다'
    });
  }

  try {
    console.log(`🎮 클레임 요청: ${address} | ${etnAmount} ETN | 점수:${score} 줄:${lines}`);
    const txHash = await sendETN(address, etnAmount.toString());
    addClaim(address);

    res.json({
      success: true,
      txHash,
      message: `${etnAmount} ETN 전송 완료!`
    });
  } catch (e) {
    console.error('❌ 전송 실패:', e.message);
    res.status(500).json({
      success: false,
      message: e.message || '전송 중 오류 발생'
    });
  }
});

// ── 서버 시작 ─────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 ETN BLOCKCHAIN 서버 실행중 - 포트 ${PORT}`);
  console.log(`💰 보상 지갑: ${wallet.address}`);
});
