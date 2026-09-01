/**
 * The activity.
 *
 * A slope-intercept matching task: the student adjusts m and b until their line
 * passes through the given points. It is deliberately the shape of thing that
 * is hard to make accessible, because that is the part worth proving.
 *
 * Four requirements, and every one is implemented rather than gestured at:
 *
 *   1. A keyboard path that reaches every state the mouse can, including a
 *      documented large step, because moving a range of -10..10 in 0.1
 *      increments one arrow press at a time is not a usable interaction.
 *   2. An announced state, through a live region carrying meaning rather than
 *      a number: "slope 2, y-intercept negative 1, passes through 2 of 3".
 *   3. A non-visual equivalent of the graph. A data table with the same
 *      information, not alt="chart".
 *   4. A second channel for anything colour encodes, so the matched points are
 *      distinguishable without seeing the green.
 */

export interface Challenge {
  id: string;
  prompt: string;
  /** Points the student's line must pass through. */
  points: { x: number; y: number }[];
  answer: { m: number; b: number };
  /** MathML so a screen reader reads the equation instead of skipping it. */
  equationMathml: string;
}

const line = (label: string) =>
  `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">
     <mi>y</mi><mo>=</mo><mi>m</mi><mo>&#8290;</mo><mi>x</mi><mo>+</mo><mi>b</mi>
     <mtext>&#160;(${label})</mtext>
   </math>`;

export const CHALLENGES: Challenge[] = [
  {
    id: "c1",
    prompt: "Find the line through (0, 1) and (2, 5).",
    points: [{ x: 0, y: 1 }, { x: 2, y: 5 }, { x: 4, y: 9 }],
    answer: { m: 2, b: 1 },
    equationMathml: line("slope-intercept form"),
  },
  {
    id: "c2",
    prompt: "Find the line through (-2, 4) and (2, -4).",
    points: [{ x: -2, y: 4 }, { x: 0, y: 0 }, { x: 2, y: -4 }],
    answer: { m: -2, b: 0 },
    equationMathml: line("slope-intercept form"),
  },
  {
    id: "c3",
    prompt: "Find the line through (-4, -1) and (4, 3).",
    points: [{ x: -4, y: -1 }, { x: 0, y: 1 }, { x: 4, y: 3 }],
    answer: { m: 0.5, b: 1 },
    equationMathml: line("slope-intercept form"),
  },
];

export const TOLERANCE = 0.05;
export const MAX_SCORE = CHALLENGES.length;

export function pointsMatched(challenge: Challenge, m: number, b: number): number {
  return challenge.points.filter(
    (point) => Math.abs(m * point.x + b - point.y) <= TOLERANCE,
  ).length;
}

export function isSolved(challenge: Challenge, m: number, b: number): boolean {
  return pointsMatched(challenge, m, b) === challenge.points.length;
}

/** Server-side scoring. The client is never trusted with the grade. */
export function scoreSubmission(
  answers: { challengeId: string; m: number; b: number }[],
): { score: number; detail: { challengeId: string; solved: boolean; matched: number }[] } {
  const detail = CHALLENGES.map((challenge) => {
    const answer = answers.find((a) => a.challengeId === challenge.id);
    if (!answer) return { challengeId: challenge.id, solved: false, matched: 0 };
    return {
      challengeId: challenge.id,
      solved: isSolved(challenge, answer.m, answer.b),
      matched: pointsMatched(challenge, answer.m, answer.b),
    };
  });
  return { score: detail.filter((d) => d.solved).length, detail };
}
