import { vi, describe, it, expect, beforeEach } from 'vitest';
import { QuizzesService } from './quizzes.service';
import { BadRequestException } from '@nestjs/common';
import { QuestionType } from './quiz-question.entity';

describe('QuizzesService', () => {
  let service: QuizzesService;
  let quizRepo: any;
  let questionRepo: any;
  let attemptRepo: any;
  let attemptAnswerRepo: any;
  let answerRepo: any;
  let streaksService: any;

  function makeAnswer(overrides = {}) {
    return { id: 'ans-1', text: 'Paris', isCorrect: true, explanation: 'Capital of France.', order: 0, ...overrides };
  }

  function makeQuestion(overrides: any = {}) {
    return {
      id: 'q-1', quizId: 'quiz-1', text: 'Capital?', type: QuestionType.MCQ,
      points: 10, order: 0,
      answers: [
        makeAnswer({ id: 'ans-1', text: 'Paris', isCorrect: true, explanation: 'Capital of France.' }),
        makeAnswer({ id: 'ans-2', text: 'London', isCorrect: false, explanation: null }),
      ],
      ...overrides,
    };
  }

  beforeEach(() => {
    attemptRepo = {
      findOne: vi.fn().mockResolvedValue(null),
      create: vi.fn((x) => x),
      save: vi.fn((x) => Promise.resolve({ id: 'attempt-1', ...x })),
    };
    attemptAnswerRepo = {
      create: vi.fn((x) => x),
      save: vi.fn((x) => Promise.resolve(x)),
    };
    quizRepo = {
      create: vi.fn((x) => x),
      save: vi.fn((x) => Promise.resolve(x)),
      findOne: vi.fn().mockResolvedValue({
        id: 'quiz-1',
        questions: [makeQuestion()],
      }),
    };
    questionRepo = { create: vi.fn(), save: vi.fn() };
    answerRepo = { create: vi.fn(), save: vi.fn() };
    streaksService = { recordActivity: vi.fn().mockResolvedValue(undefined) };

    service = new QuizzesService(
      quizRepo, questionRepo, attemptRepo, attemptAnswerRepo, answerRepo, streaksService,
    );
  });

  describe('submitAttempt', () => {
    it('all-correct: score 100 and every gradedAnswer.isCorrect is true', async () => {
      const result = await service.submitAttempt('quiz-1', 'user-1', [
        { questionId: 'q-1', answer: 'Paris' },
      ]);
      expect(result.score).toBe(100);
      expect(result.gradedAnswers[0].isCorrect).toBe(true);
    });

    it('all-wrong: score 0 and every gradedAnswer.isCorrect is false', async () => {
      const result = await service.submitAttempt('quiz-1', 'user-1', [
        { questionId: 'q-1', answer: 'London' },
      ]);
      expect(result.score).toBe(0);
      expect(result.gradedAnswers[0].isCorrect).toBeFalsy();
    });

    it('partial: score 50 when 1 of 2 questions correct', async () => {
      quizRepo.findOne.mockResolvedValue({
        id: 'quiz-1',
        questions: [
          makeQuestion({ id: 'q-1', points: 10 }),
          makeQuestion({ id: 'q-2', points: 10, answers: [
            makeAnswer({ id: 'ans-3', text: 'Berlin', isCorrect: true, explanation: null }),
            makeAnswer({ id: 'ans-4', text: 'Madrid', isCorrect: false, explanation: null }),
          ]}),
        ],
      });
      const result = await service.submitAttempt('quiz-1', 'user-1', [
        { questionId: 'q-1', answer: 'Paris' },
        { questionId: 'q-2', answer: 'Madrid' },
      ]);
      expect(result.score).toBe(50);
    });

    it('includes explanation in gradedAnswers', async () => {
      const result = await service.submitAttempt('quiz-1', 'user-1', [
        { questionId: 'q-1', answer: 'Paris' },
      ]);
      expect(result.gradedAnswers[0].explanation).toBe('Capital of France.');
    });

    it('throws BadRequestException when quiz already submitted', async () => {
      attemptRepo.findOne.mockResolvedValue({ id: 'existing' });
      await expect(
        service.submitAttempt('quiz-1', 'user-1', [])
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getQuiz', () => {
    it('does not expose isCorrect or explanation on answer options', async () => {
      const quiz = await service.getQuiz('quiz-1');
      for (const q of quiz.questions) {
        for (const a of q.answers) {
          expect(a).not.toHaveProperty('isCorrect');
          expect(a).not.toHaveProperty('explanation');
        }
      }
    });
  });
});
