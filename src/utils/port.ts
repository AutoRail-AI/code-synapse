/**
 * Port availability checking utilities
 */

import * as net from "node:net";
import { createLogger } from "./logger.js";

const logger = createLogger("port");

/**
 * Check if a port is available
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolve(false);
      } else {
        // Other error, assume port is not available
        logger.warn({ err, port }, "Error checking port availability");
        resolve(false);
      }
    });

    server.once("listening", () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find an available port in the given range
 * @param startPort Starting port number
 * @param endPort Ending port number (inclusive)
 * @returns Available port number or null if none found
 */
export async function findAvailablePort(
  startPort: number,
  endPort: number
): Promise<number | null> {
  for (let port = startPort; port <= endPort; port++) {
    const available = await isPortAvailable(port);
    if (available) {
      logger.debug({ port }, "Found available port");
      return port;
    }
  }
  return null;
}

