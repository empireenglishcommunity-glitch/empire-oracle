// ═══════════════════════════════════════════════════════════
// EMPIRE ENGLISH — AI Speaking Evaluator
// Uses Groq (triple-fallback) + deterministic scoring
// Students ALWAYS get a score, even if all APIs fail
// ═══════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from 'next/server';
import { withApiProtection } from '@/lib/api-protection';
import { callAI, scoreSpeakingDeterministic } from '@/lib/ai-provider';

// ─── Handler ────────────────────────────────────────────────

async function handler(req: NextRequest) {
  try {
    const { transcript, expectedText, part, taskType, context, duration } = await req.json();

    const isWriting = taskType === 'writing_summary' || taskType === 'writing_essay';

    // Every response from this route is shaped { evaluation, source }.
    //
    // It used to be inconsistent: the two writing branches spread their scores
    // FLAT while every guard and both speaking branches nested them under
    // `evaluation`. The writing UI read the flat shape, so any guard response
    // gave it `undefined` for every criterion — which its `?? 15` defaults then
    // turned into a mid-band score. Combined with the caller sending
    // `transcription` instead of `transcript`, every writing submission scored a
    // constant 18/30. Keep this ONE shape.
    //
    // The two tasks also use different field names AND different scales:
    //   writing  → { overall, grammar, coherence, vocabulary, development }  0-25
    //   speaking → { overallScore, pronunciation, fluency, ... }             0-100
    // so a guard must answer in the shape of the task it was asked about.
    const emptyEvaluation = (feedback: string) => (isWriting
      ? { overall: 0, grammar: 0, coherence: 0, vocabulary: 0, development: 0, feedback }
      : {
        overallScore: 0, pronunciation: 0, fluency: 0,
        grammar: 0, vocabulary: 0, coherence: 0, similarity: 0, feedback,
      });

    // No submission = no score (honest evaluation)
    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({
        evaluation: emptyEvaluation(isWriting ? 'No text submitted.' : 'No speech detected.'),
        source: 'none',
      });
    }

    const cleanTranscript = transcript.trim();
    const wordCount = cleanTranscript.split(/\s+/).length;

    // Too few words
    if (wordCount < 3) {
      return NextResponse.json({
        evaluation: isWriting
          ? {
            overall: 0, grammar: 0, coherence: 0, vocabulary: 0, development: 0,
            feedback: 'Too short to evaluate — write at least a few sentences.',
          }
          : {
            overallScore: 5, pronunciation: 5, fluency: 5,
            grammar: 5, vocabulary: 5, coherence: 5, similarity: 0,
            feedback: 'Too few words spoken to evaluate properly.',
          },
        source: 'minimum',
      });
    }

    // ─── Writing evaluation (for /api/ai/evaluate-speaking reuse) ──
    if (taskType === 'writing_summary' || taskType === 'writing_essay') {
      const systemPrompt = `You are an academic writing evaluator. Score the student's writing on a scale of 0-25 for each criterion. Respond in JSON only.`;
      const userPrompt = taskType === 'writing_summary'
        ? `Evaluate this SUMMARY of the passage below.\n\nOriginal passage:\n"${context}"\n\nStudent's summary:\n"${cleanTranscript}"\n\nScore 0-25 each:\n- grammar: grammatical accuracy\n- coherence: logical flow and organization\n- vocabulary: word choice and range\n- development: how well ideas are developed\n- overall: average of above\n- feedback: one sentence of constructive feedback\n\nJSON only: {"grammar":n,"coherence":n,"vocabulary":n,"development":n,"overall":n,"feedback":"..."}`
        : `Evaluate this ESSAY:\n"${cleanTranscript}"\n\nScore 0-25 each:\n- grammar: grammatical accuracy\n- coherence: logical flow and organization\n- vocabulary: word choice and range\n- development: how well ideas are argued\n- overall: average of above\n- feedback: one sentence of constructive feedback\n\nJSON only: {"grammar":n,"coherence":n,"vocabulary":n,"development":n,"overall":n,"feedback":"..."}`;

      const aiResult = await callAI({ systemPrompt, userPrompt, temperature: 0.2, maxTokens: 512, jsonMode: true });

      if (aiResult) {
        try {
          const clean = aiResult.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
          const evaluation = JSON.parse(clean);
          if (typeof evaluation.overall === 'number') {
            // Nested, like every other branch. Was spread flat.
            return NextResponse.json({ evaluation, source: aiResult.source });
          }
        } catch { /* fall through to deterministic */ }
      }

      // Deterministic writing fallback. Returns 0-25 per criterion (it scales
      // internally), matching the 0-25 the AI prompt above asks for and the
      // /25 the writing page divides by. Do not "normalise" it to 0-100.
      const { scoreWritingDeterministic } = await import('@/lib/ai-provider');
      const detScore = scoreWritingDeterministic(cleanTranscript, taskType === 'writing_summary' ? 175 : 300);
      return NextResponse.json({ evaluation: detScore, source: 'deterministic' });
    }

    // ─── Speaking evaluation ────────────────────────────────

    // Build evaluation prompt
    let userPrompt = '';
    const systemPrompt = 'You are an English speaking assessor. Evaluate the student transcript. Respond in JSON ONLY, no markdown.';

    if (part === 'read_aloud' || part === 'shadowing') {
      userPrompt = `Student was asked to read/repeat: "${expectedText}"
What they said: "${cleanTranscript}"
Word count: ${wordCount}

Score 0-100 each. JSON only:
{"overallScore":n,"pronunciation":n,"fluency":n,"grammar":n,"vocabulary":n,"coherence":n,"feedback":"..."}`;
    } else {
      userPrompt = `Student was asked to speak spontaneously about a topic.
Their response: "${cleanTranscript}"
Word count: ${wordCount}, Duration: ${duration || 60}s

Score 0-100 each based on:
- pronunciation: clarity (speech recognition accuracy reflects this)
- fluency: pace, smoothness, lack of pauses
- grammar: correctness of sentence structure
- vocabulary: range and appropriateness
- coherence: logical flow of ideas

JSON only:
{"overallScore":n,"pronunciation":n,"fluency":n,"grammar":n,"vocabulary":n,"coherence":n,"feedback":"..."}`;
    }

    // Try AI (Groq triple-fallback)
    const aiResult = await callAI({ systemPrompt, userPrompt, temperature: 0.2, maxTokens: 512 });

    if (aiResult) {
      try {
        const clean = aiResult.content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const evaluation = JSON.parse(clean);
        if (typeof evaluation.overallScore === 'number') {
          return NextResponse.json({ evaluation, source: aiResult.source });
        }
      } catch { /* fall through to deterministic */ }
    }

    // ─── Deterministic fallback (always works) ─────────────

    const detScore = scoreSpeakingDeterministic(cleanTranscript, expectedText || '', duration || 60);
    return NextResponse.json({
      evaluation: {
        overallScore: Math.round(detScore.overall * 3.3), // scale 0-30 → 0-100 for compat
        pronunciation: Math.round(detScore.pronunciation * 3.3),
        fluency: Math.round(detScore.fluency * 3.3),
        grammar: Math.round(detScore.grammar * 3.3),
        vocabulary: Math.round(detScore.vocabulary * 3.3),
        coherence: Math.round(detScore.coherence * 3.3),
        feedback: detScore.feedback,
      },
      source: 'deterministic',
    });
  } catch (error) {
    console.error('[evaluate-speaking] Error:', error);
    return NextResponse.json({
      evaluation: { overallScore: 0, pronunciation: 0, fluency: 0, grammar: 0, vocabulary: 0, coherence: 0, feedback: 'Evaluation error occurred.' },
      source: 'error',
    });
  }
}

export const POST = withApiProtection({ rateLimit: 'aiEvaluation' })(handler);
