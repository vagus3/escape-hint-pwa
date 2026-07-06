# AI Server

Vercel에 배포된 PWA가 호출하는 별도 힌트 API 서버입니다. Firebase Admin SDK로 비공개 지식(`gameKnowledge`)을 읽고, Ollama의 `exaone3.5:2.4b` 모델에 프롬프트를 전달합니다.

## 실행

```bash
cd server
npm install
ollama pull exaone3.5:2.4b
ollama serve
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json npm start
```

## API

### `GET /health`

Ollama 연결 가능 여부와 모델 설정을 확인합니다.

### `POST /api/hints`

```json
{
  "gameId": "egcompany",
  "stageNumber": 1,
  "question": "이 암호를 어떻게 풀어야 해?",
  "history": [
    { "role": "user", "content": "처음 질문" }
  ],
  "maxHintLevel": 3
}
```

응답:

```json
{
  "answer": "힌트 본문",
  "hintLevel": 1,
  "model": "exaone3.5:2.4b",
  "source": "ollama"
}
```

## 배포 방식

테스트 단계에서는 다음 중 하나가 현실적입니다.

- GCP VM에 Ollama와 이 Node 서버를 같이 실행
- Cloud Run에 이 Node 서버를 올리고, `OLLAMA_BASE_URL`은 별도 Ollama 서버 HTTPS 주소로 지정

Ollama를 인터넷에 직접 공개하지 말고, 반드시 이 API 서버를 거쳐 호출하세요.
