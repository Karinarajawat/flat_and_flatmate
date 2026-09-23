import { config } from "@/config/scrapping";
import { RedditClient } from "@/reddit/client";
import { mapRedditPost } from "@/reddit/mapper";
import { logger } from "@/utils/logger";

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

  logger.info(`Scraping r/${subreddit} (limit=${maxPosts})`);

  while (posts.length < maxPosts) {
    const currentLimit = Math.min(limit, maxPosts - posts.length);

    const params = new URLSearchParams({
      limit: String(currentLimit),
    });

    if (after) {
      params.set("after", after);
    }

    const requestPath = `/r/${subreddit}/new.json?${params.toString()}`;

    logger.debug(`Fetching: ${requestPath}`);

    try {
      const response = await client.get<RedditListingResponse>(requestPath);

      const children = response.data?.data?.children ?? [];

      if (children.length === 0) {
        logger.debug(`No more posts found for r/${subreddit}.`);
        break;
      }

      rawPosts.push(...children);

      for (const child of children) {
        posts.push(mapRedditPost(child));
      }

      logger.debug(`Fetched ${children.length} posts (total: ${posts.length})`);

      after = response.data?.data?.after ?? null;

      await client.waitForRateLimit(response.headers);

      if (!after) {
        break;
      }
    } catch (error) {
      logger.error(
        `Error fetching r/${subreddit}:`,
        error instanceof Error ? error.message : String(error),
      );

      break;
    }
  }

  logger.info(`Scraped ${posts.length} posts from r/${subreddit}`);

  return {
    rawPosts,
    posts,
  };
};
