import { RedditClient } from "@/reddit/client";
import { fetchPostWithComments } from "@/reddit/comments";
import { extractPostId, TAKEN_RE } from "@/reddit/utils";
import { getRedditDeletionReason } from "@/parsing/deletion";
import {
  connectMongo,
  disconnectMongo,
  markListingStatus,
} from "@/storage/mongo";
import { ListingModel } from "@/types/listing.model";
import { logger } from "@/utils/logger";
import { toErrorMessage } from "@/utils/utils";

const main = async () => {
  await connectMongo();

  try {
    const listings = await ListingModel.find({
      "external_listing.source": "reddit",
      status: "active",
    }).lean();

    console.log(`Found ${listings.length} active Reddit listings to recheck\n`);

    const client = new RedditClient();

    const stats = {
      checked: 0,
      expired: 0,
      rented: 0,
      unchanged: 0,
      errors: 0,
    };

    for (const listing of listings) {
      const url = listing.external_listing?.url;
      const listerName = listing.external_listing?.author ?? undefined;

      if (!url) {
        stats.errors++;
        continue;
      }

      const postId = extractPostId(url);

      if (!postId) {
        console.warn(`Could not extract postId from: ${url}`);
        stats.errors++;
        continue;
      }

      try {
        const { post, comments } = await fetchPostWithComments(client, postId);
        const deletionReason = getRedditDeletionReason(post.data);

        if (deletionReason) {
          console.log(`EXPIRED (${deletionReason}): ${url}`);
          await markListingStatus("reddit", url, "expired");
          stats.expired++;
          continue;
        }

        // Check OP comments for "taken" signals
        const author = post.data.author;
        if (listerName || author) {
          const opComments = comments.filter(
            (c) => c.author === listerName || c.author === author,
          );

          const takenComment = opComments.find((c) => TAKEN_RE.test(c.body));

          if (takenComment) {
            console.log(
              `RENTED (OP comment by ${takenComment.author}): ${url}`,
            );
            await markListingStatus("reddit", url, "rented");
            stats.rented++;
            continue;
          }
        }

        stats.unchanged++;
      } catch (error) {
        const message = toErrorMessage(error);

        // 404 means post was deleted since we last scraped it
        if (message.includes("404") || message.includes("not found")) {
          logger.info(`EXPIRED (404): ${url}`);
          await markListingStatus("reddit", url, "expired");
          stats.expired++;
          continue;
        }

        logger.error(`Error rechecking ${url}: ${message}`);
        stats.errors++;
      }

      stats.checked++;

      // Rate limit: 3 seconds between requests
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    console.log("\nRecheck complete:");
    console.log(`  Checked:   ${stats.checked}`);
    console.log(`  Expired:   ${stats.expired}`);
    console.log(`  Rented:    ${stats.rented}`);
    console.log(`  Unchanged: ${stats.unchanged}`);
    console.log(`  Errors:    ${stats.errors}`);
  } finally {
    await disconnectMongo();
  }
};

main();
