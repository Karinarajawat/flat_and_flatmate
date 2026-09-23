export function extractPostId(url: string): string | null {
  const match = url.match(/\/comments\/([a-z0-9]+)\//i);
  return match?.[1] ?? null;
}

export const TAKEN_RE =
  /\b(taken|rented|booked|closed|no longer available|filled|gone)\b/i;
