// ═══════════════════════════════════════════════════════════
// EMPIRE ENGLISH — Adaptive Reading Assessment API
// Uses IRT to select optimal questions per student ability
// Each student gets a unique, personalized test
// ═══════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { withApiProtection } from '@/lib/api-protection';
import {
  initAdaptiveTest,
  processResponse,
  getNextItem,
  getReadingItemDifficulty,
  thetaToScore,
  thetaToLevel,
  DEFAULT_IRT_CONFIG,
  type IRTItem,
  type IRTResponse,
  type AdaptiveReadingState,
} from '@/services/irt-engine';
import { ALL_READING_PASSAGES, type ReadingPassage, type ReadingQuestion } from '@/data/reading-passages';

// ─── In-Memory Session Store (per-user adaptive state) ──────
// In production, this would be in Redis or DB. For now, memory works for <100 concurrent users.

const adaptiveSessions = new Map<string, {
  state: AdaptiveReadingState;
  questionMap: Map<string, { passage: ReadingPassage; question: ReadingQuestion }>;
  // Per-served-item answer key, kept SERVER-SIDE only. Maps an itemId to the
  // options as they were shuffled for THIS session and the index of the correct
  // one AFTER shuffling. This is the whole point of the security fix: the client
  // is never told which option is correct, and it grades nothing — it posts the
  // index it selected and the server decides. See the `answer` handler.
  answerKey: Map<string, { shuffledOptions: string[]; correctIndex: number }>;
  createdAt: number;
}>();

// ─── Server-side option shuffle (grading authority lives here) ──────────────
//
// WHY THIS EXISTS
// The adaptive reading score used to be CLIENT-CONTROLLED: the browser received
// each question's `correctAnswer`, graded its own answer, and POSTed
// `{ itemId, correct }`, which the server trusted. Posting `correct: true`
// repeatedly yielded a perfect 30/30. The fix is to grade on the server, which
// means the server must (a) never send the answer key to the client and
// (b) know, for each option position the client sees, whether it is correct.
//
// So the server shuffles the options itself, remembers the correct post-shuffle
// index, and sends only the shuffled option strings. Deterministic per
// (sessionId, itemId) so a re-render/status call is stable, but unpredictable
// across sessions (the sessionId carries a timestamp) so the order cannot be
// precomputed from the public item bank.
function _hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function _seededShuffleOptions(
  options: string[],
  correctIndex: number,
  seedStr: string,
): { shuffledOptions: string[]; correctIndex: number } {
  if (options.length <= 1) {
    return { shuffledOptions: [...options], correctIndex };
  }
  // Pair each option with a deterministic key derived from the seed + its text,
  // then sort by that key — a stable, seed-driven permutation.
  const seed = _hashString(seedStr);
  const decorated = options.map((opt, i) => ({
    opt,
    isCorrect: i === correctIndex,
    key: _hashString(`${seed}:${i}:${opt}`),
  }));
  decorated.sort((a, b) => a.key - b.key);
  return {
    shuffledOptions: decorated.map(d => d.opt),
    correctIndex: decorated.findIndex(d => d.isCorrect),
  };
}

// Prepare a question for sending to the client: shuffle its options
// server-side, record the correct post-shuffle index in the session's answer
// key, and return a payload with NO answer key. The client renders
// `options` in the given order and posts back the index it selected.
function serveQuestion(
  sessionId: string,
  answerKey: Map<string, { shuffledOptions: string[]; correctIndex: number }>,
  question: ReadingQuestion,
): { id: string; type: string; questionText: string; options: string[] } {
  const { shuffledOptions, correctIndex } = _seededShuffleOptions(
    question.options,
    question.correctAnswer,
    `${sessionId}:${question.id}`,
  );
  answerKey.set(question.id, { shuffledOptions, correctIndex });
  return {
    id: question.id,
    type: question.type,
    questionText: question.questionText,
    options: shuffledOptions,
    // NOTE: no `correctAnswer` — grading is server-side only.
  };
}

// Clean old sessions every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, session] of adaptiveSessions) {
    if (now - session.createdAt > 60 * 60 * 1000) { // 1 hour expiry
      adaptiveSessions.delete(key);
    }
  }
}, 10 * 60 * 1000);

