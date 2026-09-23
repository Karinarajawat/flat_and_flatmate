import dotenv from "dotenv";
dotenv.config();

import {
  RAW_DATA_DIR,
  FACEBOOK_DEFAULT_PAGES_TO_SCROLL,
  REDDIT_DEFAULT_FETCH_LIMIT,
  REDDIT_DEFAULT_MAX_POSTS,
  REDDIT_MAX_RETRIES,
  REDDIT_RATE_LIMIT_BUFFER_SECONDS,
  REDDIT_RATE_LIMIT_THRESHOLD,
  REDDIT_REQUEST_DELAY_MS,
  REDDIT_RETRY_DELAY_MS,
  TARGET_FACEBOOK_GROUPS,
  TARGET_SUBREDDITS,
  NORM_DATA_DIR,
} from "@/config/constants";

export const config = {
  reddit: {
    subreddits: TARGET_SUBREDDITS,

    fetchLimit: REDDIT_DEFAULT_FETCH_LIMIT,
    maxPostsPerSubreddit: REDDIT_DEFAULT_MAX_POSTS,

    requestDelayMs: REDDIT_REQUEST_DELAY_MS,

    rateLimitThreshold: REDDIT_RATE_LIMIT_THRESHOLD,
    rateLimitBufferSeconds: REDDIT_RATE_LIMIT_BUFFER_SECONDS,

    maxRetries: REDDIT_MAX_RETRIES,
    retryDelayMs: REDDIT_RETRY_DELAY_MS,

    cookie: process.env.REDDIT_COOKIE ?? "",
  },

  facebook: {
    groups: TARGET_FACEBOOK_GROUPS,

    pagesToScroll: FACEBOOK_DEFAULT_PAGES_TO_SCROLL,

    cookiesPath: process.env.FACEBOOK_COOKIES_PATH ?? "facebook_cookies.json",
  },

  storage: {
    rawDataDir: RAW_DATA_DIR,
    normDataDir: NORM_DATA_DIR,
  },
} as const;
