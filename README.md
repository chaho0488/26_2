# 매체 비평 수행평가 사이트 (공통국어2)

학생이 기사 25편 중 1편을 반별 선착순으로 고르고, 시작 버튼을 누른 뒤 60분 동안 분석표를 작성하는 Cloudflare Worker.

- 학생 화면: `/` (public/index.html)
- 교사 화면: `/teacher.html` — 교사 비밀번호는 Worker 환경변수 `TEACHER_PW`
- 서버: `src/worker.js`, 요건 목록: `src/fields.js`, 기사 25편: `src/articles.json`

## 처음 한 번 할 일
1. Cloudflare → Storage & Databases → D1 → 데이터베이스 생성(이름 `26_2`) → ID를 `wrangler.toml`의 `database_id`에 넣기
2. D1 콘솔에서 `schema.sql` 내용 실행
3. Worker → Settings → Variables and Secrets → `TEACHER_PW` 추가(Secret)

## 점검
`npm test` — Node 22 이상. 내장 SQLite로 D1을 흉내 내어 서버 흐름 40개를 확인한다.

## 조정할 수 있는 값 (`src/worker.js` 맨 위)
- `LIMIT_MIN` 작성 시간(분), 기본 60
- `PASTE_BASE`/`PASTE_PER_SEC`/`PASTE_MAX` 덩어리 입력(붙여넣기) 판정 기준
