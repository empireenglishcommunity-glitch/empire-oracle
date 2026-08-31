'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { ChevronRight, Clock, PenTool, BookOpen, ArrowRight, AlertCircle } from 'lucide-react';
import {
  ParticleBackground,
  Navbar,
  Footer,
  MetallicCard,
  ImperialButton,
  GlowingBorder,
  SectionDivider,
  ProgressBar,
} from '@/components/empire';
import { TASK1_PROMPTS, TASK2_PROMPTS, type WritingPrompt } from '@/data/writing-prompts';

// ─── Types ─────────────────────────────────────────────────

type Phase = 'intro' | 'task1' | 'task2' | 'evaluating' | 'results';

interface TaskScore {
  grammar: number;
  coherence: number;
  vocabulary: number;
  development: number;
  overall: number;
  feedback: string;
}


// ─── Writing Prompts ───────────────────────────────────────


// ─── Helper: Word Counter ──────────────────────────────────

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length;
}

// ─── Component ─────────────────────────────────────────────

export default function WritingAssessmentPage() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [task1Prompt, setTask1Prompt] = useState<WritingPrompt | null>(null);
  const [task2Prompt, setTask2Prompt] = useState<WritingPrompt | null>(null);
  const [task1Text, setTask1Text] = useState('');
  const [task2Text, setTask2Text] = useState('');
  const [timeLeft, setTimeLeft] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [task1Score, setTask1Score] = useState<TaskScore | null>(null);
  const [task2Score, setTask2Score] = useState<TaskScore | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  // ─── Auto-save to sessionStorage (every 30s) ─────────────

  useEffect(() => {
    // Restore on mount
    if (typeof window !== 'undefined') {
      const saved1 = sessionStorage.getItem('empire-writing-task1');
      const saved2 = sessionStorage.getItem('empire-writing-task2');
      if (saved1 && !task1Text) setTask1Text(saved1);
      if (saved2 && !task2Text) setTask2Text(saved2);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const interval = setInterval(() => {
      if (task1Text) sessionStorage.setItem('empire-writing-task1', task1Text);
      if (task2Text) sessionStorage.setItem('empire-writing-task2', task2Text);
    }, 30000); // Save every 30 seconds
    return () => clearInterval(interval);
  }, [task1Text, task2Text]);

  // Clear saved text when submitting
  const clearAutoSave = () => {
    if (typeof window !== 'undefined') {
      sessionStorage.removeItem('empire-writing-task1');
      sessionStorage.removeItem('empire-writing-task2');
    }
  };

  // ─── Timer ───────────────────────────────────────────────

  const startTimer = useCallback((minutes: number) => {
    setTimeLeft(minutes * 60);
    if (timerRef.current) clearInterval(timerRef.current);
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

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const formatTime = (seconds: number): string => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ─── Start Trial ─────────────────────────────────────────

  const handleStart = () => {
    const t1 = TASK1_PROMPTS[Math.floor(Math.random() * TASK1_PROMPTS.length)];
    const t2 = TASK2_PROMPTS[Math.floor(Math.random() * TASK2_PROMPTS.length)];
    setTask1Prompt(t1);
    setTask2Prompt(t2);
    setTask1Text('');
    setTask2Text('');
    setPhase('task1');
    startTimer(t1.timeMinutes);
  };

  // ─── Submit Task 1 → Move to Task 2 ─────────────────────

  const handleSubmitTask1 = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setPhase('task2');
    if (task2Prompt) startTimer(task2Prompt.timeMinutes);
  };

  // ─── Submit Task 2 → Evaluate ────────────────────────────

  const handleSubmitTask2 = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    clearAutoSave();
    setPhase('evaluating');
    setIsEvaluating(true);

    // AI Evaluation via Gemini
    let score1: TaskScore;
    let score2: TaskScore;
    try {
      [score1, score2] = await Promise.all([
        evaluateWriting(task1Text, 'summary', task1Prompt?.passage || ''),
        evaluateWriting(task2Text, 'essay', ''),
      ]);
      setTask1Score(score1);
      setTask2Score(score2);
    } catch {
      // Fallback scoring based on word count and basic heuristics
      score1 = fallbackScore(task1Text, 150);
      score2 = fallbackScore(task2Text, 300);
      setTask1Score(score1);
      setTask2Score(score2);
    }

    setIsEvaluating(false);
    setPhase('results');
    submitWritingScore(score1, score2); // Direct call — no useEffect
  };

  // ─── Submit Score to API (called directly after evaluation) ─────
  const submitWritingScore = async (s1: TaskScore, s2: TaskScore) => {
    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
      const sessionData = await sessionResp.json();
      const uid = sessionData?.user?.id || sessionData?.user?.email;
      if (!uid) { console.error('[Writing] No user in session'); return; }
      const finalScoreCalc = Math.round((s1.overall + s2.overall) / 2);
      const writingScaledScore = Math.round((finalScoreCalc / 25) * 30);
      console.log('[Writing] Submitting score:', writingScaledScore, 'uid:', uid);
      await fetch('/api/assessment/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          module: 'writing',
          userId: uid,
          answers: [],
          scores: {
            overall: writingScaledScore,
            level: writingScaledScore >= 24 ? 3 : writingScaledScore >= 16 ? 2 : writingScaledScore >= 8 ? 1 : 0,
            grammar: s1.grammar,
            coherence: s1.coherence,
            vocabulary: s1.vocabulary,
          },
        }),
      });
      console.log('[Writing] Score saved successfully');
    } catch (e) { console.error('[Writing] Submit failed:', e); }
  };

  // Auto-advance when timer expires — student never gets stuck
  useEffect(() => {
    if (timeLeft !== 0) return;
    if (phase === 'task1') {
      handleSubmitTask1();
    } else if (phase === 'task2') {
      handleSubmitTask2();
    }
  }, [timeLeft]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <WritingUI
      phase={phase}
      task1Prompt={task1Prompt}
      task2Prompt={task2Prompt}
      task1Text={task1Text}
      task2Text={task2Text}
      setTask1Text={setTask1Text}
      setTask2Text={setTask2Text}
      timeLeft={timeLeft}
      formatTime={formatTime}
      handleStart={handleStart}
      handleSubmitTask1={handleSubmitTask1}
      handleSubmitTask2={handleSubmitTask2}
      task1Score={task1Score}
      task2Score={task2Score}
      isEvaluating={isEvaluating}
    />
  );
}

