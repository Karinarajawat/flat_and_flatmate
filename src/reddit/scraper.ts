import { config } from "@/config/scrapping";
import { RedditClient } from "@/reddit/client";
import { mapRedditPost } from "@/reddit/mapper";

import type { RedditPost } from "@/types/post";
import type { RedditListingChild, RedditListingResponse } from "@/types/reddit";

export const scrapeSubreddit = async (
  client: RedditClient,
  subreddit: string,
  limit = config.reddit.fetchLimit,
  maxPosts = config.reddit.maxPostsPerSubreddit,
): Promise<{
  rawPosts: RedditListingChild[];
  posts: RedditPost[];
}> => {
  const rawPosts: RedditListingChild[] = [];
  const posts: RedditPost[] = [];

  let after: string | null = null;

  while (posts.length < maxPosts) {
    const currentLimit = Math.min(limit, maxPosts - posts.length);

    const params = new URLSearchParams({
      limit: String(currentLimit),
    });

    if (after) {
      params.set("after", after);
    }

    const requestPath = `/r/${subreddit}/new.json?${params.toString()}`;

    console.log(`Fetching: ${requestPath}`);

    try {
      const response = await client.get<RedditListingResponse>(requestPath);

      const children = response.data?.data?.children ?? [];

      if (children.length === 0) {
        console.log(`No more posts found for r/${subreddit}.`);
        break;
      }

      rawPosts.push(...children);

      for (const child of children) {
        posts.push(mapRedditPost(child));
      }

      after = response.data?.data?.after ?? null;

      await client.waitForRateLimit(response.headers);

      if (!after) {
        break;
      }
    } catch (error) {
      console.error(
        `Error fetching r/${subreddit}:`,
        error instanceof Error ? error.message : String(error),
      );

      break;
    }
  }

  return {
    rawPosts,
    posts,
  };
};
