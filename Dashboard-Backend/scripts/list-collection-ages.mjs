import { getDb } from "../src/config/firebase.js";

const TIMESTAMP_FIELDS = ["created_at", "createdAt", "sent_at", "updated_at", "updatedAt", "date", "timestamp"];

function toDate(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === "function") return ts.toDate();
  if (ts instanceof Date) return ts;
  if (typeof ts === "number") return new Date(ts);
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof ts === "object" && typeof ts._seconds === "number") {
    return new Date(ts._seconds * 1000 + (ts._nanoseconds || 0) / 1e6);
  }
  return null;
}

async function findOldestByField(colRef, field) {
  try {
    const snap = await colRef.orderBy(field, "asc").limit(1).get();
    if (snap.empty) return null;
    const doc = snap.docs[0];
    const data = doc.data();
    const fieldVal = data[field];
    const fieldDate = toDate(fieldVal);
    const metaDate = doc.createTime?.toDate?.() ?? null;
    return {
      method: `field:${field}`,
      docId: doc.id,
      fieldDate,
      metaDate,
      oldest: fieldDate && metaDate ? (fieldDate < metaDate ? fieldDate : metaDate) : (fieldDate ?? metaDate),
    };
  } catch {
    return null;
  }
}

async function findOldestByScan(colRef, maxDocs = 5000) {
  let oldest = null;
  let scanned = 0;
  let lastDoc = null;
  const pageSize = 500;
  while (scanned < maxDocs) {
    let q = colRef.orderBy("__name__").limit(pageSize);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      scanned++;
      const metaDate = doc.createTime?.toDate?.() ?? null;
      if (!metaDate) continue;
      if (!oldest || metaDate < oldest.metaDate) {
        oldest = { method: "scan:createTime", docId: doc.id, metaDate, fieldDate: null, oldest: metaDate };
      }
    }
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.size < pageSize) break;
  }
  if (oldest) oldest.scanned = scanned;
  return oldest;
}

async function analyzeCollection(colRef) {
  const countSnap = await colRef.count().get();
  const count = countSnap.data().count;

  let result = null;
  for (const field of TIMESTAMP_FIELDS) {
    result = await findOldestByField(colRef, field);
    if (result?.oldest) break;
  }
  if (!result) {
    result = await findOldestByScan(colRef, count <= 5000 ? count : 5000);
    if (result && count > 5000) result.note = "sampled first 5000 docs by ID order";
  }

  return { id: colRef.id, count, ...result };
}

async function main() {
  const db = getDb();
  if (!db) {
    console.error("Failed to connect to Firestore.");
    process.exit(1);
  }

  try {
    db.settings({ preferRest: true });
  } catch {
    /* already initialized */
  }

  const collections = await db.listCollections();
  console.log(`Found ${collections.length} root collections\n`);

  const results = [];
  for (const col of collections) {
    process.stderr.write(`Analyzing ${col.id}...\n`);
    try {
      results.push(await analyzeCollection(col));
    } catch (err) {
      results.push({ id: col.id, count: null, error: err.message });
    }
  }

  const withDates = results.filter((r) => r.oldest instanceof Date);
  withDates.sort((a, b) => a.oldest - b.oldest);

  console.log("=== ALL COLLECTIONS (sorted oldest first) ===");
  for (const r of withDates) {
    console.log(
      JSON.stringify({
        collection: r.id,
        docCount: r.count,
        oldestApprox: r.oldest.toISOString(),
        method: r.method,
        sampleDocId: r.docId,
        note: r.note ?? undefined,
      }),
    );
  }

  const noDate = results.filter((r) => !(r.oldest instanceof Date));
  if (noDate.length) {
    console.log("\n=== COLLECTIONS WITHOUT DATE INFO ===");
    for (const r of noDate) {
      console.log(JSON.stringify({ collection: r.id, docCount: r.count, error: r.error }));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
