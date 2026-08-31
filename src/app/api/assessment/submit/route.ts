import { NextRequest, NextResponse } from 'next/server';
import { withApiProtection } from '@/lib/api-protection';
import { analyzeResponseTimes, type AnswerTiming } from '@/services/assessment-engine';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

interface AnswerInput {
  questionId: string;
  selectedAnswer: number;
  isCorrect: boolean;
  timeTaken: number; // milliseconds
}

// The four section scores (reading / listening / speaking / writing) are all
// 0-30, and the total is their sum out of 120.
const SECTION_MAX = 30;

/** Convert a 0-100 rating to the 0-30 section scale. */
function toSectionScore(raw: unknown): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  return Math.round(Math.max(0, Math.min(100, raw)) / 100 * SECTION_MAX);
}

/**
 * Accept a value that is ALREADY on the 0-30 section scale.
 *
 * Returns null for anything outside the range rather than clamping it. Clamping
 * is what hid the speaking scale bug: a 0-100 value arrived, `Math.min(30, …)`
 * silently turned any score above 30 into a perfect section score, and nothing
 * reported it. A caller sending the wrong scale is a bug we want to see.
 */
function asSectionScore(raw: unknown, module: string, field: string): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw < 0 || raw > SECTION_MAX) {
    console.error(
      `[SUBMIT] ${module}.${field} = ${raw} is outside the 0-${SECTION_MAX} section scale — rejected, not clamped.`,
    );
    return null;
  }
  return Math.round(raw);
}

