// 서버 코드 자체 점검: Node 내장 SQLite로 D1을 흉내 내어 학생·교사 흐름을 끝까지 돌린다
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";

const db = new DatabaseSync(":memory:");
db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf-8"));
// D1 최소 흉내: prepare().bind().first()/all()/run()
const D1 = { prepare: sql => { const st = db.prepare(sql); let args = []; const o = {
  bind: (...a) => { args = a.map(v => v === undefined ? null : v); return o; },
  first: async () => st.get(...args) ?? null,
  all: async () => ({ results: st.all(...args) }),
  run: async () => { const r = st.run(...args); return { meta: { changes: r.changes } }; },
}; return o; } };
const env = { DB: D1, TEACHER_PW: "t-pw", ASSETS: { fetch: () => new Response("asset") } };

let cookies = {};
async function call(path, body, who = "a", headers = {}) {
  const req = new Request("https://x" + path, { method: body ? "POST" : "GET", headers: { cookie: cookies[who] ? "t=" + cookies[who] : "", "content-type": "application/json", ...headers }, body: body && JSON.stringify(body) });
  const r = await worker.fetch(req, env);
  const sc = r.headers.get("set-cookie"); if (sc) cookies[who] = sc.match(/t=([^;]+)/)[1];
  const ct = r.headers.get("content-type") || "";
  return { status: r.status, body: ct.includes("json") ? await r.json() : await r.text() };
}
// 시계 이동: 반별 선택 개시 시각(11/11·11/12 08:00 KST) 검사를 날짜와 무관하게 하기 위해 Date.now에 오차를 더한다
const realNow = Date.now; let shift = 0; Date.now = () => realNow() + shift;
const setClock = utc => { shift = utc - realNow(); };
setClock(Date.UTC(2026, 10, 20));   // 기본: 11/20 — 모든 반 선택·시작 가능
let n = 0; const ok = (c, m) => { n++; if (!c) { console.error("실패:", m); process.exit(1); } console.log("통과:", m); };

// 로그인/가입
ok((await call("/api/login", { id: "103", name: "가", pw: "1234" })).status === 400, "학번 3자리 거부");
ok((await call("/api/login", { id: "1503", name: "홍길동", pw: "12" })).status === 400, "비번 2자 거부");
ok((await call("/api/login", { id: "1503", name: "홍길동", pw: "abcd" })).status === 200, "가입");
ok((await call("/api/login", { id: "1503", name: "김철수", pw: "abcd" })).status === 400, "같은 학번 다른 이름 거부");
ok((await call("/api/login", { id: "1503", name: "홍길동", pw: "wrong" })).status === 401, "틀린 비번 거부");
ok((await call("/api/login", { id: "1503", name: "홍길동 ", pw: "abcd" })).status === 200, "재로그인(이름 공백 허용)");
ok((await call("/api/me", null, "nobody")).status === 401, "쿠키 없으면 401");

// 선택 개시 시각: 1~3반은 11/11 08:00, 4~6반은 11/12 08:00 (KST) 전에는 거부, 가입·열람은 가능
await call("/api/login", { id: "1101", name: "개시", pw: "pass" }, "o1");
await call("/api/login", { id: "1401", name: "개시", pw: "pass" }, "o4");
setClock(Date.UTC(2026, 10, 10, 22, 59));                          // 11/11 07:59 KST
ok((await call("/api/me", null, "o1")).status === 200, "개시 전에도 가입·로그인 가능");
ok((await call("/api/preview", null, "o1")).status === 403, "선택 전에는 기사 전문 열람 불가");
let ro = await call("/api/select", { no: 3 }, "o1");
ok(ro.status === 403 && ro.body.error.includes("11/11 08:00"), "1반 11/11 08:00 전 선택 거부: " + ro.body.error);
setClock(Date.UTC(2026, 10, 10, 23));                              // 11/11 08:00 KST 정각
ok((await call("/api/select", { no: 3 }, "o1")).status === 200, "1반 11/11 08:00 정각 선택 가능");
let rp = await call("/api/preview", null, "o1");
ok(rp.status === 200 && rp.body.article.no === 3 && rp.body.article.paras.length > 0, "확정 후에는 자기 기사 전문 열람 가능(시작 전)");
ro = await call("/api/select", { no: 3 }, "o4");
ok(ro.status === 403 && ro.body.error.includes("11/12 08:00"), "4반은 아직 거부: " + ro.body.error);
setClock(Date.UTC(2026, 10, 11, 23));                              // 11/12 08:00 KST
ok((await call("/api/select", { no: 3 }, "o4")).status === 200, "4반 11/12 08:00 선택 가능");

