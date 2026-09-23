export interface RedditMediaMetadata {
  id: string;
  status: string;
  e: string;
  m: string;

  p?: Array<{
    x: number;
    y: number;
    u: string;
  }>;

  s?: {
    x: number;
    y: number;
    u: string;
  };
}

export interface RedditGalleryItem {
  media_id: string;
  id: number;
  is_deleted: boolean;
}

export interface RedditListingChild {
  kind: string;

  data: {
    id: string;

    author: string | null;

    title: string;
    selftext: string;

    permalink: string;
    subreddit: string;
    created_utc: number;

    url?: string;
    url_overridden_by_dest?: string;

    is_gallery?: boolean;

    removed_by_category?: string;

    gallery_data?: {
      items: RedditGalleryItem[];
    };

    media_metadata?: Record<string, RedditMediaMetadata>;

    preview?: {
      images?: Array<{
        source?: {
          url?: string;
        };
      }>;
    };

    [key: string]: unknown;
  };
}

export interface RedditListingResponse {
  data: {
    after: string | null;
    before: string | null;
    children: RedditListingChild[];
  };
}

export interface RedditHttpResponse<T> {
  data: T;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
}

export interface RedditComment {
  author: string;
  body: string;
  created_utc: number;
}

export interface RedditCommentChild {
  kind: string;
  data: RedditComment;
}

export type RedditCommentsResponse = [
  RedditListingResponse,
  { data: { children: RedditCommentChild[] } },
];
