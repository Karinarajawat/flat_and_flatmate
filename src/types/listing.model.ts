import { InferSchemaType, Schema, model } from "mongoose";

import {
  ADD_ON_TYPES,
  AMENITY_TYPES,
  BHK_TYPES,
  CITIES,
  FURNISHED_STATUSES,
  GENDER_PREFERENCES,
  HOUSE_RULE_TYPES,
  LISTING_SOURCES,
  LISTING_STATUSES,
  NEIGHBORHOOD_TYPES,
  OCCUPANCY_TYPES,
} from "@/config/model";

type Location = {
  type: "Point";
  coordinates: [number, number];
};

const locationSchema = new Schema<Location>(
  {
    type: {
      type: String,
      enum: ["Point"],
      required: true,
      default: "Point",
    },

    coordinates: {
      type: [Number],
      required: true,
      validate: {
        validator: (value: number[]) => value.length === 2,
        message: "Coordinates must contain exactly [longitude, latitude]",
      },
    },
  },
  {
    _id: false,
  },
);

const addOnSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ADD_ON_TYPES,
    },

    desc: {
      type: String,
    },
  },
  {
    _id: false,
  },
);

const amenitySchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: AMENITY_TYPES,
    },

    desc: {
      type: String,
    },
  },
  {
    _id: false,
  },
);

const houseRuleSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: HOUSE_RULE_TYPES,
    },

    desc: {
      type: String,
    },
  },
  {
    _id: false,
  },
);

const neighborhoodSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: NEIGHBORHOOD_TYPES,
    },

    distance: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  {
    _id: false,
  },
);

const listingDataSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    images: {
      type: [String],
      required: true,
      default: [],
    },

    cover_image: {
      type: String,
    },

    carpet_area: {
      type: Number,
      min: 0,
    },

    status: {
      type: String,
      required: true,
      enum: LISTING_STATUSES,
      default: "active",
    },

    city: {
      type: String,
      required: true,
      enum: CITIES,
    },

    locality: {
      type: String,
      required: true,
      trim: true,
    },

    address: {
      type: String,
      required: true,
      trim: true,
    },

    location: {
      type: locationSchema,
      required: true,
    },

    gender_preference: {
      type: String,
      required: true,
      enum: GENDER_PREFERENCES,
    },

    bhk: {
      type: String,
      required: true,
      enum: BHK_TYPES,
    },

    occupancy: {
      type: String,
      enum: OCCUPANCY_TYPES,
      required: true,
    },

    total_occupancy: {
      type: Number,
      min: 1,
    },

    furnished_status: {
      type: String,
      required: true,
      enum: FURNISHED_STATUSES,
    },

    floor: {
      type: Number,
      min: 0,
    },

    add_ons: {
      type: [addOnSchema],
      default: [],
    },

    amenities: {
      type: [amenitySchema],
      default: [],
    },

    house_rules: {
      type: [houseRuleSchema],
      default: [],
    },

    neighborhood: {
      type: [neighborhoodSchema],
      default: [],
    },

    rent: {
      type: Number,
      required: true,
      min: 0,
    },

    deposit: {
      type: Number,
      min: 0,
    },

    brokerage: {
      type: Number,
      min: 0,
    },

    setup_cost: {
      type: Number,
      min: 0,
    },

    available_from: {
      type: Date,
    },

    available_immediately: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  {
    _id: false,
  },
);

const externalListerSchema = new Schema(
  {
    name: {
      type: String,
      required: true,
    },

    age: {
      type: Number,
      min: 0,
    },

    profile_pic: {
      type: String,
    },

    contact_number: {
      type: String,
    },

    life_style: {
      type: [String],
      default: [],
    },
  },
  {
    _id: false,
  },
);

const externalListingSchema = new Schema(
  {
    source: {
      type: String,
      enum: LISTING_SOURCES,
      required: true,
    },

    url: {
      type: String,
      required: true,
    },

    lister: {
      type: externalListerSchema,
      required: true,
    },
  },
  {
    _id: false,
  },
);

export const listingSchema = new Schema(
  {
    data: {
      type: listingDataSchema,
      required: true,
    },

    views: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    favorites: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },

    external_listing: {
      type: externalListingSchema,
    },

    lister_id: {
      type: String,
    },
  },
  {
    timestamps: true,
  },
);

listingSchema.index({
  "data.location": "2dsphere",
});

listingSchema.index(
  { "external_listing.source": 1, "external_listing.url": 1 },
  { unique: true },
);

export type Listing = InferSchemaType<typeof listingSchema>;

export const ListingModel = model<Listing>("Listing", listingSchema);
