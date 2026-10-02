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
    listingType = getListingType(post).type;

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

    const { data } = geminiResponse;

    logger.debug(
      `[${post.postId}] Geocoding: ${data.property.locality}, ${data.property.city}`,
    );

    const coordinates = await resolveCoordinates({
      address: data.property.address,
      locality: data.property.locality,
      city: data.property.city,
    });

    if (!coordinates) {
      throw new Error(
        `Could not geocode listing: ${data.property.locality}, ${data.property.city}`,
      );
    }

    logger.debug(
      `[${post.postId}] Geocoded: [${coordinates.longitude}, ${coordinates.latitude}]`,
    );

    const listing: Listing = {
      images: post.imageUrls ?? [],

      cover_image: post.imageUrls?.length ? post.imageUrls[0] : undefined,

      status: LISTING_STATUSES[0],

      property: {
        ...data.property,
        attached_washroom: data.property.attached_washroom ?? false,

        location: {
          type: "Point",
          coordinates: [coordinates.longitude, coordinates.latitude],
        },
      },

      rental_scope: data.rental_scope,

      pricing: data.pricing,

      availability: {
        ...data.availability,
        available_from: data.availability.available_from
          ? new Date(data.availability.available_from)
          : undefined,
      },

      preferences: data.preferences,

      services: data.services ?? [],
      add_ons: data.add_ons ?? [],
      amenities: data.amenities ?? [],
      house_rules: data.house_rules ?? [],
      nearby_places: (data.nearby_places ?? []).map((place) => ({
        ...place,
        distance: 0,
      })),

      views: 0,
      favorites: 0,

      external_listing: {
        source: post.platform,
        url: post.postUrl,
        author: post.author,
      },

      createdAt: new Date(),
      updatedAt: new Date(),
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
