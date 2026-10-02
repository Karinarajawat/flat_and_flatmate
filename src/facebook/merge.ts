import type { FacebookPost } from "@/types/post";

// Cross-pass merge for scraped FB posts.
//
// FB renders truncated + expanded copies of the same message, so one post
// can surface with slightly different text (and different fb_* fallback
// ids) on different scroll passes. Posts sharing author + 120-char
// normalized prefix are treated as the same post; the copy with a real
// postUrl wins, else the longest text. Same-postId re-extracts backfill a
// newly resolved URL into the stored copy.
export interface PostMergeState {
  posts: FacebookPost[];
  seenPostIds: Map<string, number>;
  prefixIndex: Map<string, number>;
}

export const createMergeState = (): PostMergeState => ({
  posts: [],
  seenPostIds: new Map(),
  prefixIndex: new Map(),
});

const prefixKey = (post: FacebookPost): string =>
  post.author +
  "|" +
  post.content.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 120);

const score = (post: FacebookPost): number =>
  (post.postUrl ? 100_000 : 0) + post.content.length;

// Returns "new" | "updated" | "duplicate".
export const mergePost = (
  state: PostMergeState,
  post: FacebookPost,
): "new" | "updated" | "duplicate" => {
  const existingIdx = state.seenPostIds.get(post.postId);

  if (existingIdx !== undefined) {
    if (score(post) > score(state.posts[existingIdx])) {
      state.posts[existingIdx] = post;
      return "updated";
    }
    return "duplicate";
  }

  const key = prefixKey(post);
  const dupIdx = state.prefixIndex.get(key);

  if (dupIdx !== undefined) {
    if (score(post) > score(state.posts[dupIdx])) {
      state.seenPostIds.delete(state.posts[dupIdx].postId);
      state.seenPostIds.set(post.postId, dupIdx);
      state.posts[dupIdx] = post;
      return "updated";
    }
    return "duplicate";
  }

  state.seenPostIds.set(post.postId, state.posts.length);
  state.prefixIndex.set(key, state.posts.length);
  state.posts.push(post);
  return "new";
};
