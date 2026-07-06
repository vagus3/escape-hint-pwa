# ERG Escape Hint PWA

온라인 방탈출 사용자 테스트를 빠르게 받기 위한 모바일 중심 PWA입니다. 앱 안에서 문제를 풀게 하지 않고, 사용자가 별도 온라인 방탈출을 진행하다가 막혔을 때 AI 힌트만 요청하는 구조입니다.

## 확정된 방향

- 배포: Vercel
- 프론트엔드: Vite + React
- PWA: vite-plugin-pwa, 설치형 모바일 웹앱
- 인증/DB: Firebase Auth + Firestore
- 관리자 접근: Firebase 이메일/비밀번호 로그인 + admins UID 권한 확인
- AI 서버: 별도 서버에서 Ollama 실행
- 기본 모델: `exaone3.5:2.4b`
- 힌트 정책: 1단계 방향 제시, 2단계 단서 구체화, 3단계 정답 직전 안내
- 정답 직접 공개: 금지

## 화면 구성

초기 레퍼런스 이미지의 흐름을 기준으로 구성했습니다.

- 홈: 추천 방탈출, 온라인/오프라인 토글, 유의사항
- 콘텐츠: 콘텐츠 목록, 검색/카테고리 탭
- 상세: 포스터, 난이도, 태그, 플레이 정보, 게임 플레이 진입
- AI 도움: 진행도, 구간 선택, 질문 예시, 채팅형 힌트
- 마이페이지: 최근 플레이, 기록/노트/AI 히스토리 메뉴
- 관리자: `/admin`에서 로그인 후 콘텐츠와 비공개 지식 등록

## 데이터 보안 구조

테스트 참가자에게 정답/상세 힌트가 노출되지 않도록 Firestore 데이터를 분리합니다.

- `games/{gameId}`: 참가자에게 공개되는 콘텐츠 메타데이터
- `gameKnowledge/{gameId}`: 관리자와 AI 서버만 사용하는 실제 풀이 지식
- `admins/{uid}`: 관리자 권한 확인용 문서

프론트는 `games`만 읽고, AI 서버가 Firebase Admin SDK로 `gameKnowledge`를 읽어 Ollama 프롬프트를 구성합니다.

## 로컬 실행

```bash
npm install
npm run dev
```
현재 작업 환경에서는 `npm run build`로 Vite/PWA 프로덕션 빌드가 통과했습니다. 로컬 터미널에 Node 20 이상이 설치되어 있으면 위 명령으로 개발 서버를 실행할 수 있습니다.

## 환경 변수

`.env.example`을 참고해 Vercel Project Settings에 등록합니다.

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
VITE_AI_API_URL=https://your-ai-api.example.com
```

`VITE_AI_API_URL`이 없으면 브라우저에서 로컬 Ollama(`http://localhost:11434`)로 직접 요청합니다. 로컬 Ollama 연결에 실패하면 개발용 fallback 힌트가 동작합니다. 실제 사용자 테스트에서는 별도 AI 서버 URL을 넣는 구성이 더 안정적입니다.

로컬 Ollama 주소를 바꾸려면 아래 값을 추가합니다.

```bash
VITE_OLLAMA_BASE_URL=http://localhost:11434
```

## Firebase 설정

1. Firebase 프로젝트 생성
2. Authentication에서 Email/Password 로그인 활성화
3. 관리자 이메일/비밀번호 계정 생성
4. Firestore 생성
5. 생성된 관리자 계정 UID를 확인
6. Firestore에 `admins/{관리자 UID}` 문서 추가
7. `firestore.rules` 배포

```bash
firebase deploy --only firestore:rules
```

## AI 서버

`server/` 폴더에 별도 AI API 서버 골격이 있습니다.

```bash
cd server
npm install
OLLAMA_MODEL=exaone3.5:2.4b npm start
```

서버 환경 변수:

```bash
PORT=8080
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=exaone3.5:2.4b
ALLOWED_ORIGIN=https://your-vercel-domain.vercel.app
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

Ollama가 같은 서버에서 실행 중이어야 합니다.

```bash
ollama pull exaone3.5:2.4b
ollama serve
```

개발 중에는 AI 서버 없이도 같은 명령으로 로컬 Ollama를 띄운 뒤 앱에서 EGCompany 콘텐츠를 선택하고 질문을 입력하면, 현재 문제의 풀이 플로우와 단계별 힌트 지식을 프롬프트에 포함해 답변합니다.

## Vercel 배포

1. GitHub에 프로젝트 업로드
2. Vercel에서 Import Project
3. Framework Preset: Vite
4. Build Command: `npm run build`
5. Output Directory: `dist`
6. 환경 변수 등록
7. Deploy

`vercel.json`에는 `/admin` 직접 접근과 SPA 새로고침이 깨지지 않도록 rewrite가 들어가 있습니다.

## 남은 운영 작업

- 실제 테스트용 방탈출 콘텐츠 메타데이터 등록
- 비공개 풀이 지식은 `gameKnowledge`에만 저장
- AI 서버 HTTPS 도메인 연결
- Vercel 환경 변수에 `VITE_AI_API_URL` 등록
- 테스트 참가자에게는 Vercel 앱 URL만 공유
