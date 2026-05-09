# ETN BLOCKCHAIN 게임 서버

## 배포 순서

### 1단계 — GitHub 업로드
1. github.com 접속 → 로그인
2. 우측 상단 + → "New repository"
3. 이름: `etn-blockchain-server`
4. Public 선택 → "Create repository"
5. 이 폴더 파일들 모두 업로드 (Upload files)
   - server.js
   - package.json
   - .gitignore
   - .env.example  ← 이건 올려도 됨 (예시파일)
   ⚠️ .env 파일은 절대 올리지 마세요!

### 2단계 — Railway 배포
1. railway.app 접속
2. "Start a New Project" 클릭
3. "Deploy from GitHub repo" 선택
4. GitHub 연결 → etn-blockchain-server 선택
5. 자동 배포 시작!

### 3단계 — 환경변수 설정 (중요!)
Railway 대시보드에서:
1. 프로젝트 클릭
2. "Variables" 탭
3. 아래 변수 추가:

| 변수명 | 값 |
|--------|-----|
| PRIVATE_KEY | 보상 지갑 개인키 |
| MAX_DAILY | 3 |
| MAX_ETN | 10 |

4. "Deploy" 클릭 → 재배포

### 4단계 — 서버 URL 확인
Railway → Settings → Domains → URL 복사
예: `https://etn-blockchain-server-xxxx.up.railway.app`

### 5단계 — 게임에 URL 연결
tetris-etn.html 파일에서:
```
const ETN_SERVER_URL = 'https://여기에_Railway_URL/send-etn';
```
이 줄을 찾아서 Railway URL로 교체!

## API 엔드포인트
- GET  /health       → 서버 상태 + 잔액 확인
- GET  /pool-info    → ETN 풀 잔액
- POST /send-etn     → ETN 전송

## 테스트
서버 URL/health 브라우저에서 열어보면
잔액이 보이면 정상!
