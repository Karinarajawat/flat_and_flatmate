import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

let sigintRegistered = false;

export async function connectDb(customUri?: string): Promise<typeof mongoose> {
  if (mongoose.connection.readyState === 1) {
    return mongoose;
  }

  const mongoUri = customUri || process.env.MONGODB_URI;

  if (!mongoUri) {
    throw new Error("MONGODB_URI environment variable is not defined");
  }

  try {
    console.log("Connecting to MongoDB...");
    const conn = await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 15_000,
      socketTimeoutMS: 45_000,
    });

    console.log("Connected to MongoDB successfully");

    if (!sigintRegistered) {
      const handleShutdown = async (signal: string) => {
        console.log(`\nReceived ${signal}. Safely disconnecting from MongoDB...`);
        await disconnectDb();
        process.exit(0);
      };

      process.once("SIGINT", () => handleShutdown("SIGINT"));
      process.once("SIGTERM", () => handleShutdown("SIGTERM"));
      sigintRegistered = true;
    }

    return conn;
  } catch (error) {
    console.error(
      "Failed to connect to MongoDB:",
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    try {
      await mongoose.disconnect();
      console.log("Safely disconnected from MongoDB");
    } catch (error) {
      console.error(
        "Error while disconnecting from MongoDB:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
