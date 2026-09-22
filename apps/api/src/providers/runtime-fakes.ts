import { FakeJev } from "./fake-jev";
import { FakeLlm } from "./fake-llm";

export const runtimeJevPayload = {
  model: "jev-1.13.0",
  answers: {
    go: {
      type: "choice",
      choice: "match",
      confidence: 0.9,
      probabilities: { match: 0.7, mismatch: 0.1, no_evidence: 0.1, contradictory: 0.1 },
    },
    distributed: {
      type: "choice",
      choice: "match",
      confidence: 0.85,
      probabilities: { match: 0.7, mismatch: 0.1, no_evidence: 0.1, contradictory: 0.1 },
    },
    "no-ownership": {
      type: "choice",
      choice: "mismatch",
      confidence: 0.8,
      probabilities: { match: 0.1, mismatch: 0.7, no_evidence: 0.1, contradictory: 0.1 },
    },
    seniority: {
      type: "score",
      score: 1.15,
      confidence: 0.8,
      probabilities: { "0": 0.05, "1": 0.8, "2": 0.1, "3": 0.05 },
    },
  },
  usage: { input_tokens: 2180, output_tokens: 36 },
};

function answersFor(questions: Record<string, { type?: string }>) {
  const answers: Record<string, (typeof runtimeJevPayload.answers)[keyof typeof runtimeJevPayload.answers]> = {};
  for (const [id, question] of Object.entries(questions)) {
    const known = runtimeJevPayload.answers[id as keyof typeof runtimeJevPayload.answers];
    answers[id] = known ?? (question.type === "score" ? runtimeJevPayload.answers.seniority : runtimeJevPayload.answers.go);
  }
  return answers;
}

export function createRuntimeProviders() {
  return {
    jev: new FakeJev((input) => ({
      ok: true,
      model: "jev-1.13.0",
      payload: {
        ...runtimeJevPayload,
        answers: answersFor(input.questions as Record<string, { type?: string }>),
      },
    })),
    llm: new FakeLlm({
      draftRubric() {
        return {
          model: "fake-llm",
          criteria: [
            { kind: "requirement", label: "Go", prompt: "Is there evidence of Go?" },
            { kind: "preference", label: "Distributed systems", prompt: "Is there evidence of distributed-systems work?" },
            {
              kind: "disqualifier",
              label: "No ownership",
              prompt: "Has the candidate never owned production systems?",
            },
            { kind: "seniority", label: "Senior", prompt: "How closely does seniority match senior?" },
          ],
          usage: { inputTokens: 1842, outputTokens: 610 },
        };
      },
      compare(input) {
        return {
          model: "fake-llm",
          excerpts: input.criteria.map((criterion, index) => ({
            criterionId: criterion.id,
            excerpt: index === 0 ? "Led the payments API in Go for four years." : "not in the profile",
          })),
          usage: { inputTokens: 412, outputTokens: 88 },
        };
      },
    }),
  };
}
