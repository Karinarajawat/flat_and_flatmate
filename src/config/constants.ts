export const REDDIT_USER_AGENT =
  "node:flat-sharing-etl:v1.0.0 (by /u/_aquiem_)";

export const REDDIT_DEFAULT_FETCH_LIMIT = 100;
export const REDDIT_DEFAULT_MAX_POSTS = 200;
export const REDDIT_REQUEST_DELAY_MS = 3_000;

export const REDDIT_RATE_LIMIT_THRESHOLD = 10;
export const REDDIT_RATE_LIMIT_BUFFER_SECONDS = 2;

export const REDDIT_MAX_RETRIES = 3;
export const REDDIT_RETRY_DELAY_MS = 5_000;

export const REDDIT_API_HOST = "www.reddit.com";

export const TARGET_SUBREDDITS = [
  // Mumbai
  "flatmatesmumbai",
  "mumbai_flat_flatmates",

  // Pune
  "PuneFlat_Flatmates",
  "PuneClassifieds",

  // Bangalore
  "Bangalore_Rentals",
  "BangaloreFlatsRental",

  // Hyderabad
  "HyderabadRentals",
  "HyderabadFlatRentals",
];

export const TARGET_FACEBOOK_GROUPS = [
  "888958910077001",
  "760226298282187",
  "1123961058804292",
  "607379197814656",
  "647914020401448",
  "3140606822849177",
  "296704767506035",
  "200531650702980",
  "641314477149817",
  "flatandflatmatespuneindia",
  "345164347222362",
  "1223846759040286",
  "3439521116058746",
  "puneflatandflatmate",
  "rentingpune",
  "166919238142189",
  "flatsandflatmatesbangalorefacebook",
  "flatsandflatmatesbangalorefacebook",
  "findmyroombangalore",
  "findmyroombangalore",
];

export const FACEBOOK_DEFAULT_PAGES_TO_SCROLL = 15;

export const RAW_DATA_DIR = "data/raw";
export const NORM_DATA_DIR = "data/normalised";
export const OFFERING_DATA_DIR = "data/offering";
export const FINAL_DATA_DIR = "data/final";
