import fs from "fs/promises";
import path from "path";

import { parsePost } from "@/parsing/parser";
import { writeFinalData, writeOfferingData } from "@/storage/storage";
import { Listing } from "@/types/listing";
import { RawPost } from "@/types/post";

const main = async () => {
  const jobTimestamp = Date.now();

  const inputFiles = process.argv.slice(2);

  if (inputFiles.length === 0) {
    console.error("Usage: npm run parse -- <file1.json> <file2.json> ...");
    process.exit(1);
  }

  console.log(`Found ${inputFiles.length} input file(s).`);

  for (const inputFile of inputFiles) {
    const inputFilename = path.basename(inputFile, ".json");

    console.log(`\nParsing ${inputFilename}...`);

    try {
      const content = await fs.readFile(inputFile, "utf8");

      const parsed: unknown = JSON.parse(content);

      if (!Array.isArray(parsed)) {
        console.log(`Skipping ${inputFilename}: expected JSON array.`);
        continue;
      }

      const posts = parsed as RawPost[];

      if (posts.length === 0) {
        console.log(`Skipping ${inputFilename}: no posts.`);
        continue;
      }

      const offeringPosts: RawPost[] = [];
      const finalListings: Listing[] = [];

      const stats = {
        total: 0,
        heuristic_valid: 0,
        llm_skipped: 0,
        success: 0,
        failed: 0,
      };

      for (const post of posts) {
        stats.total++;

        const result = await parsePost(post);

        if (result.listingType === "offering_room") {
          stats.heuristic_valid++;
          offeringPosts.push(post);
        }

        if (result.status === "success" && result.listing) {
          stats.success++;
          finalListings.push(result.listing);
        }

        if (result.status === "llm_skipped") {
          stats.llm_skipped++;
        }

        if (result.status === "failed") {
          stats.failed++;
        }

        console.log(
          `Processed [${stats.total}/${posts.length}] ` +
            `${post.platform}-${inputFilename}: ` +
            `${result.listingType} ${result.status}` +
            `${result.error ? ` Error: ${result.error}` : ""}`,
        );
      }

      const outputName = `${inputFilename}-${jobTimestamp}`;

      const offeringOutputPath = await writeOfferingData(
        outputName,
        offeringPosts,
      );

      const finalOutputPath = await writeFinalData(outputName, finalListings);

      console.log(
        `\n${inputFilename} complete:` +
          `\n  Total: ${stats.total}` +
          `\n  Heuristic valid: ${stats.heuristic_valid}` +
          `\n  LLM skipped: ${stats.llm_skipped}` +
          `\n  Success: ${stats.success}` +
          `\n  Failed: ${stats.failed}`,
      );

      console.log(`Offering: ${offeringOutputPath}`);
      console.log(`Final: ${finalOutputPath}\n`);
    } catch (error) {
      console.error(
        `Failed to parse ${inputFile}:`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log("Post parsing complete.");
};

main().catch((error) => {
  console.error(
    "Parse posts job failed:",
    error instanceof Error ? error.message : String(error),
  );

  process.exit(1);
});
