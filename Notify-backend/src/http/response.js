export function sendJson(res, origin, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
  });
  res.end(payload);
}
