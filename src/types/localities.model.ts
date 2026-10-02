import { Schema, model } from "mongoose";

const localitySchema = new Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    city: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },

    location: {
      type: {
        type: String,
        enum: ["Point"],
        required: true,
      },

      coordinates: {
        type: [Number],
        required: true,
      },
    },
  },
  {
    timestamps: true,
  },
);

localitySchema.index({ location: "2dsphere" });
localitySchema.index({ name: 1, city: 1 }, { unique: true });

export interface Locality {
  name: string;
  city: string;
  location: {
    type: "Point";
    coordinates: [number, number];
  };
}

export const LocalityModel = model<Locality>("Locality", localitySchema);
