import { parseWithGemini } from "@/parsing/gemini-parser";
import { getListingType, ListingType } from "@/parsing/heuristics";
import { fetchPostWithComments } from "@/reddit/comments";
import { extractPostId, TAKEN_RE } from "@/reddit/utils";
import { resolveCoordinates } from "@/service/geocoder";
import { GeminiListingData, Listing } from "@/types/listing";
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

    // Deterministic guard: prompt requires skip=true when any REQUIRED
    // field is missing/placeholder, but the LLM is non-binding. Enforce
    // here so incomplete or whole-flat listings never reach geocode/DB.
    // Allowed defaults (never skip): address falls back to locality
    // (geocoder appends ", locality, city, India"), capacity defaults to
    // 1, furnished_status defaults to "unfurnished",
    // rental_scope.total_occupancy is optional.
    const missingField = findMissingRequiredField(data);

    if (missingField) {
      logger.debug(
        `[${post.postId}] Skipped: Gemini missing required field ${missingField}`,
      );
      return {
        listing: null,
        listingType,
        status: "llm_skipped",
      };
    }

    // A private room with no sharing words implies single occupancy.
    const capacity =
      typeof data.rental_scope?.capacity === "number" &&
      data.rental_scope.capacity >= 1
        ? data.rental_scope.capacity
        : 1;

    if (
      typeof data.rental_scope?.capacity !== "number" ||
      data.rental_scope.capacity < 1
    ) {
      logger.debug(`[${post.postId}] Capacity defaulted to 1`);
    }

    // Either locality or society/landmark works as the address: the
    // geocoder tries "address, locality, city, India" first and falls
    // back to "locality, city, India", so a locality-only address still
    // geocodes. Never store an empty address (Mongoose requires it).
    const rawAddress = data.property.address?.trim();
    const address = rawAddress || data.property.locality;

    if (!rawAddress) {
      logger.debug(
        `[${post.postId}] Address fallback to locality: ${data.property.locality}`,
      );
    }

    logger.debug(
      `[${post.postId}] Geocoding: ${data.property.locality}, ${data.property.city}`,
    );

    const coordinates = await resolveCoordinates({
      address,
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
        address,
        furnished_status: data.property.furnished_status ?? "unfurnished",
        attached_washroom: data.property.attached_washroom ?? false,

        location: {
          type: "Point",
          coordinates: [coordinates.longitude, coordinates.latitude],
        },
      },

      rental_scope: {
        ...data.rental_scope,
        capacity,
      },

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

/**
 * Returns the name of the first missing/invalid REQUIRED field, or null
 * when the Gemini payload satisfies the deterministic prompt contract.
 * Intentionally excluded (allowed defaults, never skip): property.address
 * (falls back to locality — geocoder appends ", locality, city, India"),
 * rental_scope.capacity (defaults to 1 for a private room),
 * property.furnished_status (defaults to "unfurnished") and
 * rental_scope.total_occupancy (optional).
 */
function findMissingRequiredField(data: GeminiListingData): string | null {
  if (!data.property?.bhk) return "property.bhk";
  if (!data.property?.city) return "property.city";

  // Either locality or a society/landmark address works; locality is the
  // hard requirement, address falls back to it in parsePost.
  if (!data.property?.locality?.trim()) return "property.locality";

  if (
    data.rental_scope?.type !== "room" &&
    data.rental_scope?.type !== "hall"
  ) {
    return "rental_scope.type";
  }

  // Reject placeholder rents (0/1) the prompt explicitly forbids.
  if (typeof data.pricing?.rent !== "number" || data.pricing.rent <= 1) {
    return "pricing.rent";
  }

  if (typeof data.availability?.available_immediately !== "boolean") {
    return "availability.available_immediately";
  }

  return null;
}
