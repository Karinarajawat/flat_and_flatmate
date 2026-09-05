import { City } from "@/config/model";
import { geocode } from "@/service/geocoder";
import { LocalityModel, LocalityDoc } from "@/types/locality.model";
import { HydratedDocument } from "mongoose";

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface GetOrCreateLocalityParams {
  name: string;
  city: City;
}

/**
 * Checks if a locality exists in MongoDB for the given city.
 * If found, returns the existing document.
 * If not found, geocodes the locality, creates a new Locality document in MongoDB, and returns it.
 */
export async function getOrCreateLocality({
  name,
  city,
}: GetOrCreateLocalityParams): Promise<HydratedDocument<LocalityDoc>> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Locality name cannot be empty");
  }

  // 1. Check if locality already exists (case-insensitive match for the city)
  const existing = await LocalityModel.findOne({
    city,
    name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, "i") },
  });

  if (existing) {
    return existing;
  }

  // 2. Geocode the locality
  let coordinates = await geocode(`${trimmedName}, ${city}, India`);

  if (!coordinates) {
    // Fallback to city center if specific locality coordinates not found
    coordinates = await geocode(`${city}, India`);
  }

  if (!coordinates) {
    throw new Error(`Could not geocode locality "${trimmedName}" in "${city}"`);
  }

  // 3. Save new Locality document in MongoDB
  try {
    const newLocality = await LocalityModel.create({
      name: trimmedName,
      city,
      location: {
        type: "Point",
        coordinates: [coordinates.longitude, coordinates.latitude],
      },
    });

    return newLocality;
  } catch (error: unknown) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code: number }).code === 11000
    ) {
      const fallback = await LocalityModel.findOne({
        city,
        name: { $regex: new RegExp(`^${escapeRegex(trimmedName)}$`, "i") },
      });
      if (fallback) {
        return fallback;
      }
    }
    throw error;
  }
}
