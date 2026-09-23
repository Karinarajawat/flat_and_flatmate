import mongoose from "mongoose";

import { ListingModel } from "@/types/listing.model";
import { Listing } from "@/types/listing";
import { ListingStatus } from "@/config/model";
import { toErrorMessage } from "@/utils";
import { logger } from "@/utils/logger";

export type InsertResult = "inserted" | "skipped" | "failed";

export async function connectMongo(): Promise<void> {
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) {
    throw new Error("MONGODB_URI is not defined");
  }

  await mongoose.connect(mongoUri);
  logger.info("Connected to MongoDB");
}

export async function disconnectMongo(): Promise<void> {
  await mongoose.disconnect();
  logger.info("Disconnected from MongoDB");
}

export async function listingExists(
  source: string,
  url: string,
): Promise<boolean> {
  const exists = await ListingModel.exists({
    "external_listing.source": source,
    "external_listing.url": url,
  } as never);

  return Boolean(exists);
}

export async function markListingStatus(
  source: string,
  url: string,
  status: ListingStatus,
): Promise<boolean> {
  try {
    const result = await ListingModel.updateOne(
      {
        "external_listing.source": source,
        "external_listing.url": url,
      } as never,
      { $set: { "data.status": status } },
    );

    return result.modifiedCount > 0;
  } catch (error) {
    logger.error(`Failed to mark ${url} as ${status}: ${toErrorMessage(error)}`);
    return false;
  }
}

export async function insertListing(listing: Listing): Promise<InsertResult> {
  const source = listing.external_listing?.source;
  const url = listing.external_listing?.url;

  if (!source || !url) {
    return "failed";
  }

  // Layer 1: URL dedup
  if (await listingExists(source, url)) {
    return "skipped";
  }

  // Layer 2: Field + author dedup (same-platform only)
  const locality = listing.data?.locality;
  if (locality) {
    const fieldMatch = await ListingModel.exists({
      "external_listing.source": source,
      "data.rent": listing.data?.rent,
      "data.bhk": listing.data?.bhk,
      "data.gender_preference": listing.data?.gender_preference,
      "external_listing.lister.name": listing.external_listing?.lister?.name,
      $or: [
        { "data.locality": locality },
        { "data.locality": { $regex: locality, $options: "i" } },
      ],
    } as never);

    if (fieldMatch) {
      return "skipped";
    }
  }

  const document = {
    data: {
      ...listing.data,
      images: listing.data?.images ?? [],
      status: listing.data?.status ?? "active",
      available_from: listing.data?.available_from
        ? new Date(listing.data.available_from as unknown as string)
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

  try {
    await ListingModel.create(document);
    return "inserted";
  } catch (error) {
    const message = toErrorMessage(error);
    if (message.includes("E11000") || message.includes("duplicate key")) {
      return "skipped";
    }
    return "failed";
  }
}
