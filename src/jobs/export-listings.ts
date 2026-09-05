import "dotenv/config";

import fs from "fs/promises";
import path from "path";
import mongoose from "mongoose";

import { ListingModel } from "@/types/listing.model";
import { Listing } from "@/types/listing";
import { getOrCreateLocality } from "@/service/locality";
import { connectDb, disconnectDb } from "@/storage/db";

const main = async () => {
  const inputFiles = process.argv.slice(2);

  if (inputFiles.length === 0) {
    console.error(
      "Usage: npm run import:listings -- <file1.json> <file2.json> ...",
    );
    process.exit(1);
  }

  console.log(`Found ${inputFiles.length} input file(s).`);

  await connectDb();

  const stats = {
    files: 0,
    listings: 0,
    inserted: 0,
    skipped: 0,
    failed: 0,
  };

  try {
    for (const inputFile of inputFiles) {
      const resolvedPath = path.resolve(inputFile);
      const filename = path.basename(inputFile);

      console.log(`\nImporting: ${filename}`);

      let listings: Listing[];

      try {
        const raw = await fs.readFile(resolvedPath, "utf8");
        const parsed: unknown = JSON.parse(raw);

        if (!Array.isArray(parsed)) {
          console.error(`Skipping ${filename}: expected a JSON array.`);
          stats.failed++;
          continue;
        }

        listings = parsed as Listing[];
      } catch (error) {
        console.error(
          `Failed to read ${filename}:`,
          error instanceof Error ? error.message : String(error),
        );

        stats.failed++;
        continue;
      }

      console.log(`Loaded ${listings.length} listings.`);

      stats.files++;
      stats.listings += listings.length;

      for (const listing of listings) {
        try {
          const externalListing = listing.external_listing;

          if (!externalListing?.source || !externalListing.url) {
            console.warn("↷ Skipping listing without external listing URL.");
            stats.skipped++;
            continue;
          }

          const existing = await ListingModel.exists({
            "external_listing.source": externalListing.source,
            "external_listing.url": externalListing.url,
          });

          if (existing) {
            console.log(`↷ Already exists: ${externalListing.url}`);
            stats.skipped++;
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
              images: listing.data.images ?? [],
              status: listing.data.status ?? "active",
              available_from: listing.data.available_from
                ? new Date(listing.data.available_from)
                : undefined,
            },

            external_listing: {
              ...externalListing,

              lister: {
                ...externalListing.lister,
                life_style: externalListing.lister?.life_style ?? [],
              },
            },

            views: listing.views ?? 0,
            favorites: listing.favorites ?? 0,
          };

          await ListingModel.create(document);

          stats.inserted++;

          console.log(`✓ Inserted: ${listing.data.title}`);
        } catch (error) {
          stats.failed++;

          console.error(
            `✗ Failed: ${listing.data?.title ?? "unknown listing"}`,
          );

          console.error(error instanceof Error ? error.message : String(error));
        }
      }

      console.log(`Finished: ${filename}`);
    }
  } finally {
    await disconnectDb();
  }

  console.log("\n========== Import Complete ==========");
  console.log(`Files:     ${stats.files}`);
  console.log(`Listings:  ${stats.listings}`);
  console.log(`Inserted:  ${stats.inserted}`);
  console.log(`Skipped:   ${stats.skipped}`);
  console.log(`Failed:    ${stats.failed}`);
};

main().catch((error) => {
  console.error("\nImport job failed:");
  console.error(error instanceof Error ? error.message : String(error));

  process.exit(1);
});
