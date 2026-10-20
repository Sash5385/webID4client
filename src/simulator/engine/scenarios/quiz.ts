import type { QuizScenario } from '../quiz'

// УВАГА: це ЗРАЗКОВІ сценарії для перевірки рушія. 20 сценаріїв із квізу v2 ще не перенесено
// (потрібен файл v2). Номери пунктів ПДР не підтверджені: clause — СВЕРИТИ.
export const QUIZ_SCENARIOS: QuizScenario[] = [
  {
    id: 'eq-3', theme: 'Рівнозначні дороги', level: 1, road: 'equal', signs: [],
    cars: [
      { id: 'a', from: 'S', move: 'straight', you: true },
      { id: 'b', from: 'E', move: 'straight' },
      { id: 'c', from: 'W', move: 'straight' },
    ],
    correctOrder: ['b', 'a', 'c'],
    clause: 'СВЕРИТИ: правило «перешкода справа»',
    why: 'На рівнозначному перехресті поступаються транспорту, що наближається справа: E — без перешкоди справа, S поступається E, W поступається S.',
  },
  {
    id: 'eq-left', theme: 'Лівий поворот', level: 1, road: 'equal', signs: [],
    cars: [
      { id: 'a', from: 'S', move: 'left', you: true },
      { id: 'b', from: 'N', move: 'straight' },
    ],
    correctOrder: ['b', 'a'],
    clause: 'СВЕРИТИ: поворот ліворуч поступається зустрічному',
    why: 'Водій, що повертає ліворуч, поступається транспорту, який їде прямо назустріч.',
  },
  {
    id: 'main-sec', theme: 'Головна й другорядна', level: 1, road: 'main-secondary',
    signs: [{ approach: 'S', sign: 'main' }, { approach: 'N', sign: 'main' }, { approach: 'W', sign: 'yield' }, { approach: 'E', sign: 'yield' }],
    cars: [
      { id: 'a', from: 'W', move: 'straight', you: true },
      { id: 'b', from: 'S', move: 'straight' },
    ],
    correctOrder: ['b', 'a'],
    clause: 'СВЕРИТИ: знак «Дати дорогу»',
    why: 'Водій на другорядній дорозі поступається транспорту на головній.',
  },
  {
    id: 'main-left', theme: 'Головна й другорядна', level: 2, road: 'main-secondary',
    signs: [{ approach: 'S', sign: 'main' }, { approach: 'N', sign: 'main' }, { approach: 'W', sign: 'yield' }],
    cars: [
      { id: 'a', from: 'S', move: 'left', you: true },
      { id: 'b', from: 'N', move: 'straight' },
      { id: 'c', from: 'W', move: 'right' },
    ],
    correctOrder: ['b', 'a', 'c'],
    clause: 'СВЕРИТИ',
    why: 'На головній дорозі лівий поворот поступається зустрічному прямо; транспорт з другорядної — останнім.',
  },
]
