import { RedditClient } from "@/reddit/client";
import { logger } from "@/utils/logger";
import type {
  RedditComment,
  RedditCommentsResponse,
  RedditListingChild,
} from "@/types/reddit";

export interface PostWithComments {
  post: RedditListingChild;
  comments: RedditComment[];
}

export async function fetchPostWithComments(
  client: RedditClient,
  postId: string,
): Promise<PostWithComments> {
  const requestPath = `/comments/${postId}.json`;

  logger.debug(`Fetching comments for post ${postId}`);

  const response = await client.get<RedditCommentsResponse>(requestPath);

  const postChild = response.data?.[0]?.data?.children?.[0];

  if (!postChild) {
    throw new Error(`Post ${postId} not found`);
  }

  const commentChildren = response.data?.[1]?.data?.children ?? [];

  const comments: RedditComment[] = commentChildren
    .filter((child) => child.kind === "t1")
    .map((child) => child.data);

  logger.debug(`Fetched ${comments.length} comments for post ${postId}`);

  return {
    post: postChild,
    comments,
  };
}