// 평가 개시 시각: 1~3반 11/17 08:30, 4~6반 11/18 08:30 (KST) 전에는 [시작] 거부
setClock(Date.UTC(2026, 10, 16, 23, 29));                          // 11/17 08:29 KST
ro = await call("/api/start", {}, "o1");
ok(ro.status === 403 && ro.body.error.includes("11/17 08:30"), "1반 11/17 08:30 전 시작 거부: " + ro.body.error);
ok((await call("/api/me", null, "o1")).body.started_at === null, "거부된 시작은 시간이 흐르지 않음");
ok((await call("/api/me", null, "o1")).body.start_at === Date.UTC(2026, 10, 16, 23, 30), "화면에 개시 시각 전달");
ok((await call("/api/preview", null, "o1")).status === 200, "개시 전에도 고른 기사 읽기는 가능");
setClock(Date.UTC(2026, 10, 16, 23, 30));                          // 11/17 08:30 KST 정각
ro = await call("/api/start", {}, "o1");
ok(ro.status === 200 && ro.body.deadline - ro.body.started_at === 3600000, "1반 11/17 08:30 정각 시작 가능, 60분");
ro = await call("/api/start", {}, "o4");
ok(ro.status === 403 && ro.body.error.includes("11/18 08:30"), "4반은 11/17에 시작 거부: " + ro.body.error);
setClock(Date.UTC(2026, 10, 17, 23, 30));                          // 11/18 08:30 KST
ok((await call("/api/start", {}, "o4")).status === 200, "4반 11/18 08:30 시작 가능");
// 나갔다 와도 시간은 계속: 40분 뒤 다시 들어오면 마감은 그대로, 61분 뒤에는 저장 거부
const dl4 = (await call("/api/me", null, "o4")).body.deadline;
setClock(Date.UTC(2026, 10, 18, 0, 10));
ro = await call("/api/me", null, "o4");
ok(ro.body.deadline === dl4 && Math.abs(ro.body.deadline - ro.body.now - 20 * 60000) < 1000, "40분 뒤 재접속: 남은 시간 20분");
setClock(Date.UTC(2026, 10, 18, 0, 31));
ok((await call("/api/save", { answers: { "6a": "x" } }, "o4")).status === 403, "61분 뒤 저장 거부");
setClock(Date.UTC(2026, 10, 20));

// 기사 선택: 같은 반 중복 불가, 다른 반은 가능
await call("/api/login", { id: "1501", name: "이영희", pw: "pass" }, "b");
await call("/api/login", { id: "1601", name: "박민수", pw: "pass" }, "c");
ok((await call("/api/select", { no: 7 })).body.article === 7, "A가 7번 선택");
let r = await call("/api/select", { no: 7 }, "b");
ok(r.status === 409 && r.body.error === "이미 다른 사람이 선택하였습니다.", "같은 반 B는 7번 선택 불가");
ok((await call("/api/me", null, "b")).body.articles.find(a => a.no === 7).taken === true, "B 화면에 7번 '선택됨'(이름 없음)");
ok((await call("/api/select", { no: 7 }, "c")).status === 200, "다른 반 C는 7번 선택 가능");
ok((await call("/api/select", { no: 8 })).status === 400, "A는 변경 불가");
ok((await call("/api/article")).status === 403, "시작 전 기사 열람 불가");
ok((await call("/api/save", { answers: { "6a": "x" } })).status === 403, "시작 전 저장 불가");

// 시작과 저장
r = await call("/api/start", {});
ok(r.body.deadline - r.body.started_at === 3600000, "시작: 60분 마감");
const d1 = r.body.deadline;
r = await call("/api/start", {});
ok(r.body.deadline === d1, "시작 버튼 다시 눌러도 시간 그대로");
r = await call("/api/article");
ok(r.body.article.no === 7 && r.body.article.paras.length > 3, "기사 본문 수신");
r = await call("/api/save", { answers: { "6a": "조선일보 2021년", "zz": "무시" } });
ok(r.body.answers["6a"] === "조선일보 2021년" && !("zz" in r.body.answers) && r.body.rejected.length === 0, "정상 저장(모르는 키 무시)");
r = await call("/api/save", { answers: { "6b": "가".repeat(21) } });
ok(r.body.rejected.includes("6b") && !("6b" in r.body.answers), "빈 칸에 21자 덩어리 → 거부");
r = await call("/api/save", { answers: { "6a": "조선일보 2021년 11월 13일" } });
ok(r.body.answers["6a"].endsWith("13일"), "이어 쓰기(9자 증가) 허용");
r = await call("/api/save", { answers: { "6a": "" } });
ok(r.body.answers["6a"] === "", "지우기 허용");
// 저장 사이 시간이 흐르면 허용량이 늘어난다(10초 → 20+60=80자)
db.prepare("UPDATE answers SET updated_at=updated_at-10000 WHERE student_id='1503'").run();
r = await call("/api/save", { answers: { "1a": "나".repeat(75) } });
ok(r.body.rejected.length === 0, "10초 뒤 75자 허용");
db.prepare("UPDATE answers SET updated_at=updated_at-600000 WHERE student_id='1503'").run();
r = await call("/api/save", { answers: { "1b": "다".repeat(380) } });
ok(r.body.rejected.length === 0, "10분 뒤 380자는 허용(1분 타이핑 분량)");
db.prepare("UPDATE answers SET updated_at=updated_at-600000 WHERE student_id='1503'").run();
r = await call("/api/save", { answers: { "1c": "라".repeat(401) } });
ok(r.body.rejected.includes("1c"), "10분 쉬어도 401자 덩어리는 거부(상한 400)");
ok(db.prepare("SELECT paste_count FROM students WHERE id='1503'").get().paste_count === 2, "거부 2회 기록");

