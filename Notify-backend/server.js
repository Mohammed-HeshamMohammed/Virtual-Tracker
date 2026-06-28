import { createServer as createHttpServer } from "node:http";
import { handleRequest } from "./src/app/handle-request.js";

export function createServer() {
  return createHttpServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      console.error("[server] Unhandled error:", err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: "Internal server error" }));
      }
    });
  });
}
