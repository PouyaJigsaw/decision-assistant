export function costFromUsage(usage: { inputTokens: number; outputTokens: number }, price: { inputUsdPerMillion: number; outputUsdPerMillion: number }) {
  const inputUsd = (usage.inputTokens * price.inputUsdPerMillion) / 1_000_000;
  const outputUsd = (usage.outputTokens * price.outputUsdPerMillion) / 1_000_000;
  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}

export function formatUsd(amount: number): string {
  if (amount === 0) return "$0";
  if (amount >= 0.01) {
    return `$${amount.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}`;
  }
  return `$${amount.toFixed(5).replace(/0+$/, "").replace(/\.$/, "")}`;
}
