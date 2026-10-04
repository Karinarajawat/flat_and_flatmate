import { config as scrapingConfig } from "@/config/scrapping";
import {
  getCityForFacebookGroup,
  getCityForSubreddit,
} from "@/config/constants";
import { createFacebookBrowser } from "@/facebook/browser";
import { scrapeGroup } from "@/facebook/scraper";
import { getRedditDeletionReason } from "@/parsing/deletion";
import { getListingType, ListingType } from "@/parsing/heuristics";
import { parsePost } from "@/parsing/parser";
import { RedditClient } from "@/reddit/client";
import { scrapeSubreddit } from "@/reddit/scraper";
import { fetchPostWithComments } from "@/reddit/comments";
import { extractPostId, TAKEN_RE } from "@/reddit/utils";
import {
  writeFinalData,
  writeNormData,
  writeOfferingData,
  writeRawData,
} from "@/storage/storage";
import {
  connectMongo,
  disconnectMongo,
  insertListing,
  listingExists,
  markListingStatus,
} from "@/storage/mongo";
import { Listing } from "@/types/listing";
import { FacebookPost, RawPost, RedditPost } from "@/types/post";
import { RedditListingChild } from "@/types/reddit";
import { logger } from "@/utils/logger";
import { sleepRandom, toErrorMessage } from "@/utils/utils";

const progressBarWidth = 30;

