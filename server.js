require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const { ethers } = require('ethers');

const app = express();
app.use(express.json());
app.use(cors());

// ── ETN Smart Chain RPC ───────────────────────────
const RPC_URLS = [
  'https://rpc.ankr.com/electroneum',
  'https://rpc.electroneum.com',
  'https://etn.llamarpc.com',
];

async function getProvider() {
  for (const url of RPC_URLS) {
    try {
      const p = new ethers.providers.JsonRpcProvider(url);
      await p.getNetwork();
      console.log('✅ RPC 연결 성공:', url);
      return p;
    } catch(e) {
      console.log('❌ RPC 실패:', url, e.message);
    }
  }
  throw new Error('모든 RPC 연결 실패');
}

// ── 환경변수 ──────────────────────────────────────
const PRIVATE_KEY       = process.env.PRIVATE_KEY;
const MAX_DAILY         = parseInt(process.env.MAX_DAILY || '3');
const MAX_ETN_PER_CLAIM = parseInt(process.env.MAX_ETN   || '10');

if (!PRIVATE_KEY) {
  console.error('❌ PRIVATE_KEY 없음');
  process.exit(1);
}

// ── 개인키 정리 (Base64 자동 변환) ───────────────
function prepareKey(raw) {
  // 공백·줄바꿈 제거
  let k = raw.trim().replace(/[\r\n\s]/g, '');

  // 이미 hex 64자리면 그대로
  const hexOnly = k.replace(/^0x/i, '');
  if (/^[0-9a-fA-F]{64}$/.test(hexOnly)) {
    console.log('✅ hex 개인키');
    return '0x' + hexOnly;
  }

  // Base64 → Buffer → hex
  console.log('🔄 Base64 변환 시도, 입력길이:', k.length);
  const buf = Buffer.from(k, 'base64');
  console.log('변환 결과 바이트:', buf.length);

  if (buf.length === 32) {
    return '0x' + buf.toString('hex');
  }
  // 33바이트면 앞 1바이트 제거 (prefix)
  if (buf.length === 33) {
    return '0x' + buf.slice(1).toString('hex');
  }
  // 그 외 마지막 32바이트 사용
  if (buf.length > 32) {
    return '0x' + buf.slice(buf.length - 32).toString('hex');
  }

  throw new Error('개인키 변환 실패: ' + buf.length + '바이트');
}

let cleanKey;
try {
  cleanKey = prepareKey(PRIVATE_KEY);
  console.log('🔑 키 길이:', cleanKey.length, '(정상 66)');
} catch(e) {
  console.error('❌ 키 처리 실패:', e.message);
  process.exit(1);
}

// ── Provider / Wallet ─────────────────────────────
let provider, wallet;

async function initWallet() {
  provider = await getProvider();
  wallet   = new ethers.Wallet(cleanKey, provider);
  console.log('✅ 보상 지갑:', wallet.address);
}

initWallet().catch(e => {
  console.error('❌ 지갑 초기화 실패:', e.message);
  process.exit(1);
});

// ── 하루 클레임 카운터 ────────────────────────────
let claimLog = {};
function todayKey(addr) {
  return addr.toLowerCase() + '_' + new Date().toISOString().slice(0, 10);
}
function getClaims(addr)  { return claimLog[todayKey(addr)] || 0; }
function addClaim(addr)   {
  const k = todayKey(addr);
  claimLog[k] = (claimLog[k] || 0) + 1;
}
setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  Object.keys(claimLog).forEach(k => { if (!k.includes(today)) delete claimLog[k]; });
}, 3600000);

// ── 잔액 조회 ─────────────────────────────────────
async function getBalance() {
  if (!provider) throw new Error('서버 초기화 중');
  const bal = await provider.getBalance(wallet.address);
  return parseFloat(ethers.utils.formatEther(bal));
}

// ── ETN 전송 ──────────────────────────────────────
async function sendETN(to, amount) {
  if (!wallet) throw new Error('서버 초기화 중');
  const value   = ethers.utils.parseEther(amount.toString());
  const balance = await provider.getBalance(wallet.address);
  if (balance.lt(value)) throw new Error('잔액 부족');
  const tx      = await wallet.sendTransaction({ to, value, gasLimit: 21000 });
  console.log('📤 전송:', amount, 'ETN →', to, '| tx:', tx.hash);
  const receipt = await tx.wait();
  console.log('✅ 완료:', receipt.transactionHash);
  return receipt.transactionHash;
}

