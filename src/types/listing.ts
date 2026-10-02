import { z } from "zod";

import {
  ADD_ON_TYPES,
  AddOnType,
  AMENITY_TYPES,
  AmenityType,
  BHK_TYPES,
  BhkType,
  CITIES,
  City,
  FURNISHED_STATUSES,
  FurnishedStatus,
  GENDER_PREFERENCES,
  GenderPreference,
  HOUSE_RULE_TYPES,
  HouseRuleType,
  LISTING_SOURCES,
  LISTING_STATUSES,
  ListingSource,
  ListingStatus,
  NEIGHBORHOOD_TYPES,
  NeighborhoodType,
  SERVICES_TYPES,
  ServiceType,
} from "@/config/model";

/* -------------------------------------------------------------------------- */
/* Location                                                                   */
/* -------------------------------------------------------------------------- */

export type Location = {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
};

export const locationSchema = z.object({
  type: z.literal("Point"),
  coordinates: z.tuple([z.number(), z.number()]),
});

/* -------------------------------------------------------------------------- */
/* Property                                                                   */
/* -------------------------------------------------------------------------- */

export type Property = {
  bhk: BhkType;
  attached_washroom: boolean;
  carpet_area?: number;
  furnished_status: FurnishedStatus;
  floor?: number;
  city: City;
  locality: string;
  address: string;
  location: Location;
};

export const propertySchema = z.object({
  bhk: z.enum(BHK_TYPES),
  attached_washroom: z.boolean(),
  carpet_area: z.number().min(0).optional(),
  furnished_status: z.enum(FURNISHED_STATUSES),
  floor: z.number().min(0).optional(),
  city: z.enum(CITIES),
  locality: z.string(),
  address: z.string(),
  location: locationSchema,
});

/* -------------------------------------------------------------------------- */
/* Rental Scope                                                               */
/* -------------------------------------------------------------------------- */

export type RentalScope = {
  type: "room" | "hall";
  capacity: number;
  total_occupancy?: number;
};

export const rentalScopeSchema = z.object({
  type: z.enum(["room", "hall"]),
  capacity: z.number().min(1),
  total_occupancy: z.number().min(1).optional(),
});

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

export type Pricing = {
  rent: number;
  deposit?: number;
  brokerage?: number;
  setup_cost?: number;
  move_in_charges?: number;
};

export const pricingSchema = z.object({
  rent: z.number().min(0),
  deposit: z.number().min(0).optional(),
  brokerage: z.number().min(0).optional(),
  setup_cost: z.number().min(0).optional(),
  move_in_charges: z.number().min(0).optional(),
});

/* -------------------------------------------------------------------------- */
/* Availability                                                               */
/* -------------------------------------------------------------------------- */

export type Availability = {
  available_from?: Date;
  available_immediately: boolean;
};

export const availabilitySchema = z.object({
  available_from: z.coerce.date().optional(),
  available_immediately: z.boolean(),
});

/* -------------------------------------------------------------------------- */
/* Preferences                                                                */
/* -------------------------------------------------------------------------- */

export type Preferences = {
  gender?: GenderPreference;
};

export const preferencesSchema = z.object({
  gender: z.enum(GENDER_PREFERENCES).optional(),
});

/* -------------------------------------------------------------------------- */
/* Add Ons                                                                    */
/* -------------------------------------------------------------------------- */

export type AddOn = {
  type: AddOnType;
  desc?: string;
};

