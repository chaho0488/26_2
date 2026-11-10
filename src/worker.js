import ARTICLES from "./articles.json" with { type: "json" };
import { SECTIONS, KEYS } from "./fields.js";

const LIMIT_MIN = 60;          // 작성 시간(분)
const PASTE_BASE = 20;         // 한 번 저장에서 허용하는 글자 증가량
const PASTE_PER_SEC = 6;       // 저장 사이 시간(초)당 추가 허용량 — 사람 타이핑 속도 상한
const PASTE_MAX = 120;         // 아무리 오래 쉬어도 이 이상 한 번에 늘면 거부
// 반별 기사 선택 개시 시각(한국 시간 08:00 = UTC 전날 23:00). 없는 반은 제한 없음. 가입·열람은 그 전에도 가능
const OPEN_AT = {
  "11": Date.UTC(2026, 10, 10, 23), "12": Date.UTC(2026, 10, 10, 23), "13": Date.UTC(2026, 10, 10, 23),   // 11/11(수) 08:00
  "14": Date.UTC(2026, 10, 11, 23), "15": Date.UTC(2026, 10, 11, 23), "16": Date.UTC(2026, 10, 11, 23),   // 11/12(목) 08:00
};
const openAt = c => OPEN_AT[c] || 0;
const kst = t => new Date(t + 9 * 3600000).toISOString().replace("T", " ").slice(5, 16).replace("-", "/");   // "11/11 08:00"

const json = (d, s = 200, h = {}) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json; charset=utf-8", ...h } });
const err = (m, s = 400) => json({ error: m }, s);
const cls = id => id.slice(0, 2);   // 학번 1503 = 1학년 5반 03번 → 반 "15"

// ── 비밀번호: PBKDF2(WebCrypto). "salt:hash" 형태로 저장 ──
async function hash(pw, salt) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return salt + ":" + [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const rand = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, "0")).join("");
async function verify(pw, stored) { return stored === await hash(pw, stored.split(":")[0]); }

