export const REDDIT_USER_AGENT =
  "node:flat-sharing-etl:v1.0.0 (by /u/_aquiem_)";

export const REDDIT_DEFAULT_FETCH_LIMIT = 200;
export const REDDIT_DEFAULT_MAX_POSTS = 200;
export const REDDIT_REQUEST_DELAY_MS = 3_000;

export const REDDIT_RATE_LIMIT_THRESHOLD = 10;
export const REDDIT_RATE_LIMIT_BUFFER_SECONDS = 2;

export const REDDIT_MAX_RETRIES = 3;
export const REDDIT_RETRY_DELAY_MS = 5_000;

export const REDDIT_API_HOST = "www.reddit.com";

// export const TARGET_SUBREDDITS = ["flatmatesmumbai", "mumbai_flat_flatmates"];

export const TARGET_SUBREDDITS = [
  "flatmatesmumbai",
  "mumbai_flat_flatmates",
  "PuneFlat_Flatmates",
  "PuneClassifieds",
];

export const FACEBOOK_DEFAULT_PAGES_TO_SCROLL = 5;

export const FACEBOOK_SCROLL_DELAY_MS = 4000;
export const FACEBOOK_SEE_MORE_DELAY_MS = 1000;
export const FACEBOOK_NAVIGATION_TIMEOUT_MS = 45_000;
export const FACEBOOK_NAVIGATION_FALLBACK_DELAY_MS = 10_000;
export const FACEBOOK_VIEWPORT = {
  width: 1280,
  height: 800,
};

export const TARGET_FACEBOOK_GROUPS = ["1223846759040286"];

export const RAW_DATA_DIR = "data/raw";
export const NORM_DATA_DIR = "data/normalised";
export const OFFERING_DATA_DIR = "data/offering";
export const NOT_OFFERING_DATA_DIR = "data/not_offering";
export const SEEKING_DATA_DIR = "data/seeking";
export const AMBIGUOUS_DATA_DIR = "data/ambiguous";
export const NOT_HOUSING_DATA_DIR = "data/not_housing";
export const CLASSIFIED_DATA_DIR = "data/classified";
export const FINAL_DATA_DIR = "data/final";

export const PLATFORMS = {
  REDDIT: "reddit",
  FACEBOOK: "facebook",
} as const;
