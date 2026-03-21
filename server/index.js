import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import http from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createBookRecord,
  deleteAuthorExperience,
  deleteBookRecord,
  deleteGenreInterest,
  getLibraryState,
  importLibraryState,
  renameAuthorExperience,
  renameAuthorInBooks,
  renameGenreInBooks,
  renameGenreInterest,
  updateBookRecord,
  writeAuthorExperience,
  writeGenreInterest,
} from "./lib/library-service.js";
import { createSeedState } from "./lib/seed-state.js";
import { JsonStateStore } from "./lib/state-store.js";
import { createGoodreadsClient } from "./lib/goodreads.js";
import { fetchPathRecommendations } from "./lib/recommendations.js";
import { HttpError, notFound, readJson, sendJson } from "./lib/http.js";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distDir = join(rootDir, "dist");
const dataFilePath =
  process.env.BOOK_RANKER_DATA_FILE ?? join(rootDir, "data", "library-state.json");
const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT) || 8787;

const stateStore = new JsonStateStore(dataFilePath, createSeedState);
const goodreadsClient = createGoodreadsClient();

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"],
]);

function decodePathSegment(value) {
  return decodeURIComponent(value ?? "").trim();
}

function getContentType(filePath) {
  return contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

async function serveFile(response, filePath) {
  try {
    await access(filePath);
  } catch {
    return false;
  }

  response.writeHead(200, {
    "Content-Type": getContentType(filePath),
  });
  createReadStream(filePath).pipe(response);
  return true;
}

async function serveFrontend(request, response, pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : pathname;
  const requestedPath = normalize(cleanPath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const absolutePath = join(distDir, requestedPath);

  if (await serveFile(response, absolutePath)) {
    return;
  }

  if (await serveFile(response, join(distDir, "index.html"))) {
    return;
  }

  sendJson(response, 404, {
    message: "Frontend build not found. Run `npm run build` first.",
  });
}

async function handleApi(request, response, url) {
  const path = url.pathname;

  if (request.method === "GET" && path === "/api/health") {
    return sendJson(response, 200, { status: "ok" });
  }

  if (request.method === "GET" && path === "/api/library") {
    return sendJson(response, 200, await getLibraryState(stateStore));
  }

  if (request.method === "POST" && path === "/api/library/import") {
    const body = await readJson(request);
    return sendJson(response, 200, await importLibraryState(stateStore, body));
  }

  if (request.method === "POST" && path === "/api/books") {
    const body = await readJson(request);
    return sendJson(response, 200, await createBookRecord(stateStore, body));
  }

  const bookMatch = path.match(/^\/api\/books\/(\d+)$/);
  if (bookMatch) {
    const bookId = Number(bookMatch[1]);

    if (request.method === "PUT") {
      const body = await readJson(request);
      return sendJson(response, 200, await updateBookRecord(stateStore, bookId, body));
    }

    if (request.method === "DELETE") {
      return sendJson(response, 200, await deleteBookRecord(stateStore, bookId));
    }
  }

  const genreMatch = path.match(/^\/api\/genre-interests\/(.+)$/);
  if (genreMatch) {
    const genre = decodePathSegment(genreMatch[1]);

    if (request.method === "PUT") {
      const body = await readJson(request);
      return sendJson(
        response,
        200,
        await writeGenreInterest(stateStore, genre, body?.interest),
      );
    }

    if (request.method === "DELETE") {
      return sendJson(response, 200, await deleteGenreInterest(stateStore, genre));
    }
  }

  if (request.method === "POST" && path === "/api/genre-interests/rename") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await renameGenreInterest(stateStore, body?.oldGenre, body?.newGenre),
    );
  }

  if (request.method === "POST" && path === "/api/books/genres/rename") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await renameGenreInBooks(stateStore, body?.oldGenre, body?.newGenre),
    );
  }

  const authorMatch = path.match(/^\/api\/author-experiences\/(.+)$/);
  if (authorMatch) {
    const author = decodePathSegment(authorMatch[1]);

    if (request.method === "PUT") {
      const body = await readJson(request);
      return sendJson(
        response,
        200,
        await writeAuthorExperience(stateStore, author, body?.experience),
      );
    }

    if (request.method === "DELETE") {
      return sendJson(response, 200, await deleteAuthorExperience(stateStore, author));
    }
  }

  if (request.method === "POST" && path === "/api/books/authors/rename") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await renameAuthorInBooks(stateStore, body?.oldAuthor, body?.newAuthor),
    );
  }

  if (request.method === "POST" && path === "/api/author-experiences/rename") {
    const body = await readJson(request);
    return sendJson(
      response,
      200,
      await renameAuthorExperience(stateStore, body?.oldAuthor, body?.newAuthor),
    );
  }

  if (request.method === "GET" && path === "/api/catalog/search") {
    const query = url.searchParams.get("query") ?? "";
    const limit = Number(url.searchParams.get("limit")) || 10;
    const results = await goodreadsClient.autocompleteBooksByTitle(query, {
      limit: Math.max(1, Math.min(8, limit)),
    });

    return sendJson(response, 200, {
      provider: goodreadsClient.provider,
      query,
      results,
    });
  }

  if (request.method === "POST" && path === "/api/catalog/book") {
    const body = await readJson(request);
    const result = await goodreadsClient.resolveBookMetadata(body);

    return sendJson(response, 200, {
      averageRating: result?.averageRating,
      ratingsCount: result?.ratingsCount,
      infoLink: result?.infoLink,
      fetchedAt: new Date().toISOString(),
    });
  }

  if (request.method === "POST" && path === "/api/recommendations/path") {
    const body = await readJson(request);
    return sendJson(response, 200, await fetchPathRecommendations(goodreadsClient, body));
  }

  notFound();
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    if (request.method === "GET" || request.method === "HEAD") {
      await serveFrontend(request, response, url.pathname);
      return;
    }

    throw new HttpError(405, "Method not allowed.");
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.status, { message: error.message });
      return;
    }

    const message =
      error instanceof Error && error.message ? error.message : "Internal server error.";
    sendJson(response, 500, { message });
  }
});

server.listen(port, host, () => {
  console.log(`Book Ranker backend listening on http://${host}:${port}`);
});