const cookie = req => Object.fromEntries((req.headers.get("cookie") || "").split(";").map(c => c.trim().split("=")).filter(c => c[0]));
async function student(req, env) {
  const t = cookie(req).t;
  return t ? env.DB.prepare("SELECT * FROM students WHERE token=?").bind(t).first() : null;
}
// 학생 화면에 돌려주는 상태. 같은 반 선택 현황은 '선택됨' 여부만 주고 누가 골랐는지는 주지 않는다.
async function state(s, env) {
  const taken = new Set((await env.DB.prepare("SELECT article FROM students WHERE class=? AND article IS NOT NULL").bind(s.class).all()).results.map(r => r.article));
  return {
    id: s.id, name: s.name, article: s.article, started_at: s.started_at, deadline: s.deadline, now: Date.now(), open_at: openAt(s.class),
    articles: ARTICLES.map(a => ({ no: a.no, field: a.field, title: a.title, taken: taken.has(a.no) })),
    sections: SECTIONS,
  };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    const p = url.pathname.slice(5);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};

    // ── 교사 API: 헤더 x-teacher-pw ──
    if (p.startsWith("t/")) {
      if (!env.TEACHER_PW || req.headers.get("x-teacher-pw") !== env.TEACHER_PW) return err("교사 비밀번호가 맞지 않습니다.", 401);
      return teacher(p.slice(2), url, body, env);
    }

    if (p === "login") {
      const { id, name, pw } = body;
      if (!/^\d{4}$/.test(id || "")) return err("학번은 숫자 4자리(예: 1503)입니다.");
      if (!(name || "").trim()) return err("이름을 입력하세요.");
      if ((pw || "").length < 4) return err("비밀번호는 4자 이상입니다.");
      let s = await env.DB.prepare("SELECT * FROM students WHERE id=?").bind(id).first();
      const token = rand();
      if (!s) {                                              // 처음: 가입
        await env.DB.prepare("INSERT INTO students(id,name,class,pw_hash,token,created_at) VALUES(?,?,?,?,?,?)")
          .bind(id, name.trim(), cls(id), await hash(pw, rand()), token, Date.now()).run();
      } else if (s.name !== name.trim()) {
        return err("이 학번은 다른 이름으로 등록되어 있습니다. 학번과 이름을 확인하세요.");
      } else if (!s.pw_hash) {                               // 교사가 초기화함: 지금 입력한 비밀번호로 새로 설정
        await env.DB.prepare("UPDATE students SET pw_hash=?, token=? WHERE id=?").bind(await hash(pw, rand()), token, id).run();
      } else if (await verify(pw, s.pw_hash)) {
        await env.DB.prepare("UPDATE students SET token=? WHERE id=?").bind(token, id).run();
      } else return err("비밀번호가 맞지 않습니다.", 401);
      return json({ ok: true }, 200, { "set-cookie": `t=${token}; Path=/; HttpOnly; SameSite=Strict; Secure` });
    }

    const s = await student(req, env);
    if (!s) return err("로그인이 필요합니다.", 401);

    if (p === "me") return json(await state(s, env));

    if (p === "select") {
      if (s.article) return err("이미 기사를 선택했습니다. 변경은 선생님께 요청하세요.");
      if (Date.now() < openAt(s.class)) return err(`기사 선택은 ${kst(openAt(s.class))}부터 가능합니다.`, 403);
      const no = Number(body.no);
      if (!ARTICLES.some(a => a.no === no)) return err("없는 기사 번호입니다.");
      try {
        await env.DB.prepare("UPDATE students SET article=? WHERE id=?").bind(no, s.id).run();
      } catch (e) {                                          // UNIQUE(class, article) 위반 = 같은 반 다른 학생이 먼저 선택
        return err("이미 다른 사람이 선택하였습니다.", 409);
      }
      return json(await state({ ...s, article: no }, env));
    }

    if (p === "start") {
      if (!s.article) return err("먼저 기사를 선택하세요.");
      if (!s.started_at) {
        const now = Date.now();
        await env.DB.prepare("UPDATE students SET started_at=?, deadline=? WHERE id=?").bind(now, now + LIMIT_MIN * 60000, s.id).run();
      }
      return json(await state(await env.DB.prepare("SELECT * FROM students WHERE id=?").bind(s.id).first(), env));
    }

    if (p === "preview") {                                   // 선택 전 읽기용: 로그인만 되어 있으면 어느 기사든 전문을 준다
      const a = ARTICLES.find(x => x.no === Number(url.searchParams.get("no")));
      return a ? json({ article: a }) : err("없는 기사 번호입니다.");
    }

    if (p === "article") {
      if (!s.article || !s.started_at) return err("아직 시작 전입니다.", 403);
      const a = ARTICLES.find(x => x.no === s.article);
      const row = await env.DB.prepare("SELECT data, updated_at FROM answers WHERE student_id=?").bind(s.id).first();
      return json({ article: a, answers: row ? JSON.parse(row.data) : {}, paste_count: s.paste_count, now: Date.now() });
    }

    if (p === "save") {
      if (!s.started_at) return err("아직 시작 전입니다.", 403);
      const now = Date.now();
      if (now > s.deadline) return err("작성 시간이 끝났습니다.", 403);
      const row = await env.DB.prepare("SELECT data, updated_at FROM answers WHERE student_id=?").bind(s.id).first();
      const old = row ? JSON.parse(row.data) : {};
      const elapsed = row ? (now - row.updated_at) / 1000 : 0;
      const allow = Math.min(PASTE_MAX, PASTE_BASE + PASTE_PER_SEC * elapsed);
      const next = { ...old }, rejected = [];
      for (const k of KEYS) {
        if (typeof body.answers?.[k] !== "string") continue;
        const v = body.answers[k].slice(0, 3000);
        if (v.length - (old[k] || "").length > allow) rejected.push(k);   // 덩어리 입력(붙여넣기) → 그 칸만 이전 값 유지
        else next[k] = v;
      }
      await env.DB.prepare("INSERT INTO answers(student_id,data,updated_at) VALUES(?,?,?) ON CONFLICT(student_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at")
        .bind(s.id, JSON.stringify(next), now).run();
      if (rejected.length) await env.DB.prepare("UPDATE students SET paste_count=paste_count+? WHERE id=?").bind(rejected.length, s.id).run();
      return json({ answers: next, rejected, saved_at: now });
    }

    return err("없는 주소입니다.", 404);
  },
};

