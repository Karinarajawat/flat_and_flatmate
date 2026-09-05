import { InferSchemaType, Schema, model } from "mongoose";
import { CITIES } from "@/config/model";

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

export const localitySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      enum: CITIES,
    },

    location: {
      type: locationSchema,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

// Compound unique index for locality name per city
localitySchema.index({ name: 1, city: 1 }, { unique: true });

// Geospatial index on coordinates
localitySchema.index({ location: "2dsphere" });

export type LocalityDoc = InferSchemaType<typeof localitySchema>;

export const LocalityModel = model<LocalityDoc>("Locality", localitySchema);