// ─── AI Evaluation Function ────────────────────────────────

async function evaluateWriting(text: string, type: 'summary' | 'essay', sourcePassage: string): Promise<TaskScore> {
  try {
    const res = await fetch('/api/ai/evaluate-speaking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Field name is `transcript` — the route destructures exactly that.
        // Sending `transcription` made the route see an empty submission and
        // return zeros, which the old `?? 15` defaults below silently turned
        // into a mid-band score. Every essay scored 18/30 as a result.
        transcript: text,
        taskType: type === 'summary' ? 'writing_summary' : 'writing_essay',
        context: sourcePassage,
      }),
    });
    if (!res.ok) throw new Error('AI evaluation failed');
    const data = await res.json();

    // Scores are nested under `evaluation` (0-25 per criterion), and are
    // validated before use — the same way the speaking page does it. There are
    // deliberately NO `?? 15` fallbacks: a missing score must fall through to
    // the local deterministic scorer, which actually reads the text, rather
    // than quietly becoming an average mark.
    const ev = data?.evaluation;
    if (!ev || typeof ev.overall !== 'number') {
      return fallbackScore(text, type === 'summary' ? 150 : 300);
    }
    return {
      grammar: ev.grammar,
      coherence: ev.coherence,
      vocabulary: ev.vocabulary,
      development: ev.development,
      overall: ev.overall,
      feedback: ev.feedback ?? 'Evaluation complete.',
    };
  } catch {
    return fallbackScore(text, type === 'summary' ? 150 : 300);
  }
}

function fallbackScore(text: string, targetWords: number): TaskScore {
  const words = countWords(text);
  const lengthRatio = Math.min(words / targetWords, 1.5);
  const baseScore = Math.min(Math.round(lengthRatio * 20), 25);
  return {
    grammar: baseScore,
    coherence: baseScore,
    vocabulary: baseScore,
    development: baseScore,
    overall: baseScore,
    feedback: words < targetWords * 0.5
      ? 'Your response is too short. Try to develop your ideas more fully.'
      : words >= targetWords
        ? 'Good length. Your response meets the minimum word requirement.'
        : 'Your response is slightly below the recommended length.',
  };
}

// ─── UI Component ──────────────────────────────────────────

