-- 학생: 학번이 기본키. 반(class)은 학번 앞 2자리(학년1+반1). 학번 예: 1503
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  class TEXT NOT NULL,
  pw_hash TEXT,                 -- NULL이면 다음 로그인 때 새 비밀번호로 설정(교사 초기화)
  token TEXT,
  article INTEGER,              -- 선택한 기사 번호(1~30)
  started_at INTEGER,           -- 학생이 '시작'을 누른 시각(ms)
  deadline INTEGER,             -- 마감 시각(ms). 교사가 연장하면 커짐
  submitted_at INTEGER,         -- 학생이 [제출]을 누른 시각(ms). 이후 저장 불가
  paste_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
-- 같은 반에서 같은 기사는 한 명만: 이 제약이 "이미 다른 사람이 선택하였습니다"를 만든다.
CREATE UNIQUE INDEX IF NOT EXISTS uq_class_article ON students(class, article);

CREATE TABLE IF NOT EXISTS answers (
  student_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,           -- {"6a":"...", ...} 23개 요건
  updated_at INTEGER NOT NULL
);
