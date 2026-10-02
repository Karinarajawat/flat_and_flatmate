export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleeps a uniform-random duration in [minMs, maxMs]. Returns the actual
// ms slept so callers can log it. Used as anti-ban jitter between scrape
// targets (swapped min/max are tolerated).
export async function sleepRandom(minMs: number, maxMs: number): Promise<number> {
  const lo = Math.min(minMs, maxMs);
  const hi = Math.max(minMs, maxMs);
  const ms = lo + Math.random() * (hi - lo);
  const rounded = Math.round(ms);
  await sleep(rounded);
  return rounded;
}

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