const main = async () => {
  const jobTimestamp = Date.now();
  const normPostMap: Record<string, (RedditPost | FacebookPost)[]> = {};
  const redditRawById = new Map<string, RedditListingChild>();

  //
  //    Scraping Facebook
  //
  const { browser, context } = await createFacebookBrowser();
  try {
    const groups = scrapingConfig.facebook.groups;
    for (let i = 0; i < groups.length; i++) {
      const groupId = groups[i];
      const result = await scrapeGroup(context, groupId);

      const filename = `facebook-${groupId}-${jobTimestamp}`;

      const normOutputPath = await writeNormData(filename, result);

      normPostMap[groupId] = result;

      console.log(
        `Fetched ${result.length} posts for fb-${groupId}. Results saved at Norm: ${normOutputPath}\n`,
      );

      // Random anti-ban cooldown between groups (skipped after the last).
      if (i < groups.length - 1) {
        const slept = await sleepRandom(
          scrapingConfig.facebook.interGroupDelayMinMs,
          scrapingConfig.facebook.interGroupDelayMaxMs,
        );
        console.log(
          `Cooling down for ${(slept / 1000).toFixed(1)}s before next Facebook group (anti-ban)...\n`,
        );
      }
    }

    console.log("\nFacebook scraping complete.");
  } finally {
    await browser.close();
  }

  //
  //    Scraping Reddit
  //
  const redditClient = new RedditClient();
  const subreddits = scrapingConfig.reddit.subreddits;
  for (let i = 0; i < subreddits.length; i++) {
    const subreddit = subreddits[i];
    console.log(`Starting fetch for r/${subreddit}...`);

    const result = await scrapeSubreddit(redditClient, subreddit);

    const filename = `reddit-${subreddit}-${jobTimestamp}`;
    const rawOutputPath = await writeRawData(filename, result.rawPosts);
    const normOutputPath = await writeNormData(filename, result.posts);

    for (const child of result.rawPosts) {
      redditRawById.set(child.data.id, child);
    }

    normPostMap[subreddit] = result.posts;

    console.log(
      `Fetched ${result.posts.length} posts for r/${subreddit}. Results saved at Raw: ${rawOutputPath} and Norm: ${normOutputPath}\n`,
    );

    // Random anti-ban cooldown between subreddits (skipped after the last).
    if (i < subreddits.length - 1) {
      const slept = await sleepRandom(
        scrapingConfig.reddit.interSubredditDelayMinMs,
        scrapingConfig.reddit.interSubredditDelayMaxMs,
      );
      console.log(
        `Cooling down for ${(slept / 1000).toFixed(1)}s before next subreddit (anti-ban)...\n`,
      );
    }
  }

  //
  //    Connect MongoDB early (needed for exists-in-DB stage)
  //
  await connectMongo();

  try {
    //
    //    Pipeline: heuristics → deletion → exists → (stale) → Gemini → geocode
    //
    const totalFinalListings: Listing[] = [];

    for (const [subgroup, posts] of Object.entries(normPostMap)) {
      if (posts.length === 0) {
        console.log(`Skipping ${subgroup}: no normalized posts scraped.`);
        continue;
      }

      console.log(
        `Parsing normalized posts for ${posts[0].platform}-${subgroup}`,
      );

      const offeringPosts: RawPost[] = [];
      const finalListings: Listing[] = [];

      const subgroupStats = {
        total: 0,
        exists: 0,
        deleted: 0,
        stale: 0,
        marked: 0,
        heuristic_valid: 0,
        llm_skiped: 0,
        success: 0,
        failed: 0,
        no_url: 0,
      };

      const updateProgress = () => {
        const progress = Math.floor(
          (subgroupStats.total / posts.length) * progressBarWidth,
        );

        const bar =
          "█".repeat(progress) + "░".repeat(progressBarWidth - progress);

        process.stdout.write(
          `\r[${bar}] ${subgroupStats.total}/${posts.length} ` +
            `| Exists: ${subgroupStats.exists} ` +
            `| Deleted: ${subgroupStats.deleted} ` +
            `| Stale: ${subgroupStats.stale} ` +
            `| Marked: ${subgroupStats.marked} ` +
            `| Success: ${subgroupStats.success} ` +
            `| Skipped: ${subgroupStats.llm_skiped} ` +
            `| Failed: ${subgroupStats.failed} ` +
            `| NoURL: ${subgroupStats.no_url}`,
        );
      };

      for (const post of posts) {
        subgroupStats.total++;

        if (!post.city) {
          post.city =
            post.platform === "facebook"
              ? getCityForFacebookGroup(subgroup)
              : getCityForSubreddit(subgroup);
        }

        //
        // Post URL check (mainly for facebook posts which dont have a postUrl)
        //
        if (!post.postUrl) {
          subgroupStats.no_url++;
          logger.debug(`[${post.postId}] Skipped: missing postUrl`);
          updateProgress();
          continue;
        }

        //
        // Heuristics Check
        //
        const listingType: ListingType = getListingType(post).type;
        if (listingType !== "offering_room") {
          logger.debug(`[${post.postId}] Skipped: ${listingType}`);
          updateProgress();
          continue;
        }

        subgroupStats.heuristic_valid++;

        //
        // Post Deletion Check
        //
        const rawChild = redditRawById.get(post.postId);
        const deletionReason =
          post.platform === "reddit" && rawChild
            ? getRedditDeletionReason(rawChild.data)
            : null;

        if (deletionReason) {
          subgroupStats.deleted++;

          if (await listingExists(post.platform, post.postUrl)) {
            //
            // Marking the post as EXPIRED in DB
            //
            const marked = await markListingStatus(
              post.platform,
              post.postUrl,
              "expired",
            );
            if (marked) subgroupStats.marked++;
            logger.debug(
              `[${post.postId}] Skipped: deleted (${deletionReason}) + marked expired`,
            );
          } else {
            logger.debug(
              `[${post.postId}] Skipped: deleted (${deletionReason})`,
            );
          }

          updateProgress();
          continue;
        }

        //
        // DB check to avoid duplicate entries
        //
        if (await listingExists(post.platform, post.postUrl)) {
          //
          // Stale comment Check
          //
          let isStale = false;

          if (post.platform === "reddit") {
            const postId = extractPostId(post.postUrl);
            if (postId) {
              try {
                const { comments } = await fetchPostWithComments(
                  redditClient,
                  postId,
                );
                const opComments = comments.filter(
                  (c) => c.author === post.author,
                );
                isStale = opComments.some((c) => TAKEN_RE.test(c.body));
              } catch (error) {
                logger.error(
                  `[${post.postId}] Comments fetch failed: ${toErrorMessage(error)}`,
                );
              }
            }
          }

          //
          // Updating status RENTED in DB
          //
          if (isStale) {
            const marked = await markListingStatus(
              post.platform,
              post.postUrl,
              "rented",
            );
            if (marked) subgroupStats.marked++;
            logger.debug(
              `[${post.postId}] Existing listing marked rented (stale)`,
            );
          }

          subgroupStats.exists++;
          logger.debug(`[${post.postId}] Skipped: already in DB`);
          updateProgress();
          continue;
        }

        offeringPosts.push(post);

        //
        // REGEX Heuristics (first to avoid comments API call if not needed)
        // Comments API call (returns stale )
        //
        //
        const result = await parsePost(post, redditClient, {
          heuristicsDone: true,
          listingType,
        });

        if (result.status === "success" && result.listing) {
          subgroupStats.success++;
          finalListings.push(result.listing);
        }

        if (result.status === "stale") {
          subgroupStats.stale++;
          logger.debug(
            `[${post.postId}] Skipped: stale OP comment (not in DB)`,
          );
        }

        if (result.status === "llm_skipped") subgroupStats.llm_skiped++;

        if (result.status === "failed") {
          subgroupStats.failed++;
          logger.error(`[${post.postId}] FAILED | ${result.error}`);
        }

        updateProgress();
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
          `exists=${subgroupStats.exists} ` +
          `deleted=${subgroupStats.deleted} ` +
          `stale=${subgroupStats.stale} ` +
          `marked=${subgroupStats.marked} ` +
          `heuristic=${subgroupStats.heuristic_valid} ` +
          `skipped=${subgroupStats.llm_skiped} ` +
          `success=${subgroupStats.success} ` +
          `failed=${subgroupStats.failed} ` +
          `no_url=${subgroupStats.no_url}`,
      );
    }

    //
    //    Insert into MongoDB (Layer 2 field dedup still runs here)
    //
    const mongoStats = {
      inserted: 0,
      skipped: 0,
      failed: 0,
    };

    for (const listing of totalFinalListings) {
      const result = await insertListing(listing);
      if (result === "inserted") mongoStats.inserted++;
      else if (result === "skipped") mongoStats.skipped++;
      else mongoStats.failed++;
    }

    logger.info("\nMongoDB import summary:");
    logger.info(`  Total listings: ${totalFinalListings.length}`);
    logger.info(`  Inserted:       ${mongoStats.inserted}`);
    logger.info(`  Skipped:        ${mongoStats.skipped}`);
    logger.info(`  Failed:         ${mongoStats.failed}`);
  } finally {
    await disconnectMongo();
  }
};

main();
