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