export const addOnSchema = z.object({
  type: z.enum(ADD_ON_TYPES),
  desc: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Amenities                                                                  */
/* -------------------------------------------------------------------------- */

export type Amenity = {
  type: AmenityType;
  desc?: string;
};

export const amenitySchema = z.object({
  type: z.enum(AMENITY_TYPES),
  desc: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* House Rules                                                                */
/* -------------------------------------------------------------------------- */

export type HouseRule = {
  type: HouseRuleType;
  desc?: string;
};

export const houseRuleSchema = z.object({
  type: z.enum(HOUSE_RULE_TYPES),
  desc: z.string().optional(),
});

/* -------------------------------------------------------------------------- */
/* Services                                                                   */
/* -------------------------------------------------------------------------- */

export type Service = {
  type: ServiceType;
  desc?: string;
  price?: number;
  included?: boolean;
};

export const serviceSchema = z.object({
  type: z.enum(SERVICES_TYPES),
  desc: z.string().optional(),
  price: z.number().min(0).optional(),
  included: z.boolean().optional(),
});

/* -------------------------------------------------------------------------- */
/* Nearby Places                                                              */
/* -------------------------------------------------------------------------- */

export type NearbyPlace = {
  type: NeighborhoodType;
  name: string;
  distance: number;
};

export const nearbyPlaceSchema = z.object({
  type: z.enum(NEIGHBORHOOD_TYPES),
  name: z.string(),
  distance: z.number().min(0),
});

/* -------------------------------------------------------------------------- */
/* External Listing                                                           */
/* -------------------------------------------------------------------------- */

export type ExternalListing = {
  source: ListingSource;
  url: string;
  // Original post author for external listings.
  // lister_id is reserved for internal listings and left unset here.
  author: string;
};

export const externalListingSchema = z.object({
  source: z.enum(LISTING_SOURCES),
  url: z.string().url(),
  author: z.string().min(1),
});

/* -------------------------------------------------------------------------- */
/* Gemini Listing                                                             */
/* -------------------------------------------------------------------------- */
export type GeminiListingData = {
  property: Omit<Property, "location">;
  rental_scope: RentalScope;
  pricing: Pricing;
  availability: Availability;
  preferences?: Preferences;
  services: Service[];
  add_ons: AddOn[];
  amenities: Amenity[];
  house_rules: HouseRule[];
  nearby_places: Omit<NearbyPlace, "distance">[];
};

export const geminiListingDataSchema = z.object({
  property: z.object({
    bhk: z.enum(BHK_TYPES),
    attached_washroom: z.boolean(),
    carpet_area: z.number().min(0).optional(),
    furnished_status: z.enum(FURNISHED_STATUSES),
    floor: z.number().min(0).optional(),
    city: z.enum(CITIES),
    locality: z.string(),
    address: z.string(),
  }),

  rental_scope: rentalScopeSchema,

  pricing: pricingSchema,

  availability: availabilitySchema,

  preferences: preferencesSchema.optional(),

  services: z.array(serviceSchema),

  add_ons: z.array(addOnSchema),

  amenities: z.array(amenitySchema),

  house_rules: z.array(houseRuleSchema),

  nearby_places: z.array(
    z.object({
      type: z.enum(NEIGHBORHOOD_TYPES),
      name: z.string(),
    }),
  ),
});

/* -------------------------------------------------------------------------- */
/* Gemini Response                                                            */
/* -------------------------------------------------------------------------- */

export type GeminiListingResponse =
  | {
      skip: true;
    }
  | {
      skip: false;
      data: GeminiListingData;
    };

export const geminiListingResponseSchema = z.discriminatedUnion("skip", [
  z.object({
    skip: z.literal(true),
  }),

  z.object({
    skip: z.literal(false),
    data: geminiListingDataSchema,
  }),
]);

/* -------------------------------------------------------------------------- */
/* Gemini API JSON Schema (plain object for generationConfig.responseSchema)  */
/* Zod cannot be sent to the API, so this mirrors geminiListingDataSchema.   */
/* -------------------------------------------------------------------------- */

export const GeminiListingResponseSchema = {
  type: "object",
  properties: {
    skip: {
      type: "boolean",
    },

    data: {
      type: "object",
      properties: {
        property: {
          type: "object",
          properties: {
            bhk: { type: "string", enum: [...BHK_TYPES] },
            attached_washroom: { type: "boolean" },
            carpet_area: { type: "number" },
            furnished_status: {
              type: "string",
              enum: [...FURNISHED_STATUSES],
            },
            floor: { type: "number" },
            city: { type: "string", enum: [...CITIES] },
            locality: { type: "string", minLength: 1 },
            address: { type: "string" },
          },
          required: [
            "bhk",
            "attached_washroom",
            "furnished_status",
            "city",
            "locality",
            "address",
          ],
        },

        rental_scope: {
          type: "object",
          properties: {
            type: { type: "string", enum: ["room", "hall"] },
            capacity: { type: "number" },
            total_occupancy: { type: "number" },
          },
          required: ["type", "capacity"],
        },

        pricing: {
          type: "object",
          properties: {
            rent: { type: "number" },
            deposit: { type: "number" },
            brokerage: { type: "number" },
            setup_cost: { type: "number" },
            move_in_charges: { type: "number" },
          },
          required: ["rent"],
        },

        availability: {
          type: "object",
          properties: {
            available_from: {
              type: "string",
              description:
                "ISO 8601 date string. Omit when the availability date is unknown.",
            },
            available_immediately: { type: "boolean" },
          },
          required: ["available_immediately"],
        },

        preferences: {
          type: "object",
          properties: {
            gender: { type: "string", enum: [...GENDER_PREFERENCES] },
          },
          required: [],
        },

        services: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...SERVICES_TYPES] },
              desc: { type: "string" },
              price: { type: "number" },
              included: { type: "boolean" },
            },
            required: ["type"],
          },
        },

        add_ons: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...ADD_ON_TYPES] },
              desc: { type: "string" },
            },
            required: ["type"],
          },
        },

        amenities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...AMENITY_TYPES] },
              desc: { type: "string" },
            },
            required: ["type"],
          },
        },

        house_rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...HOUSE_RULE_TYPES] },
              desc: { type: "string" },
            },
            required: ["type"],
          },
        },

        nearby_places: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: [...NEIGHBORHOOD_TYPES] },
              name: { type: "string" },
            },
            required: ["type", "name"],
          },
        },
      },
      required: [
        "property",
        "rental_scope",
        "pricing",
        "availability",
        "services",
        "add_ons",
        "amenities",
        "house_rules",
        "nearby_places",
      ],
    },
  },

  required: ["skip"],
} as const;

