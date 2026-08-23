import { FINAL_DATA_DIR, OFFERING_DATA_DIR } from "@/config/constants";
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
    finalDataDir: FINAL_DATA_DIR,
  },
} as const;
