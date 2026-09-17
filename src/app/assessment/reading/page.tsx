'use client';

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { Clock, ChevronRight, BookOpen, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import {
  ParticleBackground,
  Navbar,
  Footer,
  MetallicCard,
  ImperialButton,
  GlowingBorder,
  ProgressBar,
  SectionDivider,
} from '@/components/empire';
import { getReadingSet, type ReadingPassage, type ReadingQuestion } from '@/data/reading-passages';
import { shuffleOptions } from '@/lib/shuffle-options';

// ─── Types ─────────────────────────────────────────────────

type Phase = 'intro' | 'reading' | 'results';

interface AnswerRecord {
  questionId: string;
  selectedAnswer: number;
  isCorrect: boolean;
}

// ─── Component ─────────────────────────────────────────────

export default function ReadingAssessmentPage() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [passages, setPassages] = useState<ReadingPassage[]>([]);
  const [currentPassageIndex, setCurrentPassageIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);
  const [isStarting, setIsStarting] = useState(false);

  // Timer per passage
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const PASSAGE_TIME = { easy: 7 * 60, medium: 10 * 60, hard: 14 * 60 }; // seconds

  // ─── IRT Adaptive Mode State ─────────────────────────────
  const [adaptiveMode, setAdaptiveMode] = useState(true); // Default: adaptive ON
  const [adaptiveSessionId, setAdaptiveSessionId] = useState<string | null>(null);
  const [adaptiveItem, setAdaptiveItem] = useState<{
    id: string;
    passage: { title: string; text: string; difficulty: string; topic: string; wordCount: number };
    // Options arrive ALREADY SHUFFLED by the server and carry NO answer key —
    // grading is server-side now (security fix for the client-controlled score).
    question: { id: string; type: string; questionText: string; options: string[] };
  } | null>(null);
  // The server's verdict on the current item, returned by /answer AFTER we post
  // our selected index. Drives the correct/wrong reveal; null until answered.
  const [adaptiveReveal, setAdaptiveReveal] = useState<{ correct: boolean; correctIndex: number } | null>(null);
  const [adaptiveProgress, setAdaptiveProgress] = useState({ questionsAnswered: 0, maxQuestions: 15, confidence: 0 });
  const [adaptiveResults, setAdaptiveResults] = useState<{ score: number; questionsAnswered: number; totalCorrect: number; accuracy: number } | null>(null);

  const startPassageTimer = useCallback((difficulty: 'easy' | 'medium' | 'hard') => {
    if (timerRef.current) clearInterval(timerRef.current);
    const seconds = PASSAGE_TIME[difficulty];
    setTimeLeft(seconds);
    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  const formatTimer = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ─── Submit Reading Score to API ─────────────────────────
  // Works for BOTH adaptive and static modes
  const submitReadingScore = useCallback(async (readingScore: number, finalAnswers?: AnswerRecord[]) => {
    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
      const sessionData = await sessionResp.json();
      const uid = sessionData?.user?.id || sessionData?.user?.email;
      if (!uid) { console.error('[Reading] No user in session — score NOT saved'); return; }
      console.log('[Reading] Submitting score:', readingScore, 'uid:', uid);
      await fetch('/api/assessment/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          module: 'reading',
          userId: uid,
          answers: (finalAnswers || []).map(a => ({
            questionId: a.questionId,
            selectedAnswer: a.selectedAnswer,
            isCorrect: a.isCorrect,
            timeTaken: 5000,
          })),
          scores: {
            overall: readingScore,
            level: readingScore >= 24 ? 3 : readingScore >= 16 ? 2 : readingScore >= 8 ? 1 : 0,
          },
        }),
      });
      console.log('[Reading] Score saved successfully:', readingScore);
    } catch (e) { console.error('[Reading] Submit FAILED:', e); }
  }, []);

  // ─── Shuffle options for current question (Bug 2 fix) ────
  // Must be defined before any useCallback that references them
  const shuffled = useMemo(() => {
    const cq = passages[currentPassageIndex]?.questions[currentQuestionIndex];
    if (!cq) return { shuffledOptions: [] as string[], newCorrectIndex: 0 };
    const seed = cq.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return shuffleOptions(cq.options, cq.correctAnswer, seed);
  }, [passages, currentPassageIndex, currentQuestionIndex]);

  // Adaptive options are pre-shuffled by the server and sent without an answer
  // key, so the client no longer shuffles or knows the correct index up front.
  // Grading happens on the server; the reveal uses `adaptiveReveal` returned by
  // /answer. This object keeps the render code below unchanged in shape.
  const adaptiveShuffled = useMemo(() => ({
    shuffledOptions: adaptiveItem?.question?.options ?? [],
    newCorrectIndex: adaptiveReveal?.correctIndex ?? -1,
  }), [adaptiveItem, adaptiveReveal]);

  // ─── Adaptive: Start IRT Test ────────────────────────────

  const handleStartAdaptive = useCallback(async () => {
    try {
      const userId = typeof window !== 'undefined' ? (sessionStorage.getItem('empire-user-id') || `guest-${Date.now()}`) : `guest-${Date.now()}`;
      const res = await fetch('/api/assessment/adaptive-reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start', userId }),
      });
      if (!res.ok) throw new Error('Failed to start adaptive test');
      const data = await res.json();

      setAdaptiveSessionId(data.sessionId);
      setAdaptiveItem(data.currentItem);
      setAdaptiveProgress(data.progress);
      setPhase('reading');
      // Start timer based on passage difficulty
      if (data.currentItem?.passage?.difficulty) {
        startPassageTimer(data.currentItem.passage.difficulty as 'easy' | 'medium' | 'hard');
      }
    } catch {
      // Fallback to static mode if adaptive fails
      setAdaptiveMode(false);
      handleStartStatic();
    }
  }, [startPassageTimer]);

  // ─── Adaptive: Submit Answer ─────────────────────────────

  // Buffer for the next item, which the server returns in the SAME /answer
  // response that grades the current one — so there is exactly ONE post per
  // item. "Next Question" just swaps this in; it does not post again.
  const pendingNextRef = useRef<{ currentItem: typeof adaptiveItem; progress: typeof adaptiveProgress } | 'complete' | null>(null);
  const pendingResultsRef = useRef<{ score: number; questionsAnswered: number; totalCorrect: number; accuracy: number } | null>(null);

  // Posts the SELECTED INDEX (in the server-shuffled order) ONCE and lets the
  // server grade. Shows the server's verdict (reveal); the next item is
  // buffered and swapped in by handleAdaptiveNext without another post.
  const handleAdaptiveAnswer = useCallback(async (selectedIndex: number) => {
    if (!adaptiveSessionId || !adaptiveItem) return;

    try {
      const res = await fetch('/api/assessment/adaptive-reading', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'answer',
          userId: 'current',
          sessionId: adaptiveSessionId,
          response: { itemId: adaptiveItem.id, selectedIndex },
        }),
      });
      if (!res.ok) throw new Error('Failed to submit answer');
      const data = await res.json();

      // Record the server's verdict (drives the reveal + the running answer log).
      const isCorrect = !!data.lastResult?.correct;
      if (data.lastResult) {
        setAdaptiveReveal({ correct: isCorrect, correctIndex: data.lastResult.correctIndex });
      }
      setAnswers(prev => [...prev, { questionId: adaptiveItem.question.id, selectedAnswer: selectedIndex, isCorrect }]);

      if (data.isComplete) {
        pendingNextRef.current = 'complete';
        // Stash results; the reveal shows first, then handleAdaptiveNext finishes.
        pendingResultsRef.current = data.results;
      } else {
        pendingNextRef.current = { currentItem: data.currentItem, progress: data.progress };
      }
    } catch {
      setPhase('results');
      submitReadingScore(score || 0, answers);
    }
  }, [adaptiveSessionId, adaptiveItem, score, answers, submitReadingScore]);

  // ─── Adaptive: Skip Question ─────────────────────────────

  const handleAdaptiveSkip = useCallback(() => {
    if (isAnswered) return;
    setSelectedOption(-1);
    setIsAnswered(true);
    // -1 = "I don't know". The server grades it (incorrect) and returns the
    // reveal + the next item. The answer log is appended in handleAdaptiveAnswer.
    handleAdaptiveAnswer(-1);
  }, [isAnswered, handleAdaptiveAnswer]);

  // ─── Adaptive: Select Option ─────────────────────────────

  const handleAdaptiveSelect = useCallback((idx: number) => {
    if (isAnswered || !adaptiveItem) return;
    setSelectedOption(idx);
    setIsAnswered(true);
    // Post the selected index; the SERVER decides correctness and sends back
    // the reveal. The client no longer knows the answer key.
    handleAdaptiveAnswer(idx);
  }, [isAnswered, adaptiveItem, handleAdaptiveAnswer]);

  // ─── Adaptive: Proceed to Next After Reveal ──────────────
  // No network call — the next item was already returned by /answer and buffered.

  const handleAdaptiveNext = useCallback(() => {
    const pending = pendingNextRef.current;
    pendingNextRef.current = null;
    if (pending === 'complete') {
      const results = pendingResultsRef.current;
      if (results) {
        setAdaptiveResults(results);
        setScore(results.score);
      }
      setPhase('results');
      if (timerRef.current) clearInterval(timerRef.current);
      submitReadingScore(results?.score ?? score ?? 0, answers);
      return;
    }
    if (pending && pending.currentItem) {
      setAdaptiveItem(pending.currentItem);
      setAdaptiveProgress(pending.progress);
      setSelectedOption(null);
      setIsAnswered(false);
      setAdaptiveReveal(null);
      if (pending.currentItem.passage?.difficulty) {
        startPassageTimer(pending.currentItem.passage.difficulty as 'easy' | 'medium' | 'hard');
      }
    }
  }, [answers, score, submitReadingScore, startPassageTimer]);

  // ─── Start Trial (router) ────────────────────────────────

  const handleStart = useCallback(async () => {
    if (adaptiveMode) {
      await handleStartAdaptive();
      return;
    }
    await handleStartStatic();
  }, [adaptiveMode, handleStartAdaptive]);

  // ─── Static Mode: Original Start (fallback) ──────────────

  const handleStartStatic = useCallback(async () => {
    // Try AI-generated passages first, fallback to static bank
    const difficulties: ('easy' | 'medium' | 'hard')[] = ['easy', 'medium', 'hard'];
    const aiPassages: ReadingPassage[] = [];

    for (const diff of difficulties) {
      try {
        const res = await fetch('/api/ai/generate-reading', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ difficulty: diff }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.passage && data.source === 'ai') {
            aiPassages.push(data.passage);
            continue;
          }
        }
      } catch { /* AI failed, will use fallback */ }
      // If AI failed for this difficulty, leave empty (will be filled below)
      aiPassages.push(null as unknown as ReadingPassage);
    }

    // Fill in any gaps with static passages
    const staticSet = getReadingSet();
    const finalPassages = aiPassages.map((p, i) => p || staticSet[i]);

    setPassages(finalPassages);
    setCurrentPassageIndex(0);
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setSelectedOption(null);
    setIsAnswered(false);
    setPhase('reading');
    // Start timer for first passage
    if (finalPassages[0]) startPassageTimer(finalPassages[0].difficulty);
  }, [startPassageTimer]);

  // ─── Answer Selection (moved after shuffled definition) ──

  // ─── Skip Question ───────────────────────────────────────

  const handleSkip = () => {
    if (isAnswered) return;
    if (!passages[currentPassageIndex]?.questions[currentQuestionIndex]) return;
    const passage = passages[currentPassageIndex];
    const question = passage.questions[currentQuestionIndex];
    const newAnswers = [...answers, { questionId: question.id, selectedAnswer: -1, isCorrect: false }];
    setAnswers(newAnswers);
    setIsAnswered(true);
    
    setTimeout(() => {
      if (currentQuestionIndex + 1 < passage.questions.length) {
        setCurrentQuestionIndex(prev => prev + 1);
        setSelectedOption(null);
        setIsAnswered(false);
      } else if (currentPassageIndex + 1 < passages.length) {
        setCurrentPassageIndex(prev => prev + 1);
        setCurrentQuestionIndex(0);
        startPassageTimer(passages[currentPassageIndex + 1].difficulty);
        setSelectedOption(null);
        setIsAnswered(false);
      } else {
        const totalCorrect = newAnswers.filter(a => a.isCorrect).length;
        const totalQ = passages.reduce((sum, p) => sum + p.questions.length, 0);
        setScore(Math.round((totalCorrect / totalQ) * 30));
        setPhase('results');
        const sc = Math.round((newAnswers.filter(a => a.isCorrect).length / (passages.reduce((s, p) => s + p.questions.length, 0) || 1)) * 30); submitReadingScore(sc, newAnswers);
      }
    }, 50);
  };

  // ─── Next Question ───────────────────────────────────────

  const advanceQuestion = useCallback(() => {
    const passage = passages[currentPassageIndex];
    if (currentQuestionIndex + 1 < passage.questions.length) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else if (currentPassageIndex + 1 < passages.length) {
      setCurrentPassageIndex(prev => prev + 1);
      setCurrentQuestionIndex(0);
      startPassageTimer(passages[currentPassageIndex + 1].difficulty);
    } else {
      // All done — submit directly
      const totalCorrect = answers.filter(a => a.isCorrect).length;
      const totalQ = passages.reduce((sum, p) => sum + p.questions.length, 0);
      setScore(Math.round((totalCorrect / totalQ) * 30));
      setPhase('results');
      const sc2 = Math.round((answers.filter(a => a.isCorrect).length / (passages.reduce((s, p) => s + p.questions.length, 0) || 1)) * 30); submitReadingScore(sc2, answers);
      return;
    }
    setSelectedOption(null);
    setIsAnswered(false);
  }, [passages, currentPassageIndex, currentQuestionIndex, startPassageTimer, answers, submitReadingScore]);

  const handleNext = () => {
    advanceQuestion();
  };

  // ─── Current State ───────────────────────────────────────

  const currentPassage = passages[currentPassageIndex];
  const currentQuestion = currentPassage?.questions[currentQuestionIndex];
  const totalQuestions = passages.reduce((sum, p) => sum + p.questions.length, 0);
  const answeredSoFar = answers.length;

  // ─── Answer Selection ────────────────────────────────────

  const handleSelectOption = (idx: number) => {
    if (isAnswered) return;
    setSelectedOption(idx);
    setIsAnswered(true);
    const passage = passages[currentPassageIndex];
    const question = passage.questions[currentQuestionIndex];
    const isCorrect = idx === shuffled.newCorrectIndex;
    setAnswers(prev => [...prev, { questionId: question.id, selectedAnswer: idx, isCorrect }]);
  };


  // ─── Intro Screen ────────────────────────────────────────

  if (phase === 'intro') {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <motion.div className="text-center mb-10" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-6xl mb-6">📖</div>
              <h1 className="font-[family-name:var(--font-heading)] text-4xl sm:text-5xl font-bold text-[#c9a84c] mb-2">
                Trial of Reading
              </h1>
              <p className="font-arabic text-[#8b7355] text-base mb-3" dir="rtl">اختبار القراءة والفهم</p>
              <p className="font-[family-name:var(--font-heading)] text-[#cd7f32] text-lg tracking-widest uppercase">
                The Comprehension Trial
              </p>
            </motion.div>

            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <GlowingBorder color="gold" intensity="medium">
                <MetallicCard className="p-6 sm:p-8 text-center" hover={false}>
                  <p className="text-[#c0c0c0] text-base leading-relaxed mb-4">
                    You will read 3 academic passages of increasing difficulty and answer 5 comprehension
                    questions for each passage. Questions test your ability to identify main ideas, locate
                    specific details, make inferences, understand vocabulary in context, and determine author purpose.
                  </p>
                  <p className="font-arabic text-[#8b7355] text-sm leading-relaxed mb-4" dir="rtl">
                    ستقرأ 3 نصوص أكاديمية بصعوبة متزايدة وتجيب عن 5 أسئلة فهم لكل نص. الأسئلة تختبر قدرتك على تحديد الأفكار الرئيسية، إيجاد التفاصيل، الاستنتاج، فهم المفردات في السياق، وتحديد غرض الكاتب.
                  </p>
                </MetallicCard>
              </GlowingBorder>
            </motion.div>

            <SectionDivider />

            {/* Assessment Rules */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <MetallicCard className="p-5 sm:p-6" hover={false}>
                <h3 className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm uppercase tracking-widest mb-4 text-center">
                  Assessment Rules
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-[#4ade80] mt-0.5">✓</span>
                    <span className="text-[#c0c0c0]">Read each passage carefully before answering</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#4ade80] mt-0.5">✓</span>
                    <span className="text-[#c0c0c0]">You can scroll back to re-read the passage</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#e74c3c] mt-0.5">✗</span>
                    <span className="text-[#c0c0c0]">Do not use a dictionary or translation tool</span>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="text-[#4ade80] mt-0.5">✓</span>
                    <span className="text-[#c0c0c0]">Use &ldquo;I Don&apos;t Know&rdquo; if truly unsure</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-[rgba(201,168,76,0.1)] text-center">
                  <span className="text-[#8b7355] text-xs">3 Passages &middot; 15 Questions &middot; ~20 minutes &middot; Score: 0-30</span>
                </div>
              </MetallicCard>
            </motion.div>

            <motion.div className="text-center mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
              <ImperialButton variant="primary" size="lg" onClick={() => { setIsStarting(true); handleStart(); }} disabled={isStarting} className="gap-2">
                {isStarting ? (
                  <>
                    <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                      <Clock className="w-5 h-5" />
                    </motion.div>
                    <span>Preparing your test...</span>
                  </>
                ) : (
                  <>
                    <span>Begin Reading Trial</span>
                    <ChevronRight className="w-5 h-5" />
                  </>
                )}
              </ImperialButton>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }


  // ─── Reading: ADAPTIVE MODE ────────────────────────────────

  if (phase === 'reading' && adaptiveMode && adaptiveItem) {
    const difficultyColors: Record<string, string> = { easy: '#4ade80', medium: '#c9a84c', hard: '#ff6b35' };
    const diffColor = difficultyColors[adaptiveItem.passage.difficulty] || '#c9a84c';

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {/* Progress Header */}
            <motion.div className="mb-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-[family-name:var(--font-heading)] text-sm font-bold" style={{ color: diffColor }}>
                    {adaptiveItem.passage.difficulty.charAt(0).toUpperCase() + adaptiveItem.passage.difficulty.slice(1)} — {adaptiveItem.passage.topic}
                  </span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-heading)] tracking-wider uppercase border border-[rgba(74,222,128,0.3)] text-[#4ade80] bg-[rgba(74,222,128,0.05)]">
                    Adaptive
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs">
                    Q{adaptiveProgress.questionsAnswered + 1} / {adaptiveProgress.maxQuestions} max
                  </span>
                  {/* Timer */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                    timeLeft <= 60 && timeLeft > 0 ? 'border-[rgba(231,76,60,0.4)] bg-[rgba(231,76,60,0.05)]'
                    : 'border-[rgba(201,168,76,0.2)] bg-[rgba(201,168,76,0.03)]'
                  }`}>
                    <Clock className={`w-3.5 h-3.5 ${timeLeft <= 60 && timeLeft > 0 ? 'text-[#e74c3c]' : 'text-[#c9a84c]'}`} />
                    <span className={`font-[family-name:var(--font-heading)] text-xs tabular-nums ${timeLeft <= 60 && timeLeft > 0 ? 'text-[#e74c3c]' : 'text-[#c9a84c]'}`}>
                      {formatTimer(timeLeft)}
                    </span>
                  </div>
                </div>
              </div>
              <ProgressBar value={adaptiveProgress.questionsAnswered + 1} max={adaptiveProgress.maxQuestions} showPercentage={false} color={diffColor} size="sm" />
            </motion.div>

            {/* Split Layout: Passage + Question */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* LEFT: Passage */}
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="order-2 lg:order-1">
                <MetallicCard className="p-5 sm:p-6 max-h-[70vh] overflow-y-auto" hover={false}>
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen className="w-4 h-4 text-[#c9a84c]" />
                    <h3 className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm tracking-wide">
                      {adaptiveItem.passage.title}
                    </h3>
                    <span className="text-[#8b7355] text-[10px] ml-auto">{adaptiveItem.passage.wordCount} words</span>
                  </div>
                  <div className="text-[#c0c0c0] text-sm sm:text-base leading-relaxed whitespace-pre-line font-[family-name:var(--font-sans)]">
                    {adaptiveItem.passage.text}
                  </div>
                </MetallicCard>
              </motion.div>

              {/* RIGHT: Question */}
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="order-1 lg:order-2">
                <GlowingBorder color="gold" intensity="low">
                  <MetallicCard className="p-5 sm:p-6" hover={false}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-heading)] tracking-wider uppercase border border-[rgba(201,168,76,0.3)] text-[#c9a84c] bg-[rgba(201,168,76,0.05)]">
                        {adaptiveItem.question.type.replace('_', ' ')}
                      </span>
                    </div>
                    <h4 className="font-[family-name:var(--font-sans)] text-[#e8e8e8] text-base sm:text-lg leading-relaxed mb-6">
                      {adaptiveItem.question.questionText}
                    </h4>
                    <div className="space-y-3">
                      {adaptiveShuffled.shuffledOptions.map((option, idx) => {
                        const isSelected = selectedOption === idx;
                        const isCorrect = isAnswered && idx === adaptiveShuffled.newCorrectIndex;
                        const isWrong = isAnswered && isSelected && idx !== adaptiveShuffled.newCorrectIndex;
                        return (
                          <button key={idx} type="button" onClick={() => handleAdaptiveSelect(idx)} disabled={isAnswered}
                            className={`w-full text-left rounded-lg border p-4 transition-all duration-200 ${
                              isCorrect ? 'border-[#4ade80] bg-[rgba(74,222,128,0.08)]'
                              : isWrong ? 'border-[#e74c3c] bg-[rgba(231,76,60,0.08)]'
                              : isSelected ? 'border-[#c9a84c] bg-[rgba(201,168,76,0.08)]'
                              : 'border-[rgba(201,168,76,0.15)] bg-[#111118] hover:border-[rgba(201,168,76,0.35)]'
                            }`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold font-[family-name:var(--font-heading)] ${
                                isCorrect ? 'border-[#4ade80] text-[#4ade80]'
                                : isWrong ? 'border-[#e74c3c] text-[#e74c3c]'
                                : isSelected ? 'border-[#c9a84c] text-[#c9a84c]'
                                : 'border-[rgba(201,168,76,0.25)] text-[#8b7355]'
                              }`}>{String.fromCharCode(65 + idx)}</div>
                              <span className={`text-sm ${isCorrect ? 'text-[#4ade80]' : isWrong ? 'text-[#e74c3c]' : isSelected ? 'text-[#e8d48b]' : 'text-[#c0c0c0]'}`}>{option}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-col items-center gap-3 mt-6">
                      {isAnswered ? (
                        <ImperialButton variant="primary" size="md" onClick={handleAdaptiveNext} className="gap-2 w-full sm:w-auto">
                          <span>Next Question</span>
                          <ArrowRight className="w-4 h-4" />
                        </ImperialButton>
                      ) : (
                        <button type="button" onClick={handleAdaptiveSkip}
                          className="group flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(139,115,85,0.3)] hover:border-[rgba(139,115,85,0.5)] transition-all">
                          <ChevronRight className="w-4 h-4 text-[#8b7355] group-hover:text-[#c9a84c]" />
                          <span className="font-[family-name:var(--font-heading)] text-sm text-[#8b7355] group-hover:text-[#c9a84c]">I Don&apos;t Know</span>
                          <span className="font-arabic text-xs text-[#8b7355]" dir="rtl">لا أعرف</span>
                        </button>
                      )}
                    </div>
                  </MetallicCard>
                </GlowingBorder>
              </motion.div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ─── Reading + Questions Screen (STATIC MODE) ─────────────

  if (phase === 'reading' && currentPassage && currentQuestion) {
    const difficultyColors = { easy: '#4ade80', medium: '#c9a84c', hard: '#ff6b35' };
    const difficultyLabels = { easy: 'Passage 1 — Foundation', medium: 'Passage 2 — Academic', hard: 'Passage 3 — Advanced' };

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {/* Progress Header */}
            <motion.div className="mb-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span className="font-[family-name:var(--font-heading)] text-sm font-bold" style={{ color: difficultyColors[currentPassage.difficulty] }}>
                    {difficultyLabels[currentPassage.difficulty]}
                  </span>
                  <span className="text-[rgba(201,168,76,0.3)]">|</span>
                  <span className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs">
                    Q{currentQuestionIndex + 1} of {currentPassage.questions.length}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {/* Passage timer */}
                  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                    timeLeft <= 60 && timeLeft > 0 ? 'border-[rgba(231,76,60,0.4)] bg-[rgba(231,76,60,0.05)]'
                    : timeLeft <= 120 ? 'border-[rgba(255,107,53,0.4)] bg-[rgba(255,107,53,0.05)]'
                    : 'border-[rgba(201,168,76,0.2)] bg-[rgba(201,168,76,0.03)]'
                  }`}>
                    <Clock className={`w-3.5 h-3.5 ${timeLeft <= 60 && timeLeft > 0 ? 'text-[#e74c3c]' : timeLeft <= 120 ? 'text-[#ff6b35]' : 'text-[#c9a84c]'}`} />
                    <span className={`font-[family-name:var(--font-heading)] text-xs tabular-nums ${timeLeft <= 60 && timeLeft > 0 ? 'text-[#e74c3c]' : timeLeft <= 120 ? 'text-[#ff6b35]' : 'text-[#c9a84c]'}`}>
                      {timeLeft === 0 ? 'TIME' : formatTimer(timeLeft)}
                    </span>
                  </div>
                  <span className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs">
                    {answeredSoFar}/{totalQuestions} total
                  </span>
                </div>
              </div>
              <ProgressBar value={answeredSoFar + 1} max={totalQuestions} showPercentage={false} color={difficultyColors[currentPassage.difficulty]} size="sm" />
            </motion.div>

            {/* Split Layout: Passage + Question */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* LEFT: Passage */}
              <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="order-2 lg:order-1">
                <MetallicCard className="p-5 sm:p-6 max-h-[70vh] overflow-y-auto" hover={false}>
                  <div className="flex items-center gap-2 mb-4">
                    <BookOpen className="w-4 h-4 text-[#c9a84c]" />
                    <h3 className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm tracking-wide">
                      {currentPassage.title}
                    </h3>
                    <span className="text-[#8b7355] text-[10px] ml-auto">{currentPassage.wordCount} words</span>
                  </div>
                  <div className="text-[#c0c0c0] text-sm sm:text-base leading-relaxed whitespace-pre-line font-[family-name:var(--font-sans)]">
                    {currentPassage.text}
                  </div>
                </MetallicCard>
              </motion.div>

              {/* RIGHT: Question */}
              <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="order-1 lg:order-2">
                <AnimatePresence mode="wait">
                  <motion.div key={currentQuestion.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                    <GlowingBorder color="gold" intensity="low">
                      <MetallicCard className="p-5 sm:p-6" hover={false}>
                        {/* Question type badge */}
                        <div className="flex items-center gap-2 mb-4">
                          <span className="px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-heading)] tracking-wider uppercase border border-[rgba(201,168,76,0.3)] text-[#c9a84c] bg-[rgba(201,168,76,0.05)]">
                            {currentQuestion.type.replace('_', ' ')}
                          </span>
                        </div>

                        {/* Question text */}
                        <h4 className="font-[family-name:var(--font-sans)] text-[#e8e8e8] text-base sm:text-lg leading-relaxed mb-6">
                          {currentQuestion.questionText}
                        </h4>

                        {/* Options */}
                        <div className="space-y-3">
                          {shuffled.shuffledOptions.map((option, idx) => {
                            const isSelected = selectedOption === idx;
                            const isCorrect = isAnswered && idx === shuffled.newCorrectIndex;
                            const isWrong = isAnswered && isSelected && idx !== shuffled.newCorrectIndex;

                            return (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleSelectOption(idx)}
                                disabled={isAnswered}
                                className={`w-full text-left rounded-lg border p-4 transition-all duration-200 ${
                                  isCorrect ? 'border-[#4ade80] bg-[rgba(74,222,128,0.08)]'
                                  : isWrong ? 'border-[#e74c3c] bg-[rgba(231,76,60,0.08)]'
                                  : isSelected ? 'border-[#c9a84c] bg-[rgba(201,168,76,0.08)]'
                                  : 'border-[rgba(201,168,76,0.15)] bg-[#111118] hover:border-[rgba(201,168,76,0.35)]'
                                }`}
                              >
                                <div className="flex items-center gap-3">
                                  <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold font-[family-name:var(--font-heading)] ${
                                    isCorrect ? 'border-[#4ade80] text-[#4ade80]'
                                    : isWrong ? 'border-[#e74c3c] text-[#e74c3c]'
                                    : isSelected ? 'border-[#c9a84c] text-[#c9a84c]'
                                    : 'border-[rgba(201,168,76,0.25)] text-[#8b7355]'
                                  }`}>
                                    {String.fromCharCode(65 + idx)}
                                  </div>
                                  <span className={`text-sm ${
                                    isCorrect ? 'text-[#4ade80]' : isWrong ? 'text-[#e74c3c]' : isSelected ? 'text-[#e8d48b]' : 'text-[#c0c0c0]'
                                  }`}>
                                    {option}
                                  </span>
                                  {isCorrect && <CheckCircle2 className="w-4 h-4 text-[#4ade80] ml-auto" />}
                                  {isWrong && <XCircle className="w-4 h-4 text-[#e74c3c] ml-auto" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>

                        {/* Actions */}
                        <div className="flex flex-col items-center gap-3 mt-6">
                          {isAnswered ? (
                            <ImperialButton variant="primary" size="md" onClick={handleNext} className="gap-2 w-full sm:w-auto">
                              <span>Next Question</span>
                              <ArrowRight className="w-4 h-4" />
                            </ImperialButton>
                          ) : (
                            <button
                              type="button"
                              onClick={handleSkip}
                              className="group flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(139,115,85,0.3)] bg-[rgba(139,115,85,0.05)] hover:border-[rgba(139,115,85,0.5)] transition-all"
                            >
                              <ChevronRight className="w-4 h-4 text-[#8b7355] group-hover:text-[#c9a84c]" />
                              <span className="font-[family-name:var(--font-heading)] text-sm text-[#8b7355] group-hover:text-[#c9a84c]">I Don&apos;t Know</span>
                              <span className="font-arabic text-xs text-[#8b7355]" dir="rtl">لا أعرف</span>
                            </button>
                          )}
                        </div>
                      </MetallicCard>
                    </GlowingBorder>
                  </motion.div>
                </AnimatePresence>
              </motion.div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }


  // ─── Results Screen ──────────────────────────────────────

  if (phase === 'results') {
    const totalCorrect = answers.filter(a => a.isCorrect).length;
    const totalAnswered = answers.filter(a => a.selectedAnswer !== -1).length;
    const totalSkipped = answers.filter(a => a.selectedAnswer === -1).length;
    const accuracy = totalAnswered > 0 ? Math.round((totalCorrect / totalAnswered) * 100) : 0;
    const finalScore = Math.round((totalCorrect / totalQuestions) * 30);

    // Per-passage breakdown
    const passageResults = passages.map(p => {
      const pAnswers = answers.filter(a => p.questions.some(q => q.id === a.questionId));
      const correct = pAnswers.filter(a => a.isCorrect).length;
      return { title: p.title, difficulty: p.difficulty, correct, total: p.questions.length };
    });

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            {/* Header */}
            <motion.div className="text-center mb-8" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-5xl mb-4">📖</div>
              <h1 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl font-bold text-[#c9a84c] mb-2">
                Reading Trial Complete
              </h1>
              <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-base">
                The Comprehension Trial has been conquered
              </p>
            </motion.div>

            {/* Score Card */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <GlowingBorder color="gold" intensity="high">
                <MetallicCard className="p-6 sm:p-8" hover={false}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
                    <div>
                      <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs uppercase tracking-widest mb-2">Reading Score</p>
                      <p className="font-[family-name:var(--font-heading)] text-4xl font-bold text-[#c9a84c]">{finalScore}</p>
                      <p className="text-[#8b7355] text-xs mt-1">out of 30</p>
                    </div>
                    <div className="sm:border-x sm:border-[rgba(201,168,76,0.15)]">
                      <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs uppercase tracking-widest mb-2">Correct</p>
                      <p className="font-[family-name:var(--font-heading)] text-4xl font-bold text-[#4ade80]">{totalCorrect}</p>
                      <p className="text-[#8b7355] text-xs mt-1">of {totalQuestions} questions</p>
                    </div>
                    <div>
                      <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs uppercase tracking-widest mb-2">Accuracy</p>
                      <p className="font-[family-name:var(--font-heading)] text-4xl font-bold text-[#c9a84c]">{accuracy}%</p>
                      <p className="text-[#8b7355] text-xs mt-1">{totalSkipped > 0 ? `${totalSkipped} skipped` : 'all answered'}</p>
                    </div>
                  </div>
                </MetallicCard>
              </GlowingBorder>
            </motion.div>

            <SectionDivider />

            {/* Per-Passage Breakdown */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <h2 className="font-[family-name:var(--font-heading)] text-xl text-[#c9a84c] text-center mb-4 tracking-wide">
                Passage Breakdown
              </h2>
              <div className="space-y-3">
                {passageResults.map((pr, idx) => {
                  const pct = Math.round((pr.correct / pr.total) * 100);
                  const colors = { easy: '#4ade80', medium: '#c9a84c', hard: '#ff6b35' };
                  return (
                    <MetallicCard key={idx} className="p-4" hover={false}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-[family-name:var(--font-heading)] text-sm text-[#e8e8e8]">{pr.title}</span>
                        <span className="font-[family-name:var(--font-heading)] text-sm font-bold" style={{ color: colors[pr.difficulty] }}>
                          {pr.correct}/{pr.total}
                        </span>
                      </div>
                      <ProgressBar value={pr.correct} max={pr.total} showPercentage={false} color={colors[pr.difficulty]} size="sm" />
                      <div className="flex justify-between mt-1">
                        <span className="text-[10px] text-[#8b7355] font-[family-name:var(--font-heading)] capitalize">{pr.difficulty}</span>
                        <span className="text-[10px] font-[family-name:var(--font-heading)]" style={{ color: colors[pr.difficulty] }}>{pct}%</span>
                      </div>
                    </MetallicCard>
                  );
                })}
              </div>
            </motion.div>

            <SectionDivider />

            {/* Actions */}
            <motion.div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
              <Link href="/assessment">
                <ImperialButton variant="primary" size="lg" className="gap-2">
                  <span>Continue to Next Trial</span>
                  <ChevronRight className="w-5 h-5" />
                </ImperialButton>
              </Link>
              <ImperialButton variant="outline" size="lg" onClick={handleStart} className="gap-2">
                <span>Retake Reading</span>
              </ImperialButton>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return null;
}
