import { config as scrapingConfig } from "@/config/scrapping";
import { createFacebookBrowser } from "@/facebook/browser";
import { scrapeGroup } from "@/facebook/scraper";
import { parsePost } from "@/parsing/parser";
import { RedditClient } from "@/reddit/client";
import { scrapeSubreddit } from "@/reddit/scraper";
import {
  writeAmbiguousData,
  writeFinalData,
  writeNormData,
  writeNotHousingData,
  writeNotOfferingData,
  writeOfferingData,
  writeRawData,
} from "@/storage/storage";
import { Listing } from "@/types/listing";
import { ListingModel } from "@/types/listing.model";
import { getOrCreateLocality } from "@/service/locality";
import { FacebookPost, RawPost, RedditPost } from "@/types/post";
import { connectDb, disconnectDb } from "@/storage/db";

const progressBarWidth = 30;

const main = async () => {
  const jobTimestamp = Date.now();
  const normPostMap: Record<string, (RedditPost | FacebookPost)[]> = {};

  //
  //    Scraping Facebook
  //
  const { browser, context } = await createFacebookBrowser();
  try {
    for (const groupId of scrapingConfig.facebook.groups) {
      const result = await scrapeGroup(context, groupId);

      const filename = `facebook-${groupId}-${jobTimestamp}`;

      const normOutputPath = await writeNormData(filename, result);

      normPostMap[groupId] = result;

      console.log(
        `Fetched ${result.length} posts for fb-${groupId}. Results saved at Norm: ${normOutputPath}\n`,
      );
    }

    console.log("\nFacebook scraping complete.");
  } finally {
    await browser.close();
  }

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
    const notOfferingPosts: RawPost[] = [];
    const ambiguousPosts: RawPost[] = [];
    const notHousingPosts: RawPost[] = [];
    const finalListings: Listing[] = [];

    const subgroupStats = {
      total: 0,
      offering: 0,
      not_offering: 0,
      ambiguous: 0,
      not_housing: 0,
      llm_skipped: 0,
      success: 0,
      failed: 0,
    };

    for (const post of posts) {
      subgroupStats.total++;
      const result = await parsePost(post);

      switch (result.listingType) {
        case "offering_room":
          subgroupStats.offering++;
          offeringPosts.push(post);
          break;
        case "seeking_room":
          subgroupStats.not_offering++;
          notOfferingPosts.push(post);
          break;
        case "ambiguous":
          subgroupStats.ambiguous++;
          ambiguousPosts.push(post);
          break;
        case "not_housing":
          subgroupStats.not_housing++;
          notHousingPosts.push(post);
          break;
      }

      if (result.status === "success" && result.listing) {
        subgroupStats.success++;
        finalListings.push(result.listing);
      }

      if (result.status === "llm_skipped") subgroupStats.llm_skipped++;

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
          `| Skipped: ${subgroupStats.llm_skipped} ` +
          `| Failed: ${subgroupStats.failed}`,
      );
    }

    // Move to next line after progress bar completes
    process.stdout.write("\n");

    const filename = `${posts[0].platform}-${subgroup}-${jobTimestamp}`;
    await writeOfferingData(filename, offeringPosts);
    await writeNotOfferingData(filename, notOfferingPosts);
    await writeAmbiguousData(filename, ambiguousPosts);
    await writeNotHousingData(filename, notHousingPosts);
    await writeFinalData(filename, finalListings);

    totalFinalListings.push(...finalListings);

    console.log(
      `[${posts[0].platform}-${subgroup}] ` +
        `total=${subgroupStats.total} ` +
        `offering=${subgroupStats.offering} ` +
        `not_offering=${subgroupStats.not_offering} ` +
        `ambiguous=${subgroupStats.ambiguous} ` +
        `not_housing=${subgroupStats.not_housing} ` +
        `skipped=${subgroupStats.llm_skipped} ` +
        `success=${subgroupStats.success} ` +
        `failed=${subgroupStats.failed}`,
    );
  }

  if (totalFinalListings.length === 0) {
    console.log("\nNo valid listings to import into MongoDB.");
    return;
  }

  await connectDb();

  const mongoStats = {
    inserted: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    for (const listing of totalFinalListings) {
      try {
        const externalListing = listing.external_listing;
        if (!externalListing?.source || !externalListing.url) {
          mongoStats.skipped++;
          continue;
        }

        const existing = await ListingModel.exists({
          "external_listing.source": externalListing.source,
          "external_listing.url": externalListing.url,
        });

        if (existing) {
          // console.log(`Already exists: ${listing.external_listing!.url}`);
          mongoStats.skipped++;
          continue;
        }

        let localityId = listing.data.locality_id;
        if (!localityId && listing.data.locality) {
          const localityDoc = await getOrCreateLocality({
            name: listing.data.locality,
            city: listing.data.city,
          });
          localityId = localityDoc._id;
        }

        if (!localityId) {
          throw new Error(
            `Cannot insert listing "${listing.data.title}": missing locality`,
          );
        }

        const { locality: _locality, ...dataFields } = listing.data;

        const document = {
          data: {
            ...dataFields,
            locality_id: localityId,

            // Apply Mongo defaults explicitly where useful.
            images: listing.data.images ?? [],
            status: listing.data.status ?? "active",

            // Convert ISO string -> Date
            available_from: listing.data.available_from
              ? new Date(listing.data.available_from)
              : undefined,
          },

          external_listing: {
            ...externalListing,

            lister: {
              ...externalListing.lister,
              life_style: externalListing.lister.life_style ?? [],
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
  } finally {
    await disconnectDb();
  }
};

main().catch((error) => {
  console.error(
    "Pipeline job failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exit(1);
});