// ─── Build IRT Item Pool from Reading Passages ──────────────

function buildItemPool(): { items: IRTItem[]; questionMap: Map<string, { passage: ReadingPassage; question: ReadingQuestion }> } {
  const items: IRTItem[] = [];
  const questionMap = new Map<string, { passage: ReadingPassage; question: ReadingQuestion }>();

  for (const passage of ALL_READING_PASSAGES) {
    for (let qIdx = 0; qIdx < passage.questions.length; qIdx++) {
      const question = passage.questions[qIdx];
      const irtItem = getReadingItemDifficulty(passage.difficulty, qIdx);
      irtItem.id = question.id;
      items.push(irtItem);
      questionMap.set(question.id, { passage, question });
    }
  }

  return { items, questionMap };
}

// ─── Handler ────────────────────────────────────────────────

async function handler(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, userId, sessionId, response } = body as {
      action: 'start' | 'answer' | 'status';
      userId: string;
      sessionId?: string;
      // `selectedIndex` is the option the student picked, in the SERVER-shuffled
      // order the client was sent (-1 or omitted = "I don't know"/skip). A legacy
      // `correct` field may still arrive from an old client build; it is
      // deliberately ignored — the server grades from `selectedIndex` only.
      response?: { itemId: string; selectedIndex?: number; correct?: boolean };
    };

    if (!userId) {
      return NextResponse.json({ error: 'userId required' }, { status: 400 });
    }

    // ─── START: Initialize new adaptive test ────────────────

    if (action === 'start') {
      const { items, questionMap } = buildItemPool();

      // Shuffle items slightly to avoid always starting with same question
      const shuffledItems = [...items].sort(() => Math.random() - 0.5);

      const state = initAdaptiveTest(shuffledItems, {
        ...DEFAULT_IRT_CONFIG,
        minItems: 5,
        maxItems: 15,
        seThreshold: 0.45,
      });

      const sid = `adaptive-${userId}-${Date.now()}`;
      const answerKey = new Map<string, { shuffledOptions: string[]; correctIndex: number }>();
      adaptiveSessions.set(sid, { state, questionMap, answerKey, createdAt: Date.now() });

      // Get first item
      const nextItem = getNextItem(state);
      if (!nextItem) {
        return NextResponse.json({ error: 'No items available' }, { status: 500 });
      }

      const itemData = questionMap.get(nextItem.id);
      if (!itemData) {
        return NextResponse.json({ error: 'Item data not found' }, { status: 500 });
      }

      const publicQuestion = serveQuestion(sid, answerKey, itemData.question);

      return NextResponse.json({
        sessionId: sid,
        currentItem: {
          id: nextItem.id,
          passage: {
            title: itemData.passage.title,
            text: itemData.passage.text,
            difficulty: itemData.passage.difficulty,
            topic: itemData.passage.topic,
            wordCount: itemData.passage.wordCount,
          },
          question: publicQuestion,
        },
        progress: {
          questionsAnswered: 0,
          maxQuestions: 15,
          currentAbility: 0,
          standardError: 1.0,
          confidence: 0,
        },
        isComplete: false,
      });
    }

    // ─── ANSWER: Process response and get next item ─────────

    if (action === 'answer') {
      if (!sessionId || !response || !response.itemId) {
        return NextResponse.json({ error: 'sessionId and response.itemId required' }, { status: 400 });
      }

      const session = adaptiveSessions.get(sessionId);
      if (!session) {
        return NextResponse.json({ error: 'Session expired or not found' }, { status: 404 });
      }

      // ─── SERVER-SIDE GRADING (do NOT trust a client `correct`) ──────────
      //
      // The client posts the INDEX it selected (or -1 / omitted for "I don't
      // know"). The server looks up the answer key it stored when it served
      // this item and decides correctness itself. A forged `correct: true` in
      // the body is ignored — there is no path here that reads it.
      const key = session.answerKey.get(response.itemId);
      if (!key) {
        // Item was never served in this session → cannot be graded. Refuse
        // rather than guess, so a replayed/forged itemId can't score.
        return NextResponse.json({ error: 'Item not served in this session' }, { status: 400 });
      }
      const selectedIndex = Number.isInteger(response.selectedIndex) ? response.selectedIndex! : -1;
      const graded = selectedIndex === key.correctIndex;
      // One grade per served item: drop the key so the same item can't be
      // re-submitted to nudge the estimate.
      session.answerKey.delete(response.itemId);

      // Process the response
      const irtResponse: IRTResponse = {
        itemId: response.itemId,
        correct: graded,
      };

      const newState = processResponse(session.state, irtResponse);
      session.state = newState;

      // If test is complete, return final results
      if (newState.isComplete) {
        const score = thetaToScore(newState.estimate.theta);
        const level = thetaToLevel(newState.estimate.theta);
        const totalCorrect = newState.responses.filter(r => r.correct).length;

        // Clean up session
        adaptiveSessions.delete(sessionId);

        return NextResponse.json({
          isComplete: true,
          // The server's verdict on the just-submitted item, so the client can
          // show its reveal without ever having (or needing) the answer key.
          lastResult: { itemId: response.itemId, correct: graded, correctIndex: key.correctIndex },
          results: {
            score, // 0-30
            level,
            theta: Math.round(newState.estimate.theta * 100) / 100,
            standardError: Math.round(newState.estimate.standardError * 100) / 100,
            confidence: Math.round(newState.estimate.confidence * 100) / 100,
            questionsAnswered: newState.responses.length,
            totalCorrect,
            accuracy: Math.round((totalCorrect / newState.responses.length) * 100),
            history: newState.estimate.history,
          },
        });
      }

      // Get next item
      const nextItem = getNextItem(newState);
      if (!nextItem) {
        // No more items — force complete
        const score = thetaToScore(newState.estimate.theta);
        const level = thetaToLevel(newState.estimate.theta);
        const totalCorrect = newState.responses.filter(r => r.correct).length;
        adaptiveSessions.delete(sessionId);

        return NextResponse.json({
          isComplete: true,
          lastResult: { itemId: response.itemId, correct: graded, correctIndex: key.correctIndex },
          results: {
            score,
            level,
            theta: Math.round(newState.estimate.theta * 100) / 100,
            standardError: Math.round(newState.estimate.standardError * 100) / 100,
            confidence: Math.round(newState.estimate.confidence * 100) / 100,
            questionsAnswered: newState.responses.length,
            totalCorrect,
            accuracy: Math.round((totalCorrect / newState.responses.length) * 100),
            history: newState.estimate.history,
          },
        });
      }

      const itemData = session.questionMap.get(nextItem.id);
      if (!itemData) {
        return NextResponse.json({ error: 'Next item data not found' }, { status: 500 });
      }

      const publicNextQuestion = serveQuestion(sessionId, session.answerKey, itemData.question);

      return NextResponse.json({
        sessionId,
        // Server's verdict on the item just answered (for the reveal UX).
        lastResult: { itemId: response.itemId, correct: graded, correctIndex: key.correctIndex },
        currentItem: {
          id: nextItem.id,
          passage: {
            title: itemData.passage.title,
            text: itemData.passage.text,
            difficulty: itemData.passage.difficulty,
            topic: itemData.passage.topic,
            wordCount: itemData.passage.wordCount,
          },
          question: publicNextQuestion,
        },
        progress: {
          questionsAnswered: newState.responses.length,
          maxQuestions: 15,
          currentAbility: Math.round(newState.estimate.theta * 100) / 100,
          standardError: Math.round(newState.estimate.standardError * 100) / 100,
          confidence: Math.round(newState.estimate.confidence * 100) / 100,
        },
        isComplete: false,
      });
    }

    // ─── STATUS: Get current test status ────────────────────

    if (action === 'status') {
      if (!sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
      }

      const session = adaptiveSessions.get(sessionId);
      if (!session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
      }

      return NextResponse.json({
        progress: {
          questionsAnswered: session.state.responses.length,
          maxQuestions: 15,
          currentAbility: Math.round(session.state.estimate.theta * 100) / 100,
          standardError: Math.round(session.state.estimate.standardError * 100) / 100,
          confidence: Math.round(session.state.estimate.confidence * 100) / 100,
        },
        isComplete: session.state.isComplete,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use: start, answer, status' }, { status: 400 });
  } catch (error) {
    console.error('[adaptive-reading] Error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export const POST = withApiProtection({ rateLimit: 'assessment' })(handler);
