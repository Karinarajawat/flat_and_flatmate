import { City } from "@/config/model";
import { Types } from "mongoose";

export type LocalityLocation = {
  type: "Point";
  coordinates: [number, number]; // [longitude, latitude]
};

export type Locality = {
  _id?: Types.ObjectId | string;
  name: string;
  city: City;
  location: LocalityLocation;
  createdAt?: Date;
  updatedAt?: Date;
};
