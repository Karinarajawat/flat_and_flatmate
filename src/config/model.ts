export const LISTING_STATUSES = [
  "active",
  "rented",
  "draft",
  "expired",
] as const;

export const CITIES = ["mumbai", "pune", "bangalore", "hyderabad"] as const;

export const GENDER_PREFERENCES = ["Male", "Female"] as const;

export const BHK_TYPES = ["1 RK", "1 BHK", "2 BHK", "3 BHK"] as const;

export const SERVICES_TYPES = [
  "cook",
  "maid",
  "housekeeping",
  "laundry",
  "other",
] as const;

export const FURNISHED_STATUSES = [
  "unfurnished",
  "semi-furnished",
  "fully-furnished",
] as const;

export const ADD_ON_TYPES = [
  // Appliances
  "Air Conditioning",
  "Refrigerator",
  "Washing Machine",
  "Microwave",
  "Oven",
  "Dishwasher",
  "TV",

  // Kitchen
  "Modular Kitchen",
  "Gas Stove",
  "Chimney",
  "Water Purifier",

  // Connectivity
  "WiFi",
  "Fiber Internet",

  // Room / Home Features
  "Attached Bathroom",
  "Geyser",
  "Balcony",
  "Private Terrace",
  "Walk-in Closet",
  "Furniture",

  "Others",
] as const;

export const AMENITY_TYPES = [
  // Building / Society
  "Clubhouse",
  "Swimming Pool",
  "Gym",
  "Garden",
  "Sports Facilities",
  "Indoor Games",
  "Jogging Track",

  // Security
  "24x7 Security",
  "CCTV",
  "Security Guard",
  "Gated Community",
  "Intercom",

  // Building Facilities
  "Lift",
  "Power Backup",
  "Water Supply",
  "Gas Pipeline",

  // Parking
  "Car Parking",
  "Bike Parking",
  "Visitor Parking",
  "Covered Parking",
  "EV Charging",

  // Other Society Facilities
  "Pet Area",

  "Others",
] as const;

export const HOUSE_RULE_TYPES = [
  // Smoking / Alcohol
  "No Smoking",
  "No Alcohol",

  // Food
  "Vegetarian Only",
  "Non-Vegetarian Allowed",
  "No Cooking",

  // Guests
  "Guests Allowed",
  "No Overnight Guests",
  "No Parties",

  // Pets
  "No Pets",
  "Pets Allowed",

  // Living
  "No Loud Music",
  "No Loud Noise",
  "No Subletting",

  // Other
  "Couples Only",
  "Students Only",
  "Working Professionals Only",

  "Others",
] as const;

export const NEIGHBORHOOD_TYPES = [
  "Railway Station",
  "Metro",
  "Bus Stop",
  "Airport",
] as const;

export const LISTING_SOURCES = ["app", "facebook", "reddit"] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type City = (typeof CITIES)[number];
export type GenderPreference = (typeof GENDER_PREFERENCES)[number];
export type BhkType = (typeof BHK_TYPES)[number];
export type FurnishedStatus = (typeof FURNISHED_STATUSES)[number];
export type AddOnType = (typeof ADD_ON_TYPES)[number];
export type AmenityType = (typeof AMENITY_TYPES)[number];
export type HouseRuleType = (typeof HOUSE_RULE_TYPES)[number];
export type NeighborhoodType = (typeof NEIGHBORHOOD_TYPES)[number];
export type ListingSource = (typeof LISTING_SOURCES)[number];
export type ServiceType = (typeof SERVICES_TYPES)[number];
