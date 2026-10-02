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
  SERVICES_TYPES,
} from "@/config/model";

/* ------------------------------------------------ */
/* Location */
/* ------------------------------------------------ */

const locationSchema = new Schema(
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
  { _id: false },
);

/* ------------------------------------------------ */
/* Property */
/* ------------------------------------------------ */

const propertySchema = new Schema(
  {
    bhk: {
      type: String,
      required: true,
      enum: BHK_TYPES,
    },

    attached_washroom: {
      type: Boolean,
      default: false,
    },

    carpet_area: {
      type: Number,
      min: 0,
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
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* Rental Scope */
/* ------------------------------------------------ */

const rentalScopeSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: ["room", "hall"],
    },

    capacity: {
      type: Number,
      required: true,
      min: 1,
    },

    total_occupancy: {
      type: Number,
      required: true,
      min: 1,
    },
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* Pricing */
/* ------------------------------------------------ */

const pricingSchema = new Schema(
  {
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

    move_in_charges: {
      type: Number,
      min: 0,
    },
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* Availability */
/* ------------------------------------------------ */

const availabilitySchema = new Schema(
  {
    available_from: {
      type: Date,
    },

    available_immediately: {
      type: Boolean,
      required: true,
      default: false,
    },
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* Preferences */
/* ------------------------------------------------ */

const preferencesSchema = new Schema(
  {
    gender: {
      type: String,
      enum: GENDER_PREFERENCES,
    },
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* Add Ons */
/* ------------------------------------------------ */

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

/* ------------------------------------------------ */
/* Amenities */
/* ------------------------------------------------ */

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
  { _id: false },
);

/* ------------------------------------------------ */
/* House Rules */
/* ------------------------------------------------ */

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
  { _id: false },
);

/* ------------------------------------------------ */
/* Services */
/* ------------------------------------------------ */

const serviceSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: SERVICES_TYPES,
    },

    desc: {
      type: String,
    },

    price: {
      type: Number,
      min: 0,
    },

    included: {
      type: Boolean,
      default: false,
    },
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* Nearby Places */
/* ------------------------------------------------ */

const nearbyPlaceSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      enum: NEIGHBORHOOD_TYPES,
    },

    name: {
      type: String,
      required: true,
    },

    distance: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false },
);

/* ------------------------------------------------ */
/* External Listing */
/* ------------------------------------------------ */

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

    author: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
    },
  },
  { _id: false },
);

/* ================================================= */
/* LISTING */
/* ================================================= */

export const listingSchema = new Schema(
  {
    images: {
      type: [String],
      default: [],
    },

    cover_image: {
      type: String,
    },

    status: {
      type: String,
      required: true,
      enum: LISTING_STATUSES,
      default: "active",
    },

    property: {
      type: propertySchema,
      required: true,
    },

    rental_scope: {
      type: rentalScopeSchema,
      required: true,
    },

    pricing: {
      type: pricingSchema,
      required: true,
    },

    availability: {
      type: availabilitySchema,
      required: true,
    },

    preferences: {
      type: preferencesSchema,
    },

    services: {
      type: [serviceSchema],
      default: [],
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

    nearby_places: {
      type: [nearbyPlaceSchema],
      default: [],
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
  "property.location": "2dsphere",
});

listingSchema.index(
  { "external_listing.source": 1, "external_listing.url": 1 },
  { unique: true },
);

export type Listing = InferSchemaType<typeof listingSchema>;

export const ListingModel = model<Listing>("Listing", listingSchema);
