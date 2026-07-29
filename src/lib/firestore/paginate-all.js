// Generic real pagination for full-collection Firestore scans that previously
// used a hardcoded `.limit(N)` ceiling (silently dropping rows past N instead
// of erroring). Orders by document ID, which every collection/query supports
// regardless of its own fields, so this works as a drop-in replacement for
// `query.limit(N).get()` -> `fetchAllDocs(query)`.
export async function fetchAllDocs(queryOrCollectionRef, pageSize = 1000) {
  const docs = [];
  let last = null;
  for (;;) {
    let q = queryOrCollectionRef.orderBy("__name__").limit(pageSize);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    docs.push(...snap.docs);
    if (snap.docs.length < pageSize) break;
    last = snap.docs[snap.docs.length - 1];
  }
  return docs;
}