async function teacher(p, url, body, env) {
  const c = url.searchParams.get("class") || body.class;
  if (p === "overview") {                                    // 반 전체 현황: 여기서만 누가 어떤 기사를 골랐는지 보인다
    const rows = (await env.DB.prepare(
      "SELECT s.id,s.name,s.article,s.started_at,s.deadline,s.paste_count,a.updated_at, length(a.data) AS len FROM students s LEFT JOIN answers a ON a.student_id=s.id WHERE s.class=? ORDER BY s.id").bind(c).all()).results;
    return json({ students: rows, articles: ARTICLES.map(a => ({ no: a.no, title: a.title })), now: Date.now() });
  }
  if (p === "classes") return json((await env.DB.prepare("SELECT class, count(*) n FROM students GROUP BY class ORDER BY class").all()).results);
  if (p === "student") {
    const id = url.searchParams.get("id");
    const s = await env.DB.prepare("SELECT id,name,article,started_at,deadline,paste_count FROM students WHERE id=?").bind(id).first();
    if (!s) return err("없는 학생입니다.", 404);
    const row = await env.DB.prepare("SELECT data FROM answers WHERE student_id=?").bind(id).first();
    return json({ ...s, title: ARTICLES.find(a => a.no === s.article)?.title, answers: row ? JSON.parse(row.data) : {}, sections: SECTIONS });
  }
  if (p === "delete") {                                      // 삭제는 비밀번호를 한 번 더 받아 서버에서 다시 확인한다
    if (body.confirm_pw !== env.TEACHER_PW) return err("확인 비밀번호가 맞지 않습니다.", 401);
    await env.DB.prepare("DELETE FROM answers WHERE student_id=?").bind(body.id).run();
    if (body.mode === "student") await env.DB.prepare("DELETE FROM students WHERE id=?").bind(body.id).run();
    else await env.DB.prepare("UPDATE students SET started_at=NULL, deadline=NULL, paste_count=0 WHERE id=?").bind(body.id).run();   // 답안만: 다시 시작할 수 있게
    return json({ ok: true });
  }
  if (p === "reset-pw") { await env.DB.prepare("UPDATE students SET pw_hash=NULL, token=NULL WHERE id=?").bind(body.id).run(); return json({ ok: true }); }
  if (p === "extend") {                                      // 분 단위 연장. 시작 전 학생은 제외
    const min = Number(body.minutes) || 0;
    const r = body.id
      ? await env.DB.prepare("UPDATE students SET deadline=deadline+? WHERE id=? AND deadline IS NOT NULL").bind(min * 60000, body.id).run()
      : await env.DB.prepare("UPDATE students SET deadline=deadline+? WHERE class=? AND deadline IS NOT NULL").bind(min * 60000, c).run();
    return json({ ok: true, changed: r.meta.changes });
  }
  if (p === "assign") {                                      // 미선택 학생에게 기사 배정(또는 교사가 바꿔 줌)
    try { await env.DB.prepare("UPDATE students SET article=? WHERE id=?").bind(Number(body.no) || null, body.id).run(); }
    catch { return err("그 반에서 이미 선택된 기사입니다.", 409); }
    return json({ ok: true });
  }
  if (p === "export.csv") {
    const rows = (await env.DB.prepare("SELECT s.id,s.name,s.article,s.paste_count,a.data FROM students s LEFT JOIN answers a ON a.student_id=s.id WHERE s.class=? ORDER BY s.id").bind(c).all()).results;
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["학번", "이름", "기사번호", "덩어리입력거부", ...KEYS].map(q).join(",");
    const lines = rows.map(r => { const d = r.data ? JSON.parse(r.data) : {}; return [r.id, r.name, r.article, r.paste_count, ...KEYS.map(k => d[k])].map(q).join(","); });
    return new Response("﻿" + [head, ...lines].join("\r\n"), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="answers_${c}.csv"` } });
  }
  return err("없는 주소입니다.", 404);
}
