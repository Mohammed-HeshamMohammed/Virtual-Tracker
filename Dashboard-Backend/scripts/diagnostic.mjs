import { getDb } from "../src/config/firebase.js";

async function main() {
  const db = getDb();
  if (!db) {
    console.error("Failed to connect to Firebase.");
    process.exit(1);
  }

  // 1. List root collections
  try {
    const collections = await db.listCollections();
    console.log("=== Root Collections ===");
    for (const col of collections) {
      console.log(`- ${col.id}`);
    }
  } catch (err) {
    console.error("Failed to list collections:", err.message);
  }

  // 2. Sample members
  try {
    const snap = await db.collection("members").limit(5).get();
    console.log("\n=== Members Sample ===");
    for (const doc of snap.docs) {
      console.log(`Doc ID: ${doc.id}`);
      console.log("Fields:", JSON.stringify(doc.data(), null, 2));
      
      // Check sub-collections
      const subCols = await doc.ref.listCollections();
      if (subCols.length > 0) {
        console.log("  Sub-collections:");
        for (const sub of subCols) {
          const subSnap = await sub.get();
          console.log(`    - ${sub.id} (${subSnap.size} docs)`);
        }
      }
    }
  } catch (err) {
    console.error("Failed to fetch members:", err.message);
  }

  // 3. Check members_roles root collection
  try {
    const snap = await db.collection("members_roles").limit(5).get();
    console.log(`\n=== members_roles Root Collection (${snap.size} docs sampled) ===`);
    for (const doc of snap.docs) {
      console.log(`Doc ID: ${doc.id}`, doc.data());
    }
  } catch (err) {
    console.warn("members_roles collection check failed:", err.message);
  }
}

main().catch(console.error);
