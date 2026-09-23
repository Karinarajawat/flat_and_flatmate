import { logger } from "@/utils/logger";

import type { RedditPost } from "@/types/post";
import type { RedditListingChild, RedditMediaMetadata } from "@/types/reddit";

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function normalizeRedditUrl(url: string): string {
  return decodeHtmlEntities(url);
}

function extractGalleryImageUrls(data: RedditListingChild["data"]): string[] {
  if (!data.gallery_data || !data.media_metadata) {
    return [];
  }

  const imageUrls: string[] = [];

  for (const item of data.gallery_data.items) {
    if (item.is_deleted) {
      continue;
    }

    const metadata = data.media_metadata[item.media_id];

    if (!metadata) {
      continue;
    }

    // Prefer the original/full-resolution image.
    if (metadata.s?.u) {
      imageUrls.push(normalizeRedditUrl(metadata.s.u));
      continue;
    }

    // Fallback to the largest preview.
    if (metadata.p?.length) {
      const largestPreview = metadata.p.reduce((largest, current) => {
        return current.x * current.y > largest.x * largest.y
          ? current
          : largest;
      });

      imageUrls.push(normalizeRedditUrl(largestPreview.u));
    }
  }

  return imageUrls;
}

function extractDirectImageUrl(data: RedditListingChild["data"]): string[] {
  const url = data.url_overridden_by_dest ?? data.url;

  if (!url) {
    return [];
  }

  const normalizedUrl = normalizeRedditUrl(url);

  // Reddit-hosted image.
  if (/^https?:\/\/i\.redd\.it\//i.test(normalizedUrl)) {
    return [normalizedUrl];
  }

  // Other direct image URLs.
  if (/\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(normalizedUrl)) {
    return [normalizedUrl];
  }

  return [];
}

function extractPreviewImageUrls(data: RedditListingChild["data"]): string[] {
  if (!data.preview?.images) {
    return [];
  }

  return data.preview.images
    .map((image) => image.source?.url)
    .filter((url): url is string => Boolean(url))
    .map(normalizeRedditUrl);
}

function extractImageUrls(data: RedditListingChild["data"]): string[] {
  let imageUrls: string[] = [];

  // 1. Reddit gallery
  if (data.is_gallery) {
    imageUrls = extractGalleryImageUrls(data);
  }

  // 2. Normal direct image post
  if (imageUrls.length === 0) {
    imageUrls = extractDirectImageUrl(data);
  }

  // 3. Preview fallback
  if (imageUrls.length === 0) {
    imageUrls = extractPreviewImageUrls(data);
  }

  // Deduplicate exact URLs.
  return [...new Set(imageUrls)];
}

export function mapRedditPost(child: RedditListingChild): RedditPost {
  const data = child.data;

  const imageUrls = extractImageUrls(data);

  logger.debug(`Mapped post ${data.id}: ${imageUrls.length} images`);

  return {
    platform: "reddit",

    postId: data.id,

    author: data.author ?? "[deleted]",

    content: [data.title, data.selftext ?? ""].filter(Boolean).join("\n\n"),

    timestamp: new Date(data.created_utc * 1000).toISOString(),

    postUrl: `https://www.reddit.com${data.permalink}`,

    ...(imageUrls.length > 0 ? { imageUrls } : {}),

    subreddit: data.subreddit,
  };
}
