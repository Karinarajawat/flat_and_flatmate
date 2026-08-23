export type Platform = "reddit" | "facebook";

export interface RawPost {
  platform: Platform;
  postId: string;
  author: string;
  content: string;
  timestamp: string;
  postUrl: string;
  imageUrls?: string[];
}

export interface RedditPost extends RawPost {
  platform: "reddit";
  subreddit: string;
}

export interface FacebookPost extends RawPost {
  platform: "facebook";
  groupId: string;
}