function WritingUI({
  phase, task1Prompt, task2Prompt, task1Text, task2Text,
  setTask1Text, setTask2Text, timeLeft, formatTime,
  handleStart, handleSubmitTask1, handleSubmitTask2,
  task1Score, task2Score, isEvaluating,
}: {
  phase: Phase;
  task1Prompt: WritingPrompt | null;
  task2Prompt: WritingPrompt | null;
  task1Text: string;
  task2Text: string;
  setTask1Text: (t: string) => void;
  setTask2Text: (t: string) => void;
  timeLeft: number;
  formatTime: (s: number) => string;
  handleStart: () => void;
  handleSubmitTask1: () => void;
  handleSubmitTask2: () => void;
  task1Score: TaskScore | null;
  task2Score: TaskScore | null;
  isEvaluating: boolean;
}) {
  // ─── Intro ───────────────────────────────────────────────

  if (phase === 'intro') {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <motion.div className="text-center mb-10" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-6xl mb-6">✍️</div>
              <h1 className="font-[family-name:var(--font-heading)] text-4xl sm:text-5xl font-bold text-[#c9a84c] mb-2">Trial of Writing</h1>
              <p className="font-arabic text-[#8b7355] text-base mb-3" dir="rtl">اختبار الكتابة</p>
              <p className="font-[family-name:var(--font-heading)] text-[#cd7f32] text-lg tracking-widest uppercase">The Inscription Trial</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <GlowingBorder color="gold" intensity="medium">
                <MetallicCard className="p-6 sm:p-8 text-center" hover={false}>
                  <p className="text-[#c0c0c0] text-base leading-relaxed mb-4">
                    You will complete two writing tasks. <strong>Task 1:</strong> Read a passage and write a
                    summary (150-225 words, 20 minutes). <strong>Task 2:</strong> Write an independent essay
                    expressing your opinion on a topic (300+ words, 25 minutes).
                  </p>
                  <p className="font-arabic text-[#8b7355] text-sm leading-relaxed" dir="rtl">
                    ستكمل مهمتين كتابيتين. المهمة الأولى: اقرأ نصاً واكتب ملخصاً (150-225 كلمة). المهمة الثانية: اكتب مقالاً مستقلاً يعبر عن رأيك (300+ كلمة).
                  </p>
                </MetallicCard>
              </GlowingBorder>
            </motion.div>
            <SectionDivider />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <MetallicCard className="p-5" hover={false}>
                <h3 className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm uppercase tracking-widest mb-4 text-center">Assessment Rules</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2"><span className="text-[#4ade80] mt-0.5">✓</span><span className="text-[#c0c0c0]">Write in your own words — no copying</span></div>
                  <div className="flex items-start gap-2"><span className="text-[#4ade80] mt-0.5">✓</span><span className="text-[#c0c0c0]">Organize your ideas with clear paragraphs</span></div>
                  <div className="flex items-start gap-2"><span className="text-[#e74c3c] mt-0.5">✗</span><span className="text-[#c0c0c0]">Do not use AI tools or translators</span></div>
                  <div className="flex items-start gap-2"><span className="text-[#4ade80] mt-0.5">✓</span><span className="text-[#c0c0c0]">Meet the minimum word count requirement</span></div>
                </div>
                <div className="mt-4 pt-3 border-t border-[rgba(201,168,76,0.1)] text-center">
                  <span className="text-[#8b7355] text-xs">2 Tasks &middot; ~45 minutes total &middot; Score: 0-30</span>
                </div>
              </MetallicCard>
            </motion.div>
            <motion.div className="text-center mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
              <ImperialButton variant="primary" size="lg" onClick={() => { handleStart(); }} className="gap-2">
                <PenTool className="w-5 h-5" />
                <span>Begin Writing Trial</span>
              </ImperialButton>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ─── Task 1 or Task 2 (Writing Interface) ────────────────

  if ((phase === 'task1' || phase === 'task2') && (task1Prompt || task2Prompt)) {
    const isTask1 = phase === 'task1';
    const prompt = isTask1 ? task1Prompt! : task2Prompt!;
    const text = isTask1 ? task1Text : task2Text;
    const setText = isTask1 ? setTask1Text : setTask2Text;
    const handleSubmit = isTask1 ? handleSubmitTask1 : handleSubmitTask2;
    const wordCount = countWords(text);
    const isTimeWarning = timeLeft <= 120 && timeLeft > 0;
    const isTimeExpired = timeLeft === 0;
    const meetsMinimum = wordCount >= prompt.minWords;

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-6 relative z-10">
          <div className="max-w-6xl mx-auto px-4 sm:px-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <span className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm font-bold">
                  {isTask1 ? 'Task 1: Integrated Summary' : 'Task 2: Independent Essay'}
                </span>
                <span className="px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-heading)] tracking-wider uppercase border border-[rgba(201,168,76,0.3)] text-[#8b7355]">
                  {isTask1 ? '1 of 2' : '2 of 2'}
                </span>
              </div>
              {/* Timer */}
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md border ${
                isTimeExpired ? 'border-[rgba(231,76,60,0.5)] bg-[rgba(231,76,60,0.1)]'
                : isTimeWarning ? 'border-[rgba(255,107,53,0.4)] bg-[rgba(255,107,53,0.05)]'
                : 'border-[rgba(201,168,76,0.2)] bg-[rgba(201,168,76,0.03)]'
              }`}>
                <Clock className={`w-4 h-4 ${isTimeExpired ? 'text-[#e74c3c]' : isTimeWarning ? 'text-[#ff6b35]' : 'text-[#c9a84c]'}`} />
                <span className={`font-[family-name:var(--font-heading)] text-sm tabular-nums ${
                  isTimeExpired ? 'text-[#e74c3c]' : isTimeWarning ? 'text-[#ff6b35]' : 'text-[#c9a84c]'
                }`}>
                  {isTimeExpired ? 'TIME UP' : formatTime(timeLeft)}
                </span>
              </div>
            </div>

            <ProgressBar value={isTask1 ? 1 : 2} max={2} showPercentage={false} color="#c9a84c" size="sm" />

            {/* Content */}
            <div className={`grid grid-cols-1 ${isTask1 && prompt.passage ? 'lg:grid-cols-2' : ''} gap-6 mt-6`}>
              {/* Source Passage (Task 1 only) */}
              {isTask1 && prompt.passage && (
                <div>
                  <MetallicCard className="p-5 max-h-[60vh] overflow-y-auto" hover={false}>
                    <div className="flex items-center gap-2 mb-3">
                      <BookOpen className="w-4 h-4 text-[#c9a84c]" />
                      <span className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm">{prompt.passageTitle}</span>
                    </div>
                    <p className="text-[#c0c0c0] text-sm leading-relaxed">{prompt.passage}</p>
                  </MetallicCard>
                </div>
              )}

              {/* Writing Area */}
              <div>
                <MetallicCard className="p-5" hover={false}>
                  <p className="text-[#e8e8e8] text-sm mb-4 leading-relaxed font-[family-name:var(--font-sans)]">
                    {prompt.prompt}
                  </p>
                  <textarea
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="Start writing here..."
                    className="w-full h-64 sm:h-80 p-4 rounded-lg bg-[#0a0a0a] border border-[rgba(201,168,76,0.2)] text-[#e8e8e8] text-sm leading-relaxed font-[family-name:var(--font-sans)] resize-none focus:outline-none focus:border-[rgba(201,168,76,0.5)] transition-colors placeholder:text-[#555]"
                    disabled={isTimeExpired}
                  />
                  {/* Word count + Submit */}
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-3">
                      <span className={`font-[family-name:var(--font-heading)] text-sm ${
                        meetsMinimum ? 'text-[#4ade80]' : 'text-[#8b7355]'
                      }`}>
                        {wordCount} words
                      </span>
                      <span className="text-[#8b7355] text-xs">
                        (min: {prompt.minWords})
                      </span>
                      {!meetsMinimum && wordCount > 0 && (
                        <span className="flex items-center gap-1 text-[#ff6b35] text-xs">
                          <AlertCircle className="w-3 h-3" />
                          {prompt.minWords - wordCount} more needed
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {/* Skip / I Can't Write This button */}
                      <button
                        type="button"
                        onClick={handleSubmit}
                        className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgba(139,115,85,0.3)] hover:border-[rgba(139,115,85,0.5)] transition-all"
                      >
                        <ChevronRight className="w-4 h-4 text-[#8b7355] group-hover:text-[#c9a84c]" />
                        <span className="font-[family-name:var(--font-heading)] text-xs text-[#8b7355] group-hover:text-[#c9a84c]">Skip Task</span>
                        <span className="font-arabic text-[10px] text-[#8b7355]" dir="rtl">تخطي</span>
                      </button>
                      <ImperialButton
                        variant="primary"
                        size="md"
                        onClick={handleSubmit}
                        disabled={wordCount < 20}
                        className="gap-2"
                      >
                        <span>{isTask1 ? 'Submit & Continue' : 'Submit Essay'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </ImperialButton>
                    </div>
                  </div>
                </MetallicCard>
              </div>
            </div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ─── Evaluating Screen ───────────────────────────────────

  if (phase === 'evaluating') {
    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 flex items-center justify-center relative z-10">
          <motion.div className="text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <motion.div className="text-5xl mb-6" animate={{ scale: [1, 1.1, 1] }} transition={{ duration: 2, repeat: Infinity }}>✍️</motion.div>
            <h2 className="font-[family-name:var(--font-heading)] text-2xl text-[#c9a84c] mb-3">Evaluating Your Writing</h2>
            <p className="text-[#8b7355] text-sm mb-2">AI is analyzing grammar, coherence, vocabulary, and development...</p>
            <p className="font-arabic text-[#8b7355] text-xs" dir="rtl">الذكاء الاصطناعي يحلل كتابتك...</p>
            <div className="mt-6 w-48 mx-auto h-1 bg-[rgba(201,168,76,0.2)] rounded-full overflow-hidden">
              <motion.div className="h-full bg-[#c9a84c] rounded-full" animate={{ x: ['-100%', '100%'] }} transition={{ duration: 1.5, repeat: Infinity }} style={{ width: '40%' }} />
            </div>
          </motion.div>
        </main>
        <Footer />
      </div>
    );
  }

  // ─── Results Screen ──────────────────────────────────────

  if (phase === 'results' && task1Score && task2Score) {
    const finalScore = Math.round((task1Score.overall + task2Score.overall) / 2);
    const scaledScore = Math.round((finalScore / 25) * 30); // Scale to 0-30

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <motion.div className="text-center mb-8" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-5xl mb-4">✍️</div>
              <h1 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl font-bold text-[#c9a84c] mb-2">Writing Trial Complete</h1>
              <p className="font-[family-name:var(--font-heading)] text-[#8b7355]">The Inscription Trial has been conquered</p>
            </motion.div>

            {/* Overall Score */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <GlowingBorder color="gold" intensity="high">
                <MetallicCard className="p-6 sm:p-8 text-center" hover={false}>
                  <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs uppercase tracking-widest mb-2">Writing Score</p>
                  <p className="font-[family-name:var(--font-heading)] text-5xl font-bold text-[#c9a84c]">{scaledScore}</p>
                  <p className="text-[#8b7355] text-xs mt-1">out of 30</p>
                </MetallicCard>
              </GlowingBorder>
            </motion.div>

            <SectionDivider />

            {/* Task Breakdown */}
            {[{ label: 'Task 1: Integrated Summary', score: task1Score, words: countWords(task1Text) },
              { label: 'Task 2: Independent Essay', score: task2Score, words: countWords(task2Text) }].map((task, idx) => (
              <motion.div key={idx} className="mb-4" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 + idx * 0.2 }}>
                <MetallicCard className="p-5" hover={false}>
                  <h3 className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm mb-3">{task.label}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                    {[{ label: 'Grammar', value: task.score.grammar },
                      { label: 'Coherence', value: task.score.coherence },
                      { label: 'Vocabulary', value: task.score.vocabulary },
                      { label: 'Development', value: task.score.development }].map((metric, i) => (
                      <div key={i} className="text-center">
                        <p className="text-[#8b7355] text-[10px] uppercase tracking-widest">{metric.label}</p>
                        <p className="font-[family-name:var(--font-heading)] text-lg text-[#c9a84c] font-bold">{metric.value}</p>
                      </div>
                    ))}
                  </div>
                  <p className="text-[#8b7355] text-xs">{task.words} words written</p>
                  <p className="text-[#c0c0c0] text-xs mt-2 italic">{task.score.feedback}</p>
                </MetallicCard>
              </motion.div>
            ))}

            {/* Actions */}
            <motion.div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }}>
              <Link href="/assessment">
                <ImperialButton variant="primary" size="lg" className="gap-2">
                  <span>Continue to Next Trial</span>
                  <ChevronRight className="w-5 h-5" />
                </ImperialButton>
              </Link>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return null;
}

