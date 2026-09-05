import {
  AMBIGUOUS_DATA_DIR,
  CLASSIFIED_DATA_DIR,
  FINAL_DATA_DIR,
  NOT_HOUSING_DATA_DIR,
  NOT_OFFERING_DATA_DIR,
  OFFERING_DATA_DIR,
  SEEKING_DATA_DIR,
} from "@/config/constants";
import dotenv from "dotenv";
dotenv.config();

export const config = {
  gemini: {
    api_key: process.env.GEMINI_API_KEY,
    max_retry_count: 5,
    base_delay: 5000,
  },

  storage: {
    offeringDataDir: OFFERING_DATA_DIR,
    notOfferingDataDir: NOT_OFFERING_DATA_DIR,
    seekingDataDir: SEEKING_DATA_DIR,
    ambiguousDataDir: AMBIGUOUS_DATA_DIR,
    notHousingDataDir: NOT_HOUSING_DATA_DIR,
    classifiedDataDir: CLASSIFIED_DATA_DIR,
    finalDataDir: FINAL_DATA_DIR,
  },
} as const;