async function handler(req: NextRequest) {
  try {
    const { assessmentId, module, answers, scores, userId: clientUserId } = await req.json();

    if (!module) {
      return NextResponse.json({ error: 'Module required' }, { status: 400 });
    }

    // ─── Anti-Cheating: Response Time Analysis ────────────
    let integrityAnalysis = null;
    if (answers && answers.length > 0) {
      const timings: AnswerTiming[] = (answers as AnswerInput[]).map((a) => ({
        elapsed: a.timeTaken ? a.timeTaken / 1000 : null, // convert ms → seconds
        correct: a.isCorrect,
      }));
      integrityAnalysis = analyzeResponseTimes(timings);
    }

    // Try to save to database
    try {
      const { db } = await import('@/lib/db');

      // Get the current user — RELIABLE method via email lookup from session
      let userId: string | null = null;
      
      // Method 1: Client sent their userId directly
      if (clientUserId && typeof clientUserId === 'string' && clientUserId.length > 5) {
        const userExists = await db.user.findUnique({ where: { id: clientUserId } }).catch(() => null);
        if (userExists) userId = clientUserId;
      }
      
      // Method 2: Try getServerSession with cookies forwarded
      if (!userId) {
        try {
          const session = await getServerSession(authOptions);
          if (session?.user) {
            const email = session.user.email;
            if (email) {
              const user = await db.user.findUnique({ where: { email } });
              if (user) userId = user.id;
            }
            if (!userId) {
              userId = (session.user as Record<string, unknown>)?.id as string || null;
            }
          }
        } catch { /* session not available */ }
      }

      // Method 3: Find user by email from request body (if provided)
      if (!userId && clientUserId && clientUserId.includes('@')) {
        const user = await db.user.findUnique({ where: { email: clientUserId } }).catch(() => null);
        if (user) userId = user.id;
      }

      // NOTE: there was a "Method 4: if there is exactly one user in the DB,
      // attribute the submission to them". It was a testing shortcut that
      // shipped, and it silently wrote one person's answers onto another
      // account's record (e.g. a logged-out guest on a fresh database). A
      // submission we cannot attribute must be rejected, not guessed at.

      console.log('[SUBMIT] userId resolved:', userId ? userId.slice(0, 8) + '...' : 'NULL', 'module:', module);

      if (userId) {
        // Find or create an assessment record for this user
        let assessment = await db.assessment.findFirst({
          where: { userId, status: 'in_progress' },
          orderBy: { startedAt: 'desc' },
        }).catch(() => null);

        if (!assessment) {
          // Create a new assessment record
          assessment = await db.assessment.create({
            data: {
              userId,
              status: 'in_progress',
              currentModule: module,
            },
          }).catch(() => null);
        }

        if (assessment) {
          // Build the update data based on module
          const updateData: Record<string, unknown> = { currentModule: module };

          // Add integrity flags if suspicious
          if (integrityAnalysis?.suspicious) {
            updateData.flagged = true;
            updateData.flagReason = integrityAnalysis.flags.map((f) => f.message).join('; ');
          }

          if (module === 'vocabulary' && scores) {
            updateData.voBand1 = scores.band1 ?? null;
            updateData.voBand2 = scores.band2 ?? null;
            updateData.voBand3 = scores.band3 ?? null;
            updateData.voBand4 = scores.band4 ?? null;
            updateData.voBand5 = scores.band5 ?? null;
            updateData.voEstimatedSize = scores.estimatedSize ?? null;
            updateData.voOverall = scores.overall ?? null;
            updateData.voLevel = scores.level ?? null;
          }

          if (module === 'grammar' && scores) {
            updateData.grPercentage = scores.percentage ?? scores.overall ?? null;
            updateData.grLevel = scores.level ?? null;
          }

          if (module === 'speaking' && scores) {
            updateData.spPronunciation = scores.pronunciation ?? null;
            updateData.spFluency = scores.fluency ?? null;
            updateData.spWordsPerMinute = scores.wordsPerMinute ?? null;
            updateData.spPhonemeAcc = scores.phonemeAccuracy ?? null;
            updateData.spGrammarAcc = scores.grammarAccuracy ?? null;
            updateData.spVocabRange = scores.vocabularyRange ?? null;
            updateData.spConfidence = scores.confidence ?? null;
            updateData.spRhythmMatch = scores.rhythmMatch ?? null;
            updateData.spLevel = scores.level ?? null;
            // Speaking is rated on 0-100 (see SPEAKING_LEVELS), but
            // `speakingScore` is a 0-30 SECTION score like the other three.
            // Both columns used to receive the raw 0-100 value, and the results
            // page then did Math.min(30, …) — so every speaking score of 30 or
            // more was reported as a perfect 30/30. Keep the scales distinct.
            updateData.spOverall = scores.overall ?? null;              // 0-100
            updateData.speakingScore = toSectionScore(scores.overall);  // 0-30
          }

          if (module === 'listening' && scores) {
            updateData.liLiteral = scores.literalComprehension ?? null;
            updateData.liInference = scores.inference ?? null;
            updateData.liOverall = scores.overall ?? null;
            updateData.liLevel = scores.level ?? null;
            updateData.listeningScore = asSectionScore(scores.overall, module, 'overall');
          }

          if (module === 'reading' && scores) {
            updateData.readingScore = asSectionScore(scores.overall, module, 'overall');
          }

          if (module === 'writing' && scores) {
            updateData.writingScore = asSectionScore(scores.overall, module, 'overall');
          }

          // Check if all modules are complete
          const currentAssessment = await db.assessment.findUnique({ where: { id: assessment.id } });
          const hasVocab = currentAssessment?.voOverall !== null || (module === 'vocabulary' && scores?.overall);
          const hasGrammar = currentAssessment?.grPercentage !== null || (module === 'grammar' && scores);
          const hasSpeaking = currentAssessment?.spOverall !== null || currentAssessment?.speakingScore !== null || (module === 'speaking' && scores?.overall);
          const hasListening = currentAssessment?.liOverall !== null || currentAssessment?.listeningScore !== null || (module === 'listening' && scores?.overall);
          const hasReading = currentAssessment?.readingScore !== null || (module === 'reading' && scores?.overall);
          const hasWriting = currentAssessment?.writingScore !== null || (module === 'writing' && scores?.overall);

          if (hasVocab && hasGrammar && hasSpeaking && hasListening && hasReading && hasWriting) {
            updateData.status = 'completed';
            updateData.completedAt = new Date();
          }

          // ─── Persist the total and the level (server-side) ──────
          //
          // `totalScore` and `cefrLevel` are columns that nothing ever wrote.
          // Every surface recomputed them client-side on render, so the admin
          // table, the score email and the certificate all read NULL and fell
          // back to defaults ('A1'). The server owns this now: it is the only
          // place that sees all four section scores.
          //
          // The MAPPING itself is still the legacy one (4 buckets with compound
          // bands like 'A2-B1'). Replacing it with six discrete CEFR levels is
          // P1 — see docs/CEFR-ALIGNMENT-AUDIT-AND-PLAN-2026-08-31.md. This
          // change only makes the stored value real.
          const { getTotalLevel } = await import('@/lib/types');
          const sectionOf = (key: string): number => {
            const pending = updateData[key];
            if (typeof pending === 'number') return pending;
            const stored = (currentAssessment as Record<string, unknown> | null)?.[key];
            return typeof stored === 'number' ? stored : 0;
          };
          const total = sectionOf('readingScore') + sectionOf('listeningScore')
            + sectionOf('speakingScore') + sectionOf('writingScore');
          updateData.totalScore = total;
          updateData.cefrLevel = getTotalLevel(total).cefr;

          await db.assessment.update({
            where: { id: assessment.id },
            data: updateData,
          });

          // Save individual answers
          if (answers && answers.length > 0) {
            await db.answer.createMany({
              data: (answers as AnswerInput[]).map((a) => ({
                assessmentId: assessment!.id,
                module,
                questionId: a.questionId,
                selectedAnswer: a.selectedAnswer,
                isCorrect: a.isCorrect,
                timeTaken: a.timeTaken,
              })),
            }).catch(() => {});
          }
        }
      }
    } catch (dbError) {
      // This used to log and fall through to `success: true`. A student's
      // results silently vanishing looked identical to a successful save, both
      // to them and to us. Persistence failing IS the request failing.
      console.error('[SUBMIT] DB save failed:', dbError);
      return NextResponse.json(
        { error: 'Could not save your results. Please try again.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      integrity: integrityAnalysis
        ? {
            suspicious: integrityAnalysis.suspicious,
            averageTime: Math.round(integrityAnalysis.averageTime * 10) / 10,
            flagCount: integrityAnalysis.flags.length,
          }
        : null,
    });
  } catch (error) {
    console.error('Submit error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// Apply rate limiting and bot detection
export const POST = withApiProtection({ rateLimit: 'assessment' })(handler);
