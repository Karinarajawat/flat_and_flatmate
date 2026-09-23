import type { RedditListingChild } from "@/types/reddit";

export type RedditDeletionReason =
  | "author"
  | "removed_by_category"
  | "selftext";

export function getRedditDeletionReason(
  data: RedditListingChild["data"],
): RedditDeletionReason | null {
  const author = data.author;
  if (author === "[deleted]" || author === "[removed]") {
    return "author";
  }

  if (data.removed_by_category) {
    return "removed_by_category";
  }

  const selftext = data.selftext ?? "";
  if (selftext === "[deleted]" || selftext === "[removed]") {
    return "selftext";
  }

  return null;
}
