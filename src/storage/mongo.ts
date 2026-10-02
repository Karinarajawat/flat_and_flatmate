import mongoose from "mongoose";

import { ListingModel } from "@/types/listing.model";
import { LocalityModel } from "@/types/localities.model";
import { Listing } from "@/types/listing";
import { ListingStatus } from "@/config/model";
import { resolveCoordinates } from "@/service/geocoder";
import { toErrorMessage } from "@/utils/utils";
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
      { $set: { status } },
    );

    return result.modifiedCount > 0;
  } catch (error) {
    logger.error(
      `Failed to mark ${url} as ${status}: ${toErrorMessage(error)}`,
    );
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
  const locality = listing.property?.locality;
  if (locality) {
    const fieldMatch = await ListingModel.exists({
      "external_listing.source": source,
      "pricing.rent": listing.pricing?.rent,
      "property.bhk": listing.property?.bhk,
      "preferences.gender": listing.preferences?.gender,
      "external_listing.author": listing.external_listing?.author,
      $or: [
        { "property.locality": locality },
        { "property.locality": { $regex: locality, $options: "i" } },
      ],
    } as never);

    if (fieldMatch) {
      return "skipped";
    }
  }

  // Locality check-or-create (blocking): reuse case-insensitive lookup,
  // otherwise geocode fresh and insert. Failure blocks the listing.
  const localityOk = await ensureLocality(listing);
  if (!localityOk) {
    logger.error(
      `Failed to ensure locality ${listing.property?.locality}, ${listing.property?.city}: blocking insert`,
    );
    return "failed";
  }

  const document = {
    ...listing,
    images: listing.images ?? [],
    status: listing.status ?? "active",
    availability: {
      ...listing.availability,
      available_from: listing.availability?.available_from
        ? new Date(listing.availability.available_from as unknown as string)
        : undefined,
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

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Ensure the listing's locality exists in the Locality collection.
 * Case-insensitive match on {name, city}; on miss, geocode fresh via
 * Nominatim and create the entry. Returns true when the locality is
 * present (or newly created / raced), false when blocking the insert.
 */
async function ensureLocality(listing: Listing): Promise<boolean> {
  const name = listing.property?.locality?.trim();
  const city = listing.property?.city?.trim();

  if (!name || !city) {
    return false;
  }

  try {
    const existing = await LocalityModel.exists({
      city: city.toLowerCase(),
      name: { $regex: `^${escapeRegExp(name)}$`, $options: "i" },
    } as never);

    if (existing) {
      return true;
    }

    const coordinates = await resolveCoordinates({
      address: listing.property?.address,
      locality: name,
      city,
    });

    if (!coordinates) {
      logger.error(`Geocode failed for locality ${name}, ${city}`);
      return false;
    }

    try {
      await LocalityModel.create({
        name,
        city: city.toLowerCase(),
        location: {
          type: "Point",
          coordinates: [coordinates.longitude, coordinates.latitude],
        },
      });
    } catch (error) {
      const message = toErrorMessage(error);
      // Race: another worker created it between lookup and create.
      if (message.includes("E11000") || message.includes("duplicate key")) {
        return true;
      }
      logger.error(
        `Failed to create locality ${name}, ${city}: ${message}`,
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error(
      `Failed to ensure locality ${name}, ${city}: ${toErrorMessage(error)}`,
    );
    return false;
  }
}
