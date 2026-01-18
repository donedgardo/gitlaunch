import { MongoClient } from "mongodb";

// Hardcoded to localhost only - DO NOT use environment variables
// This prevents accidentally resetting a production database
const MONGODB_URI = "mongodb://localhost:27017";
const DB_NAME = "gitlaunch";

async function resetDatabase() {
  const client = new MongoClient(MONGODB_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    // Get all collections
    const collections = await db.listCollections().toArray();

    if (collections.length === 0) {
      console.log("Database is already empty.");
      return;
    }

    console.log(
      `Dropping ${collections.length} collections from ${DB_NAME}...`,
    );

    // Drop all collections
    for (const collection of collections) {
      await db.dropCollection(collection.name);
      console.log(`  - Dropped: ${collection.name}`);
    }

    console.log("\nDatabase reset complete!");
  } catch (error) {
    console.error("Error resetting database:", error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

resetDatabase();
