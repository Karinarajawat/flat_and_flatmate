import { parseWithGemini } from "@/parsing/gemini-parser";
import { getListingType, ListingType } from "@/parsing/heuristics";
import { fetchPostWithComments } from "@/reddit/comments";
import { extractPostId, TAKEN_RE } from "@/reddit/utils";
import { resolveCoordinates } from "@/service/geocoder";
import { Listing } from "@/types/listing";
import { RawPost } from "@/types/post";
import { RedditClient } from "@/reddit/client";
import { LISTING_STATUSES } from "@/config/model";
import { logger } from "@/utils/logger";

export interface ParseResult {
  listing: Listing | null;
  listingType: ListingType;
  status: "success" | "skipped" | "stale" | "llm_skipped" | "failed";
  error?: string;
}

export interface ParsePostOptions {
  /** Pipeline already ran getListingType; skip the internal re-run. */
  heuristicsDone?: boolean;
  /** Precomputed listingType when heuristicsDone is true. */
  listingType?: ListingType;
}

export const parsePost = async (
  post: RawPost,
  redditClient?: RedditClient,
  options: ParsePostOptions = {},
): Promise<ParseResult> => {
  let listingType: ListingType;

  if (options.heuristicsDone && options.listingType) {
    listingType = options.listingType;
    if (listingType !== "offering_room") {
      logger.debug(`[${post.postId}] Skipped: ${listingType}`);
      return {
        listing: null,
        listingType,
        status: "skipped",
      };
    }
  } else {
    listingType = getListingType(post);

    if (listingType !== "offering_room") {
      logger.debug(`[${post.postId}] Skipped: ${listingType}`);
      return {
        listing: null,
        listingType,
        status: "skipped",
      };
    }
  }

  try {
    // Fetch comments for Reddit posts after heuristic passes
    if (post.platform === "reddit" && redditClient) {
      const postId = extractPostId(post.postUrl);
      if (postId) {
        const { comments } = await fetchPostWithComments(redditClient, postId);
        post.comments = comments;

        // Check for stale signals from OP
        const opComments = comments.filter((c) => c.author === post.author);
        const isStale = opComments.some((c) => TAKEN_RE.test(c.body));
        if (isStale) {
          logger.debug(`[${post.postId}] Skipped: stale OP comment`);
          return {
            listing: null,
            listingType,
            status: "stale",
          };
        }
      }
    }

    const geminiResponse = await parseWithGemini(post);

    if (geminiResponse.skip) {
      logger.debug(`[${post.postId}] Skipped: Gemini skip=true`);
      return {
        listing: null,
        listingType,
        status: "llm_skipped",
      };
    }

    const { data, lister } = geminiResponse;

    logger.debug(`[${post.postId}] Geocoding: ${data.locality}, ${data.city}`);

    const coordinates = await resolveCoordinates({
      address: data.address,
      locality: data.locality,
      city: data.city,
    });

    if (!coordinates) {
      throw new Error(
        `Could not geocode listing: ${data.locality}, ${data.city}`,
      );
    }

    logger.debug(
      `[${post.postId}] Geocoded: [${coordinates.longitude}, ${coordinates.latitude}]`,
    );

    const listing: Listing = {
      data: {
        ...data,

        location: {
          type: "Point",
          coordinates: [coordinates.longitude, coordinates.latitude],
        },

        images: post.imageUrls ?? [],

        cover_image: post.imageUrls?.length ? post.imageUrls[0] : undefined,

        status: LISTING_STATUSES[0],
      },

      external_listing: {
        source: post.platform,
        url: post.postUrl,
        lister,
      },

      views: 0,
      favorites: 0,
    };

    return {
      listing,
      listingType,
      status: "success",
    };
  } catch (error) {
    return {
      listing: null,
      listingType,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