// 마감 후 저장 불가, 교사 연장 후 가능
db.prepare("UPDATE students SET deadline=? WHERE id='1503'").run(Date.now() - 1000);
ok((await call("/api/save", { answers: { "6a": "a" } })).status === 403, "마감 후 저장 불가");
const T = { "x-teacher-pw": "t-pw" };
ok((await call("/api/t/overview?class=15", null, "a", { "x-teacher-pw": "bad" })).status === 401, "교사 비번 틀리면 401");
r = await call("/api/t/extend", { id: "1503", minutes: 5 }, "a", T);
ok(r.body.changed === 1, "교사 개별 연장");
ok((await call("/api/save", { answers: { "6a": "a" } })).status === 200, "연장 후 저장 가능");
r = await call("/api/t/extend", { class: "15", minutes: 5 }, "a", T);
ok(r.body.changed === 1, "반 전체 연장은 시작한 학생만(1명)");

// 제출: 마지막 내용 저장, 마감 전에는 제출 후에도 수정·재제출 가능, 교사 현황에 제출 시각
r = await call("/api/submit", { answers: { "6a": "최종" } });
ok(r.status === 200 && r.body.submitted_at > 0 && r.body.answers["6a"] === "최종", "제출(마지막 내용 반영)");
r = await call("/api/save", { answers: { "6a": "수정" } });
ok(r.status === 200 && r.body.answers["6a"] === "수정", "제출 후에도 마감 전에는 수정 저장");
ok((await call("/api/submit", { answers: {} })).status === 200, "재제출 가능");
ok((await call("/api/me")).body.submitted_at > 0, "me에 제출 시각");
r = await call("/api/t/overview?class=15", null, "a", T);
ok(r.body.students.find(s => s.id === "1503").submitted_at > 0, "교사 현황에 제출 표시");

// 교사: 현황·답안·배정·초기화·CSV
r = await call("/api/t/overview?class=15", null, "a", T);
ok(r.body.students.length === 2 && r.body.students.find(s => s.id === "1503").article === 7, "반 현황에 선택 기사 보임");
r = await call("/api/t/student?id=1503", null, "a", T);
ok(r.body.answers["6a"] === "수정" && r.body.title.includes("TSMC"), "학생 답안 열람");
ok((await call("/api/t/assign", { id: "1501", no: 7 }, "a", T)).status === 409, "같은 반 중복 배정 거부");
ok((await call("/api/t/assign", { id: "1501", no: 9 }, "a", T)).status === 200, "미선택 학생에게 9번 배정");
ok((await call("/api/t/assign", { id: "1501", no: null }, "a", T)).status === 200, "선택 해제");
ok((await call("/api/me", null, "b")).body.article === null, "해제 뒤 B는 미선택 상태");
await call("/api/t/reset-pw", { id: "1503" }, "a", T);
ok((await call("/api/me")).status === 401, "초기화하면 기존 로그인 끊김");
ok((await call("/api/login", { id: "1503", name: "홍길동", pw: "newpw" })).status === 200, "초기화 뒤 새 비번으로 로그인");
ok((await call("/api/login", { id: "1503", name: "홍길동", pw: "abcd" }, "z")).status === 401, "옛 비번은 거부");
// 삭제: 확인 비밀번호 틀리면 거부, 맞으면 답안만 / 학생 전체
ok((await call("/api/t/delete", { id: "1503", mode: "answers", confirm_pw: "nope" }, "a", T)).status === 401, "삭제 확인 비번 틀리면 거부");
await call("/api/t/delete", { id: "1503", mode: "answers", confirm_pw: "t-pw" }, "a", T);
r = await call("/api/t/student?id=1503", null, "a", T);
ok(Object.keys(r.body.answers).length === 0 && r.body.started_at === null && r.body.article === 7, "답안 삭제: 글·시작 기록 지움, 기사 선택 유지");
ok((await call("/api/me")).body.started_at === null, "학생은 다시 시작 버튼을 누를 수 있는 상태");
await call("/api/t/delete", { id: "1601", mode: "student", confirm_pw: "t-pw" }, "a", T);
ok((await call("/api/t/student?id=1601", null, "a", T)).status === 404, "학생 삭제: 기록 자체가 없어짐");
r = await call("/api/t/export.csv?class=15", null, "a", T);
ok(r.status === 200 && r.body.includes("1503") && r.body.split("\r\n").length === 3, "CSV: 머리글+2명");
ok((await call("/not-api")).body === "asset", "정적 파일은 ASSETS로");
console.log(`\n${n}개 모두 통과`);