/* Backwards-compatible aliases for existing parser imports. */
export const GeminiListingResponseZodSchema = geminiListingResponseSchema;

export type ListingDataFromGemeni = GeminiListingData;

export type ValidGeminiListing = Extract<
  z.infer<typeof geminiListingResponseSchema>,
  { skip: false }
>;

/* -------------------------------------------------------------------------- */
/* Final Listing                                                              */
/* -------------------------------------------------------------------------- */

export type Listing = {
  images: string[];
  cover_image?: string;
  status: ListingStatus;

  property: Property;
  rental_scope: RentalScope;
  pricing: Pricing;
  availability: Availability;
  preferences?: Preferences;

  services: Service[];
  add_ons: AddOn[];
  amenities: Amenity[];
  house_rules: HouseRule[];
  nearby_places: NearbyPlace[];

  views: number;
  favorites: number;

  external_listing?: ExternalListing;
  lister_id?: string;

  createdAt: Date;
  updatedAt: Date;
};

export const listingSchema = z.object({
  images: z.array(z.string()),
  cover_image: z.string().optional(),

  status: z.enum(LISTING_STATUSES),

  property: propertySchema,
  rental_scope: rentalScopeSchema,
  pricing: pricingSchema,
  availability: availabilitySchema,
  preferences: preferencesSchema.optional(),

  services: z.array(serviceSchema),
  add_ons: z.array(addOnSchema),
  amenities: z.array(amenitySchema),
  house_rules: z.array(houseRuleSchema),
  nearby_places: z.array(nearbyPlaceSchema),

  views: z.number().min(0),
  favorites: z.number().min(0),

  external_listing: externalListingSchema.optional(),
  lister_id: z.string().optional(),

  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
