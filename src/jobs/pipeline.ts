import { config as scrapingConfig } from "@/config/scrapping";
import { parsePost } from "@/parsing/parser";
import { RedditClient } from "@/reddit/client";
import { scrapeSubreddit } from "@/reddit/scraper";
import {
  writeFinalData,
  writeNormData,
  writeOfferingData,
  writeRawData,
} from "@/storage/storage";
import { Listing } from "@/types/listing";
import { ListingModel } from "@/types/listing.model";
import { FacebookPost, RawPost, RedditPost } from "@/types/post";
import mongoose from "mongoose";

const progressBarWidth = 30;

const main = async () => {
  const jobTimestamp = Date.now();
  const normPostMap: Record<string, (RedditPost | FacebookPost)[]> = {};

  //
  //    Scraping Facebook
  //

  //
  //    Scraping Reddit
  //
  const redditClient = new RedditClient();
  for (const subreddit of scrapingConfig.reddit.subreddits) {
    console.log(`Starting fetch for r/${subreddit}...`);

    const result = await scrapeSubreddit(redditClient, subreddit);

    const filename = `reddit-${subreddit}-${jobTimestamp}`;
    const rawOutputPath = await writeRawData(filename, result.rawPosts);
    const normOutputPath = await writeNormData(filename, result.posts);

    normPostMap[subreddit] = result.posts;

    console.log(
      `Fetched ${result.posts.length} posts for r/${subreddit}. Results saved at Raw: ${rawOutputPath} and Norm: ${normOutputPath}\n`,
    );
  }

  //
  //    Parsing normalized posts from both platforms
  //

  const totalFinalListings = [];

  for (const [subgroup, posts] of Object.entries(normPostMap)) {
    console.log(
      `Parsing normalized posts for ${posts[0].platform}-${subgroup}`,
    );

    const offeringPosts: RawPost[] = [];
    const finalListings: Listing[] = [];

    const subgroupStats = {
      total: 0,
      heuristic_valid: 0,
      llm_skiped: 0,
      success: 0,
      failed: 0,
    };

    for (const post of posts) {
      subgroupStats.total++;
      const result = await parsePost(post);

      if (result.listingType === "offering_room") {
        subgroupStats.heuristic_valid++;
        offeringPosts.push(post);
      }

      if (result.status === "success" && result.listing) {
        subgroupStats.success++;
        finalListings.push(result.listing);
      }

      if (result.status === "llm_skipped") subgroupStats.llm_skiped++;

      if (result.status === "failed") {
        subgroupStats.failed++;
      }

      const progress = Math.floor(
        (subgroupStats.total / posts.length) * progressBarWidth,
      );

      const bar =
        "█".repeat(progress) + "░".repeat(progressBarWidth - progress);

      process.stdout.write(
        `\r[${bar}] ${subgroupStats.total}/${posts.length} ` +
          `| Success: ${subgroupStats.success} ` +
          `| Skipped: ${subgroupStats.llm_skiped} ` +
          `| Failed: ${subgroupStats.failed}`,
      );
    }

    // Move to next line after progress bar completes
    process.stdout.write("\n");

    const filename = `${posts[0].platform}-${subgroup}-${jobTimestamp}`;
    await writeOfferingData(filename, offeringPosts);
    await writeFinalData(filename, finalListings);

    totalFinalListings.push(...finalListings);

    console.log(
      `[${posts[0].platform}-${subgroup}] ` +
        `total=${subgroupStats.total} ` +
        `heuristic=${subgroupStats.heuristic_valid} ` +
        `skipped=${subgroupStats.llm_skiped} ` +
        `success=${subgroupStats.success} ` +
        `failed=${subgroupStats.failed}`,
    );
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not defined");
  }
  await mongoose.connect(mongoUri);

  const mongoStats = {
    inserted: 0,
    skipped: 0,
    failed: 0,
  };

  for (const listing of totalFinalListings) {
    try {
      const existing = await ListingModel.exists({
        "external_listing.source": listing.external_listing!.source,
        "external_listing.url": listing.external_listing!.url,
      });

      if (existing) {
        // console.log(`Already exists: ${listing.external_listing!.url}`);
        mongoStats.skipped++;
        continue;
      }

      const document = {
        data: {
          ...listing.data,

          // Apply Mongo defaults explicitly where useful.
          images: listing.data.images ?? [],
          status: listing.data.status ?? "active",

          // Convert ISO string -> Date
          available_from: listing.data.available_from
            ? new Date(listing.data.available_from)
            : undefined,
        },

        external_listing: {
          ...listing.external_listing,

          lister: {
            ...listing.external_listing!.lister,
            life_style: listing.external_listing!.lister.life_style ?? [],
          },
        },

        views: listing.views ?? 0,
        favorites: listing.favorites ?? 0,
      };

      await ListingModel.create(document);

      mongoStats.inserted++;
    } catch (error) {
      mongoStats.failed++;
      console.error(error);
    }
  }

  console.log("\nMongoDB import summary:");
  console.log(`  Total listings: ${totalFinalListings.length}`);
  console.log(`  Inserted:       ${mongoStats.inserted}`);
  console.log(`  Skipped:        ${mongoStats.skipped}`);
  console.log(`  Failed:         ${mongoStats.failed}`);

  await mongoose.disconnect();
  console.log("Disconnected from MongoDB");
};

main();
