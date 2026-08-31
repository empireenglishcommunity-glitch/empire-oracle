'use client';

import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { ChevronRight, Headphones, ArrowRight, CheckCircle2, XCircle } from 'lucide-react';
import {
  ParticleBackground,
  Navbar,
  Footer,
  MetallicCard,
  ImperialButton,
  GlowingBorder,
  ProgressBar,
  SectionDivider,
  ListeningAudioPlayer,
} from '@/components/empire';
import { getListeningSet, type ListeningPassage } from '@/data/listening-passages';
import { shuffleOptions } from '@/lib/shuffle-options';

// ─── Types ─────────────────────────────────────────────────

type Phase = 'intro' | 'listening' | 'questions' | 'results';

interface AnswerRecord {
  questionId: string;
  selectedAnswer: number;
  isCorrect: boolean;
}

// ─── Component ─────────────────────────────────────────────

export default function ListeningAssessmentPage() {
  const [phase, setPhase] = useState<Phase>('intro');
  const [passages, setPassages] = useState<ListeningPassage[]>([]);
  const [currentPassageIndex, setCurrentPassageIndex] = useState(0);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [isAnswered, setIsAnswered] = useState(false);
  const [score, setScore] = useState(0);

  // Audio state
  const [hasPlayedOnce, setHasPlayedOnce] = useState(false);

  // ─── Submit Score to API (called directly, not via useEffect) ─────
  const submitTrialScore = useCallback(async (finalAnswers: AnswerRecord[]) => {
    try {
      const sessionResp = await fetch('/api/auth/session', { credentials: 'include' });
      const sessionData = await sessionResp.json();
      const uid = sessionData?.user?.id || sessionData?.user?.email;
      if (!uid) { console.error('[Listening] No user in session, cannot save score'); return; }
      const totalCorrect = finalAnswers.filter(a => a.isCorrect).length;
      const totalQ = passages.reduce((sum, p) => sum + p.questions.length, 0) || 15;
      const calculatedScore = Math.round((totalCorrect / totalQ) * 30);
      console.log('[Listening] Submitting score:', calculatedScore, 'uid:', uid);
      await fetch('/api/assessment/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          module: 'listening',
          userId: uid,
          answers: finalAnswers.map(a => ({
            questionId: a.questionId,
            selectedAnswer: a.selectedAnswer,
            isCorrect: a.isCorrect,
            // 0 → the server records no timing for this answer.
            //
            // This was hardcoded to 5000, meaning every listening answer
            // reported exactly 5.0 seconds. That is not "no data", it is
            // fabricated data, and it was fed straight into the response-time
            // integrity analysis — which then drew conclusions from a constant.
            // A check that is quietly reasoning about fiction is worse than one
            // that is switched off, so until this page measures real elapsed
            // time per question, it reports none.
            timeTaken: 0,
          })),
          scores: {
            overall: calculatedScore,
            level: calculatedScore >= 24 ? 3 : calculatedScore >= 16 ? 2 : calculatedScore >= 8 ? 1 : 0,
          },
        }),
      });
      console.log('[Listening] Score saved successfully');
    } catch (e) { console.error('[Listening] Submit failed:', e); }
  }, [passages]);

  // ─── Start Trial ─────────────────────────────────────────

  const handleStart = useCallback(() => {
    const set = getListeningSet();
    setPassages(set);
    setCurrentPassageIndex(0);
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setSelectedOption(null);
    setIsAnswered(false);
    setHasPlayedOnce(false);
    setPhase('listening');
  }, []);

  // ─── Move to Questions After Listening ───────────────────

  const handleProceedToQuestions = () => {
    setPhase('questions');
  };

  // ─── Audio Callbacks ─────────────────────────────────────

  const handlePlaybackComplete = useCallback(() => {
    setHasPlayedOnce(true);
  }, []);

  // ─── Skip Question ───────────────────────────────────────

  const skipInProgress = useRef(false);
  
  const handleSkip = () => {
    if (isAnswered || skipInProgress.current) return;
    if (!passages[currentPassageIndex]?.questions[currentQuestionIndex]) return;
    skipInProgress.current = true;
    
    const passage = passages[currentPassageIndex];
    const question = passage.questions[currentQuestionIndex];
    const newAnswers = [...answers, { questionId: question.id, selectedAnswer: -1, isCorrect: false }];
    setAnswers(newAnswers);
    
    const isLastQuestionInPassage = currentQuestionIndex + 1 >= passage.questions.length;
    const isLastPassage = currentPassageIndex + 1 >= passages.length;
    
    if (!isLastQuestionInPassage) {
      // More questions in this passage
      setCurrentQuestionIndex(currentQuestionIndex + 1);
      setSelectedOption(null);
    } else if (!isLastPassage) {
      // Move to next passage
      setCurrentPassageIndex(currentPassageIndex + 1);
      setCurrentQuestionIndex(0);
      setHasPlayedOnce(false);
      setSelectedOption(null);
      setPhase('listening');
    } else {
      // All done — show results and save
      const totalCorrect = newAnswers.filter(a => a.isCorrect).length;
      const totalQ = passages.reduce((sum, p) => sum + p.questions.length, 0);
      setScore(Math.round((totalCorrect / totalQ) * 30));
      setPhase('results');
      submitTrialScore(newAnswers);
    }
    
    skipInProgress.current = false;
  };

  // ─── Next Question ───────────────────────────────────────

  const advanceQuestion = useCallback(() => {
    const passage = passages[currentPassageIndex];
    if (currentQuestionIndex + 1 < passage.questions.length) {
      setCurrentQuestionIndex(prev => prev + 1);
    } else if (currentPassageIndex + 1 < passages.length) {
      setCurrentPassageIndex(prev => prev + 1);
      setCurrentQuestionIndex(0);
      setHasPlayedOnce(false);
      setPhase('listening');
    } else {
      // All done — submit score directly with current answers
      const allAnswers = [...answers];
      const totalCorrect = allAnswers.filter(a => a.isCorrect).length;
      const totalQ = passages.reduce((sum, p) => sum + p.questions.length, 0);
      setScore(Math.round((totalCorrect / totalQ) * 30));
      setPhase('results');
      submitTrialScore(allAnswers); // Direct call
      return;
    }
    setSelectedOption(null);
    setIsAnswered(false);
  }, [passages, currentPassageIndex, currentQuestionIndex, answers, submitTrialScore]);

  const handleNext = () => advanceQuestion();

  // ─── Current State ───────────────────────────────────────

  const currentPassage = passages[currentPassageIndex];
  const currentQuestion = currentPassage?.questions[currentQuestionIndex];
  const totalQuestions = passages.reduce((sum, p) => sum + p.questions.length, 0);
  const answeredSoFar = answers.length;

  // Shuffle options to prevent answer position bias (Bug 2 fix)
  const shuffled = useMemo(() => {
    const cq = passages[currentPassageIndex]?.questions[currentQuestionIndex];
    if (!cq) return { shuffledOptions: [] as string[], newCorrectIndex: 0 };
    const seed = cq.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    return shuffleOptions(cq.options, cq.correctAnswer, seed);
  }, [passages, currentPassageIndex, currentQuestionIndex]);

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
              <div className="text-6xl mb-6">👂</div>
              <h1 className="font-[family-name:var(--font-heading)] text-4xl sm:text-5xl font-bold text-[#c9a84c] mb-2">Trial of Listening</h1>
              <p className="font-arabic text-[#8b7355] text-base mb-3" dir="rtl">اختبار الاستماع والفهم</p>
              <p className="font-[family-name:var(--font-heading)] text-[#cd7f32] text-lg tracking-widest uppercase">The Perception Trial</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <GlowingBorder color="gold" intensity="medium">
                <MetallicCard className="p-6 sm:p-8 text-center" hover={false}>
                  <p className="text-[#c0c0c0] text-base leading-relaxed mb-4">
                    You will listen to 3 audio passages — academic lectures and campus conversations.
                    After each passage, answer 5 comprehension questions. You may replay each passage
                    up to 2 times. Questions test main idea, details, inference, speaker attitude, and purpose.
                  </p>
                  <p className="font-arabic text-[#8b7355] text-sm leading-relaxed" dir="rtl">
                    ستستمع إلى 3 مقاطع صوتية — محاضرات أكاديمية ومحادثات جامعية. بعد كل مقطع، أجب عن 5 أسئلة فهم. يمكنك إعادة تشغيل كل مقطع مرتين.
                  </p>
                </MetallicCard>
              </GlowingBorder>
            </motion.div>
            <SectionDivider />
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
              <MetallicCard className="p-5" hover={false}>
                <h3 className="font-[family-name:var(--font-heading)] text-[#c9a84c] text-sm uppercase tracking-widest mb-4 text-center">Assessment Rules</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="flex items-start gap-2"><span className="text-[#4ade80] mt-0.5">✓</span><span className="text-[#c0c0c0]">Listen carefully — you can replay up to 2 times</span></div>
                  <div className="flex items-start gap-2"><span className="text-[#4ade80] mt-0.5">✓</span><span className="text-[#c0c0c0]">Take notes while listening if needed</span></div>
                  <div className="flex items-start gap-2"><span className="text-[#e74c3c] mt-0.5">✗</span><span className="text-[#c0c0c0]">Do not read the transcript during questions</span></div>
                  <div className="flex items-start gap-2"><span className="text-[#4ade80] mt-0.5">✓</span><span className="text-[#c0c0c0]">Use headphones for best audio quality</span></div>
                </div>
                <div className="mt-4 pt-3 border-t border-[rgba(201,168,76,0.1)] text-center">
                  <span className="text-[#8b7355] text-xs">3 Passages &middot; 15 Questions &middot; ~15 minutes &middot; Score: 0-30</span>
                </div>
              </MetallicCard>
            </motion.div>
            <motion.div className="text-center mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}>
              <ImperialButton variant="primary" size="lg" onClick={() => { handleStart(); }} className="gap-2">
                <Headphones className="w-5 h-5" />
                <span>Begin Listening Trial</span>
              </ImperialButton>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ─── Listening Phase (play audio before questions) ────────

  if (phase === 'listening' && currentPassage) {
    const diffColors = { easy: '#4ade80', medium: '#c9a84c', hard: '#ff6b35' };
    const diffLabels = { easy: 'Passage 1 — Foundation', medium: 'Passage 2 — Academic', hard: 'Passage 3 — Advanced' };

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
              {/* Header */}
              <div className="text-center mb-8">
                <span className="font-[family-name:var(--font-heading)] text-sm font-bold" style={{ color: diffColors[currentPassage.difficulty] }}>
                  {diffLabels[currentPassage.difficulty]}
                </span>
                <h2 className="font-[family-name:var(--font-heading)] text-2xl text-[#c9a84c] mt-2">{currentPassage.title}</h2>
                <p className="text-[#8b7355] text-xs mt-1 capitalize">{currentPassage.format} &middot; {currentPassage.topic}</p>
              </div>

              {/* Audio Player */}
              <GlowingBorder color="gold" intensity="medium">
                <MetallicCard className="p-8 sm:p-12" hover={false}>
                  <ListeningAudioPlayer
                    key={currentPassage.id}
                    passageId={currentPassage.id}
                    transcript={currentPassage.transcript}
                    wpm={currentPassage.wpm}
                    maxReplays={2}
                    onPlaybackComplete={handlePlaybackComplete}
                  />

                  {/* Proceed Button (appears after first play) */}
                  {hasPlayedOnce && (
                    <motion.div className="mt-8 text-center" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                      <ImperialButton variant="primary" size="md" onClick={handleProceedToQuestions} className="gap-2">
                        <span>Proceed to Questions</span>
                        <ArrowRight className="w-4 h-4" />
                      </ImperialButton>
                    </motion.div>
                  )}
                  {/* Skip button — always visible so student is never stuck */}
                  {!hasPlayedOnce && (
                    <motion.div className="mt-6 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 5 }}>
                      <button onClick={() => { setHasPlayedOnce(true); }} className="text-[#8b7355] text-xs hover:text-[#c9a84c] transition-colors underline">
                        Skip audio / تخطي الصوت
                      </button>
                    </motion.div>
                  )}
                </MetallicCard>
              </GlowingBorder>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }


  // ─── Questions Phase ─────────────────────────────────────

  if (phase === 'questions' && currentPassage && currentQuestion) {
    const diffColors = { easy: '#4ade80', medium: '#c9a84c', hard: '#ff6b35' };

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            {/* Progress */}
            <div className="flex items-center justify-between mb-2">
              <span className="font-[family-name:var(--font-heading)] text-sm text-[#c9a84c]">{currentPassage.title}</span>
              <span className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs">{answeredSoFar + 1}/{totalQuestions}</span>
            </div>
            <ProgressBar value={answeredSoFar + 1} max={totalQuestions} showPercentage={false} color={diffColors[currentPassage.difficulty]} size="sm" />

            {/* Question */}
            <AnimatePresence mode="wait">
              <motion.div key={currentQuestion.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mt-6">
                <GlowingBorder color="gold" intensity="low">
                  <MetallicCard className="p-5 sm:p-6" hover={false}>
                    <div className="flex items-center gap-2 mb-4">
                      <span className="px-2 py-0.5 rounded text-[10px] font-[family-name:var(--font-heading)] tracking-wider uppercase border border-[rgba(201,168,76,0.3)] text-[#c9a84c] bg-[rgba(201,168,76,0.05)]">
                        {currentQuestion.type.replace('_', ' ')}
                      </span>
                      <span className="text-[#8b7355] text-xs">Q{currentQuestionIndex + 1} of {currentPassage.questions.length}</span>
                    </div>
                    <h4 className="text-[#e8e8e8] text-base sm:text-lg leading-relaxed mb-6">{currentQuestion.questionText}</h4>
                    <div className="space-y-3">
                      {shuffled.shuffledOptions.map((option, idx) => {
                        const isSelected = selectedOption === idx;
                        const isCorrect = isAnswered && idx === shuffled.newCorrectIndex;
                        const isWrong = isAnswered && isSelected && idx !== shuffled.newCorrectIndex;
                        return (
                          <button key={idx} type="button" onClick={() => handleSelectOption(idx)} disabled={isAnswered}
                            className={`w-full text-left rounded-lg border p-4 transition-all duration-200 ${
                              isCorrect ? 'border-[#4ade80] bg-[rgba(74,222,128,0.08)]'
                              : isWrong ? 'border-[#e74c3c] bg-[rgba(231,76,60,0.08)]'
                              : isSelected ? 'border-[#c9a84c] bg-[rgba(201,168,76,0.08)]'
                              : 'border-[rgba(201,168,76,0.15)] bg-[#111118] hover:border-[rgba(201,168,76,0.35)]'
                            }`}>
                            <div className="flex items-center gap-3">
                              <div className={`w-7 h-7 rounded-full border flex items-center justify-center text-xs font-bold ${
                                isCorrect ? 'border-[#4ade80] text-[#4ade80]'
                                : isWrong ? 'border-[#e74c3c] text-[#e74c3c]'
                                : isSelected ? 'border-[#c9a84c] text-[#c9a84c]'
                                : 'border-[rgba(201,168,76,0.25)] text-[#8b7355]'
                              }`}>{String.fromCharCode(65 + idx)}</div>
                              <span className={`text-sm ${isCorrect ? 'text-[#4ade80]' : isWrong ? 'text-[#e74c3c]' : isSelected ? 'text-[#e8d48b]' : 'text-[#c0c0c0]'}`}>{option}</span>
                              {isCorrect && <CheckCircle2 className="w-4 h-4 text-[#4ade80] ml-auto" />}
                              {isWrong && <XCircle className="w-4 h-4 text-[#e74c3c] ml-auto" />}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex flex-col items-center gap-3 mt-6">
                      {isAnswered ? (
                        <ImperialButton variant="primary" size="md" onClick={handleNext} className="gap-2 w-full sm:w-auto">
                          <span>Next Question</span><ArrowRight className="w-4 h-4" />
                        </ImperialButton>
                      ) : (
                        <button type="button" onClick={handleSkip} className="group flex items-center gap-2 px-4 py-2 rounded-lg border border-[rgba(139,115,85,0.3)] hover:border-[rgba(139,115,85,0.5)] transition-all">
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
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // ─── Results Screen ──────────────────────────────────────

  if (phase === 'results') {
    const totalCorrect = answers.filter(a => a.isCorrect).length;
    const totalSkipped = answers.filter(a => a.selectedAnswer === -1).length;
    const totalQ = passages.reduce((sum, p) => sum + p.questions.length, 0) || 15;
    const displayScore = Math.round((totalCorrect / totalQ) * 30);
    const accuracy = answers.filter(a => a.selectedAnswer !== -1).length > 0
      ? Math.round((totalCorrect / answers.filter(a => a.selectedAnswer !== -1).length) * 100) : 0;

    return (
      <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
        <ParticleBackground />
        <Navbar />
        <main className="flex-1 pt-20 pb-12 relative z-10">
          <div className="max-w-3xl mx-auto px-4 sm:px-6">
            <motion.div className="text-center mb-8" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}>
              <div className="text-5xl mb-4">👂</div>
              <h1 className="font-[family-name:var(--font-heading)] text-3xl sm:text-4xl font-bold text-[#c9a84c] mb-2">Listening Trial Complete</h1>
              <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-base">The Perception Trial has been conquered</p>
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
              <GlowingBorder color="gold" intensity="high">
                <MetallicCard className="p-6 sm:p-8" hover={false}>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-center">
                    <div>
                      <p className="font-[family-name:var(--font-heading)] text-[#8b7355] text-xs uppercase tracking-widest mb-2">Listening Score</p>
                      <p className="font-[family-name:var(--font-heading)] text-4xl font-bold text-[#c9a84c]">{displayScore}</p>
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
            <motion.div className="flex flex-col sm:flex-row items-center justify-center gap-4 mt-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
              <Link href="/assessment">
                <ImperialButton variant="primary" size="lg" className="gap-2">
                  <span>Continue to Next Trial</span><ChevronRight className="w-5 h-5" />
                </ImperialButton>
              </Link>
              <ImperialButton variant="outline" size="lg" onClick={handleStart} className="gap-2">
                <span>Retake Listening</span>
              </ImperialButton>
            </motion.div>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  // Fallback — should never reach here, but prevents blank page
  return (
    <div className="min-h-screen flex flex-col bg-[#0a0a0a]">
      <ParticleBackground />
      <Navbar />
      <main className="flex-1 flex items-center justify-center relative z-10">
        <div className="text-center">
          <p className="text-[#c9a84c] text-lg mb-4">Loading...</p>
          <ImperialButton variant="primary" onClick={handleStart}>Restart Trial</ImperialButton>
        </div>
      </main>
      <Footer />
    </div>
  );
}
