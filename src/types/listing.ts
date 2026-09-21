import {
  AddOnType,
  AmenityType,
  BhkType,
  City,
  FurnishedStatus,
  GenderPreference,
  HouseRuleType,
  ListingSource,
  ListingStatus,
  NeighborhoodType,
  OccupancyType,
  ADD_ON_TYPES,
  AMENITY_TYPES,
  BHK_TYPES,
  CITIES,
  FURNISHED_STATUSES,
  GENDER_PREFERENCES,
  HOUSE_RULE_TYPES,
  NEIGHBORHOOD_TYPES,
  OCCUPANCY_TYPES,
} from "@/config/model";
import { z } from "zod";

export type Location = {
  type: "Point";
  coordinates: [number, number];
};

export type AddOn = {
  type: AddOnType;
  desc?: string;
};

export type Amenity = {
  type: AmenityType;
  desc?: string;
};

export type HouseRule = {
  type: HouseRuleType;
  desc?: string;
};

export type Neighborhood = {
  type: NeighborhoodType;
  distance: number;
};

export type ExternalLister = {
  name: string;
  age?: number;
  profile_pic?: string;
  contact_number?: string;
  life_style: string[];
};

export type ExternalListing = {
  source: ListingSource;
  url: string;
  lister: ExternalLister;
};

export type ListingDataFromGemeni = {
  title: string;

  carpet_area?: number;

  city: City;
  locality: string;
  address: string;

  gender_preference: GenderPreference;

  bhk: BhkType;

  occupancy: OccupancyType;

  total_occupancy?: number;

  furnished_status: FurnishedStatus;

  floor?: number;

  add_ons: AddOn[];
  amenities: Amenity[];
  house_rules: HouseRule[];
  neighborhood: Neighborhood[];

  rent: number;

  deposit?: number;
  brokerage?: number;
  setup_cost?: number;

  available_from?: Date;

  available_immediately: boolean;
};

export type GeminiListingResponse =
  | {
      skip: true;
    }
  | {
      skip: false;
      data: ListingDataFromGemeni;
      lister: {
        name: string;
        age?: number;
        profile_pic?: string;
        contact_number?: string;
        life_style: string[];
      };
    };

export type ListingData = ListingDataFromGemeni & {
  location: Location;

  images: string[];
  cover_image?: string;

  status: ListingStatus;
};

export type Listing = {
  data: ListingData;
  external_listing?: ExternalListing;
  lister_id?: string;

  views: number;
  favorites: number;
};

export const GeminiListingResponseSchema = {
  type: "object",
  properties: {
    skip: {
      type: "boolean",
    },

    data: {
      type: "object",
      properties: {
        title: {
          type: "string",
        },

        carpet_area: {
          type: "number",
        },

        city: {
          type: "string",
          enum: [...CITIES],
        },

        locality: {
          type: "string",
          minLength: 1,
        },

        address: {
          type: "string",
        },

        gender_preference: {
          type: "string",
          enum: [...GENDER_PREFERENCES],
        },

        bhk: {
          type: "string",
          enum: [...BHK_TYPES],
        },

        occupancy: {
          type: "string",
          enum: [...OCCUPANCY_TYPES],
        },

        total_occupancy: {
          type: "number",
        },

        furnished_status: {
          type: "string",
          enum: [...FURNISHED_STATUSES],
        },

        floor: {
          type: "number",
        },

        add_ons: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [...ADD_ON_TYPES],
              },
              desc: {
                type: "string",
              },
            },
            required: ["type"],
          },
        },

        amenities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [...AMENITY_TYPES],
              },
              desc: {
                type: "string",
              },
            },
            required: ["type"],
          },
        },

        house_rules: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [...HOUSE_RULE_TYPES],
              },
              desc: {
                type: "string",
              },
            },
            required: ["type"],
          },
        },

        neighborhood: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: {
                type: "string",
                enum: [...NEIGHBORHOOD_TYPES],
              },
              distance: {
                type: "number",
              },
            },
            required: ["type", "distance"],
          },
        },

        rent: {
          type: "number",
          exclusiveMinimum: 0,
        },

        deposit: {
          type: "number",
        },

        brokerage: {
          type: "number",
        },

        setup_cost: {
          type: "number",
        },

        available_from: {
          type: "string",
          description:
            "ISO 8601 date string. Omit when the availability date is unknown.",
        },

        available_immediately: {
          type: "boolean",
        },
      },

      required: [
        "title",
        "city",
        "locality",
        "address",
        "gender_preference",
        "bhk",
        "occupancy",
        "furnished_status",
        "add_ons",
        "amenities",
        "house_rules",
        "neighborhood",
        "rent",
        "available_immediately",
      ],
    },

    lister: {
      type: "object",
      properties: {
        name: {
          type: "string",
        },

        age: {
          type: "number",
        },

        profile_pic: {
          type: "string",
        },

        contact_number: {
          type: "string",
        },

        life_style: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },

      required: [],
    },
  },

  required: ["skip"],
} as const;

export const GeminiListingResponseZodSchema = z.discriminatedUnion("skip", [
  // Skipped listing
  z.object({
    skip: z.literal(true),
  }),

  // Valid listing
  z.object({
    skip: z.literal(false),

    data: z.object({
      title: z.string(),

      carpet_area: z.number().optional(),

      city: z.enum(CITIES),

      locality: z.string().min(1),

      address: z.string(),

      gender_preference: z.enum(GENDER_PREFERENCES),

      bhk: z.enum(BHK_TYPES),

      occupancy: z.enum(OCCUPANCY_TYPES),

      total_occupancy: z.number().optional(),

      furnished_status: z.enum(FURNISHED_STATUSES),

      floor: z.number().optional(),

      add_ons: z.array(
        z.object({
          type: z.enum(ADD_ON_TYPES),
          desc: z.string().optional(),
        }),
      ),

      amenities: z.array(
        z.object({
          type: z.enum(AMENITY_TYPES),
          desc: z.string().optional(),
        }),
      ),

      house_rules: z.array(
        z.object({
          type: z.enum(HOUSE_RULE_TYPES),
          desc: z.string().optional(),
        }),
      ),

      neighborhood: z.array(
        z.object({
          type: z.enum(NEIGHBORHOOD_TYPES),
          distance: z.number(),
        }),
      ),

      rent: z.number().positive(),

      deposit: z.number().optional(),

      brokerage: z.number().optional(),

      setup_cost: z.number().optional(),

      available_from: z.string().optional(),

      available_immediately: z.boolean(),
    }),

    lister: z
      .object({
        name: z.string().optional(),

        age: z.number().optional(),

        profile_pic: z.string().optional(),

        contact_number: z.string().optional(),

        life_style: z.array(z.string()).optional(),
      })
      .optional(),
  }),
]);

export type ValidGeminiListing = Extract<
  z.infer<typeof GeminiListingResponseZodSchema>,
  { skip: false }
>;
