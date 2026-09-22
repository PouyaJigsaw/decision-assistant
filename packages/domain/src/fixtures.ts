import type { Criterion } from "./types";

export const sampleRubric: Criterion[] = [
  { id: "go", kind: "requirement", label: "Go, five or more years", prompt: "Is there evidence of at least five years of Go?" },
  { id: "distributed", kind: "preference", label: "Distributed systems", prompt: "Is there evidence of distributed-systems work?" },
  { id: "no-ownership", kind: "disqualifier", label: "No production ownership", prompt: "Is there evidence the candidate has never owned production systems?" },
  { id: "seniority", kind: "seniority", label: "Senior", prompt: "How closely does demonstrated seniority match senior?" },
];