// ── 데이터 증명 기록 ──────────────────────────────
// ETN 트랜잭션 data 필드에 해시를 넣어 영구 기록
async function recordOnChain(hash, meta) {
  if (!wallet) throw new Error('서버 초기화 중');

  // 증명 패킷 구성 (최대 100바이트)
  const packet = JSON.stringify({
    h: hash.slice(0, 20),     // 해시 앞부분 (짧게)
    t: meta.dataType || 'data',
    o: (meta.owner || 'anon').slice(0, 20),
    ts: Math.floor(Date.now() / 1000)
  });

  // hex 인코딩
  const dataHex = '0x' + Buffer.from(packet, 'utf8').toString('hex');

  // 자기 자신에게 0 ETN 전송 + data 필드에 해시 기록
  const tx = await wallet.sendTransaction({
    to: wallet.address,   // 자신에게 전송 (ETN 0개)
    value: 0,
    data: dataHex,
    gasLimit: 50000       // data 포함이라 조금 더 필요
  });

  console.log('📝 증명 기록:', hash.slice(0,16), '| tx:', tx.hash);
  const receipt = await tx.wait();
  console.log('✅ 블록 확인:', receipt.transactionHash, '| 블록:', receipt.blockNumber);
  return {
    txHash: receipt.transactionHash,
    blockNumber: receipt.blockNumber
  };
}

// ── 라우트 ────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    const bal = await getBalance();
    res.json({ status: 'ok', wallet: wallet.address, balance: bal.toFixed(2) + ' ETN' });
  } catch(e) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

app.get('/pool-info', async (req, res) => {
  try {
    const bal = await getBalance();
    res.json({ success: true, poolEtn: Math.floor(bal * 10) / 10, online: Math.floor(Math.random() * 20) + 3 });
  } catch(e) {
    res.json({ success: false, poolEtn: 0, online: 1 });
  }
});

// ── 데이터 증명 API ───────────────────────────────
app.post('/certify', async (req, res) => {
  const { hash, dataType, owner, description, size } = req.body;

  // 입력 검증
  if (!hash || typeof hash !== 'string')
    return res.status(400).json({ success: false, message: 'hash가 없습니다' });

  if (!/^[0-9a-fA-F]{64}$/.test(hash))
    return res.status(400).json({ success: false, message: '올바른 SHA-256 hash가 아닙니다 (64자리 hex)' });

  try {
    console.log('🔐 증명 요청:', hash.slice(0,16), '| 유형:', dataType, '| 소유자:', owner);

    const result = await recordOnChain(hash, { dataType, owner, description });

    const cert = {
      success: true,
      certId: result.txHash,
      txHash: result.txHash,
      blockNumber: result.blockNumber,
      hash: hash,
      dataType: dataType || 'unknown',
      owner: owner || 'anonymous',
      description: description || '',
      size: size || 'unknown',
      timestamp: new Date().toISOString(),
      network: 'ETN Smart Chain',
      explorerUrl: `https://blockexplorer.electroneum.com/tx/${result.txHash}`,
      fee: '< $0.0001'
    };

    console.log('✅ 증명 완료:', result.txHash);
    res.json(cert);

  } catch(e) {
    console.error('❌ 증명 실패:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── 증명서 조회 API ───────────────────────────────
app.get('/verify/:txHash', async (req, res) => {
  const { txHash } = req.params;
  try {
    const tx = await provider.getTransaction(txHash);
    if (!tx) return res.status(404).json({ success: false, message: '트랜잭션을 찾을 수 없습니다' });

    const receipt = await provider.getTransactionReceipt(txHash);
    const block   = await provider.getBlock(receipt.blockNumber);

    // data 필드에서 증명 패킷 추출
    let certData = null;
    try {
      const decoded = Buffer.from(tx.data.slice(2), 'hex').toString('utf8');
      certData = JSON.parse(decoded);
    } catch(e) { /* data 없거나 다른 형식 */ }

    res.json({
      success: true,
      txHash,
      blockNumber: receipt.blockNumber,
      timestamp: new Date(block.timestamp * 1000).toISOString(),
      from: tx.from,
      certData,
      explorerUrl: `https://blockexplorer.electroneum.com/tx/${txHash}`
    });
  } catch(e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

app.post('/send-etn', async (req, res) => {
  const { address, amount, lines } = req.body;

  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address))
    return res.status(400).json({ success: false, message: '올바른 ETN 주소가 아닙니다 (0x로 시작하는 주소 필요)' });

  const amt = parseInt(amount);
  if (!amt || amt <= 0)
    return res.status(400).json({ success: false, message: '전송할 ETN이 없습니다' });

  if (amt > MAX_ETN_PER_CLAIM)
    return res.status(400).json({ success: false, message: `최대 ${MAX_ETN_PER_CLAIM} ETN까지 가능합니다` });

  if (getClaims(address) >= MAX_DAILY)
    return res.status(429).json({ success: false, message: `하루 최대 ${MAX_DAILY}회까지 가능합니다` });

  if ((lines || 0) < amt * 10)
    return res.status(400).json({ success: false, message: '게임 기록과 ETN 수량이 맞지 않습니다' });

  try {
    const txHash = await sendETN(address, amt.toString());
    addClaim(address);
    res.json({ success: true, txHash, message: `${amt} ETN 전송 완료!` });
  } catch(e) {
    console.error('❌ 전송 실패:', e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

// ── 시작 ──────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('🚀 서버 실행중 포트', PORT);
});
