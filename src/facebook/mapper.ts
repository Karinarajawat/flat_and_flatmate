import { ExtractedFacebookPost } from "@/types/facebook";
import type { FacebookPost } from "@/types/post";

const createFallbackPostId = (
  post: ExtractedFacebookPost,
  index: number,
): string => {
  if (post.postId) {
    return post.postId;
  }

  if (post.postUrl) {
    const match = post.postUrl.match(
      /\/(posts|permalink|multi_permalink)\/(\d+)/,
    );

    if (match?.[2]) {
      return match[2];
    }
  }

  return `fb_${index}`;
};

export const mapFacebookPost = (
  post: ExtractedFacebookPost,
  groupId: string,
  index: number,
): FacebookPost => {
  return {
    platform: "facebook",
    postId: createFallbackPostId(post, index),
    author: post.author,
    content: post.content,
    timestamp: new Date().toISOString(),
    postUrl: post.postUrl,
    imageUrls: post.imageUrls.length > 0 ? post.imageUrls : undefined,
    groupId,
  };
};
