#!/usr/bin/env node
/**
 * Proves the adaptive-reading score is graded SERVER-SIDE and can no longer be
 * forged by the client.
 *
 * THE VULNERABILITY (open item 0d)
 * --------------------------------
 * `/api/assessment/adaptive-reading` used to (a) send each question's
 * `correctAnswer` to the browser and (b) accept `{ itemId, correct }` and trust
 * the client's own verdict — so posting `correct: true` repeatedly yielded a
 * perfect 30/30. The fix shuffles options server-side, never sends the answer
 * key, and grades from the `selectedIndex` the client posts.
 *
 * This script drives the REAL built route over HTTP and asserts:
 *   1. No response ever contains `correctAnswer` (the key is not leaked).
 *   2. The `answer` request ignores a forged `correct: true` — grading comes
 *      only from `selectedIndex` vs the server's hidden key.
 *   3. Blindly answering index 0 every time does NOT produce a perfect score.
 *   4. A legacy `{ itemId, correct: true }` body (no selectedIndex) scores as a
 *      miss (selectedIndex defaults to -1), i.e. the old exploit is dead.
 *
 * Usage: node scripts/test-adaptive-reading-security.mjs [baseUrl]
 *   baseUrl defaults to http://127.0.0.1:3000
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const URL = `${BASE}/api/assessment/adaptive-reading`;

let fails = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${label}`);
  else { console.log(`  FAIL  ${label}\n          ${detail}`); fails++; }
};

const post = async (body) => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
};

// Recursively check an object graph never contains a `correctAnswer` key.
const leaksAnswerKey = (obj) => {
  if (obj == null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(leaksAnswerKey);
  for (const [k, v] of Object.entries(obj)) {
    // `correctAnswer` must never appear in anything sent to the client. (The
    // post-answer `lastResult.correctIndex` is intentional and allowed — it is
    // only returned AFTER the answer is locked in, for the reveal.)
    if (k === 'correctAnswer') return true;
    if (leaksAnswerKey(v)) return true;
  }
  return false;
};

async function run() {
  console.log(`test-adaptive-reading-security → ${URL}\n`);

  // ── Exploit attempt: start, then always claim correct:true, answer index 0 ──
  const start = await post({ action: 'start', userId: `exploit-${Date.now()}` });
  check('start returns a session + first item', start.status === 200 && !!start.json?.sessionId, start.text.slice(0, 200));
  check('start payload does NOT leak correctAnswer', !leaksAnswerKey(start.json), 'correctAnswer present in start payload');
  check('served options are a non-empty array', Array.isArray(start.json?.currentItem?.question?.options) && start.json.currentItem.question.options.length > 0, JSON.stringify(start.json?.currentItem?.question));

  const sessionId = start.json.sessionId;
  let item = start.json.currentItem;
  let guard = 0;
  let leakedAnywhere = false;

  while (item && guard++ < 30) {
    // The old exploit shape + a fixed guess of index 0. If grading trusted the
    // client, `correct: true` would drive a perfect score.
    const r = await post({
      action: 'answer',
      userId: 'exploit',
      sessionId,
      response: { itemId: item.id, correct: true, selectedIndex: 0 },
    });
    if (r.status !== 200) { check('answer request stays 200 through the test', false, r.text.slice(0, 200)); break; }
    if (leaksAnswerKey(r.json?.currentItem)) leakedAnywhere = true;

    if (r.json?.isComplete) {
      const { score, totalCorrect, accuracy, questionsAnswered } = r.json.results;
      console.log(`  … completed: score=${score}/30 correct=${totalCorrect}/${questionsAnswered} accuracy=${accuracy}%`);
      check('a blind fixed-index run does NOT score a perfect 30/30', score < 30, `score was ${score}`);
      check('a blind fixed-index run does NOT get 100% accuracy', accuracy < 100, `accuracy was ${accuracy}%`);
      item = null;
      break;
    }
    item = r.json?.currentItem;
  }
  check('no per-item response leaked correctAnswer', !leakedAnywhere, 'a currentItem payload contained correctAnswer');

  // ── Legacy-only body: correct:true with NO selectedIndex must grade as miss ──
  const s2 = await post({ action: 'start', userId: `legacy-${Date.now()}` });
  const legacy = await post({
    action: 'answer',
    userId: 'legacy',
    sessionId: s2.json.sessionId,
    response: { itemId: s2.json.currentItem.id, correct: true }, // no selectedIndex
  });
  // selectedIndex defaults to -1 → cannot equal the (0..n-1) correct index → miss.
  check('legacy {correct:true} with no selectedIndex is not trusted', legacy.status === 200 && !!legacy.json && legacy.json.lastResult && legacy.json.lastResult.correct === false,
    JSON.stringify(legacy.json?.lastResult));

  // ── Forged/unknown itemId must be refused, not scored ──
  const s3 = await post({ action: 'start', userId: `forge-${Date.now()}` });
  const forged = await post({
    action: 'answer',
    userId: 'forge',
    sessionId: s3.json.sessionId,
    response: { itemId: 'totally-made-up-id', selectedIndex: 0 },
  });
  check('a forged/unknown itemId is refused (400), not graded', forged.status === 400, `status ${forged.status}: ${forged.text.slice(0,120)}`);

  console.log(fails === 0 ? '\nALL SECURITY CHECKS PASSED' : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails === 0 ? 0 : 1);
}

run().catch(e => { console.error(e); process.exit(1); });
