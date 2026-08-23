import fs from "fs/promises";
import path from "path";

import { parseWithGemini } from "@/parsing/gemini-parser";
import { getListingType, ListingType } from "@/parsing/heuristics";
import { resolveCoordinates } from "@/service/geocoder";
import { Listing } from "@/types/listing";
import { RawPost } from "@/types/post";
import { LISTING_STATUSES } from "@/config/model";
import { writeFinalData, writeOfferingData } from "@/storage/storage";

export interface ParseResult {
  listing: Listing | null;
  listingType: ListingType;
  status: "success" | "skipped" | "llm_skipped" | "failed";
  error?: string;
}

export const parsePost = async (post: RawPost): Promise<ParseResult> => {
  const listingType = getListingType(post);

  if (listingType !== "offering_room") {
    return {
      listing: null,
      listingType,
      status: "skipped",
    };
  }

  try {
    const geminiResponse = await parseWithGemini(post);

    if (geminiResponse.skip) {
      return {
        listing: null,
        listingType,
        status: "llm_skipped",
      };
    }

    const { data, lister } = geminiResponse;

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

export const parsePosts = async (
  inputFiles: string[],
  limit: number,
): Promise<void> => {
  if (inputFiles.length === 0) {
    console.log("No input files provided.");
    return;
  }

  if (limit <= 0) {
    console.log("Parse limit must be greater than 0.");
    return;
  }

  let successfulListings = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalOffering = 0;

  for (const inputFile of inputFiles) {
    if (successfulListings >= limit) {
      break;
    }

    console.log(`\nParsing file: ${inputFile}`);

    try {
      const inputFileName = path.basename(inputFile, ".json");

      const content = await fs.readFile(inputFile, "utf8");
      const parsed: unknown = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        throw new Error(`Expected ${inputFile} to contain a JSON array`);
      }

      const posts = parsed as RawPost[];

      if (posts.length === 0) {
        console.log(`No posts found in ${inputFile}.`);
        continue;
      }

      const remaining = limit - successfulListings;

      console.log(
        `Loaded ${posts.length} posts. Listings remaining: ${remaining}`,
      );

      const offeringPosts: RawPost[] = [];
      const finalListings: Listing[] = [];

      let skippedCount = 0;
      let failedCount = 0;

      let processedCount = 0;

      for (const post of posts) {
        if (finalListings.length >= remaining) {
          break;
        }

        processedCount++;

        console.log(
          `Processing [${processedCount}/${posts.length}] - ${inputFileName}`,
        );

        const result = await parsePost(post);

        if (result.listingType === "offering_room") {
          offeringPosts.push(post);
        }

        if (result.status === "success" && result.listing) {
          finalListings.push(result.listing);

          console.log("SUCCESS");
        }

        if (result.status === "skipped") {
          skippedCount++;
        }

        if (result.status === "failed") {
          failedCount++;

          console.log(`FAILED | ${result.error}`);
        }
      }

      successfulListings += finalListings.length;

      totalOffering += offeringPosts.length;
      totalSkipped += skippedCount;
      totalFailed += failedCount;

      const outputName = `parsed-${inputFileName}`;

      const offeringOutputPath = await writeOfferingData(
        outputName,
        offeringPosts,
      );

      console.log(
        `Saved ${offeringPosts.length} offering posts to ${offeringOutputPath}`,
      );

      const finalOutputPath = await writeFinalData(outputName, finalListings);

      console.log(
        `Saved ${finalListings.length} final listings to ${finalOutputPath}`,
      );

      console.log(
        `File complete: ${offeringPosts.length} offering, ` +
          `${finalListings.length} successful, ` +
          `${skippedCount} skipped, ` +
          `${failedCount} failed.`,
      );
    } catch (error) {
      console.error(
        `Failed to parse ${inputFile}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log(
    `\nParsing job complete. ` +
      `Parsed ${successfulListings}/${limit} listings.`,
  );

  console.log(
    `Total: ${totalOffering} offering, ` +
      `${successfulListings} successful, ` +
      `${totalSkipped} skipped, ` +
      `${totalFailed} failed.`,
  );
};
