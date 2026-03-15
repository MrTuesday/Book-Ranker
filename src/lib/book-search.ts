/**
 * Open Library search API client.
 * Free, no key required, good subject data and ratings.
 */

export type BookSearchResult = {
  title: string;
  authors: string[];
  genres: string[];
  description: string;
  starRating?: number;
  ratingCount?: number;
  infoUrl?: string;
  thumbnail?: string;
};

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  subject?: string[];
  first_publish_year?: number;
  ratings_average?: number;
  ratings_count?: number;
  cover_i?: number;
  number_of_pages_median?: number;
  edition_count?: number;
};

type OpenLibraryResponse = {
  numFound?: number;
  docs?: OpenLibraryDoc[];
};

// Subjects that are too generic to be useful as genre signals
const NOISE_SUBJECTS = new Set([
  "fiction",
  "literature",
  "general",
  "literary",
  "accessible book",
  "protected daisy",
  "in library",
  "large type books",
  "lending library",
  "overdrive",
  "reading",
  "books and reading",
  "nyt:combined-print-and-e-book-fiction",
  "new york times bestseller",
  "english fiction",
  "american fiction",
  "english language",
]);

function isUsefulSubject(s: string): boolean {
  const lower = s.toLowerCase();
  if (NOISE_SUBJECTS.has(lower)) return false;
  if (lower.startsWith("nyt:")) return false;
  if (lower.startsWith("large type")) return false;
  if (lower.length < 3 || lower.length > 60) return false;
  return true;
}

function coverUrl(coverId: number | undefined): string | undefined {
  if (!coverId) return undefined;
  return `https://covers.openlibrary.org/b/id/${coverId}-M.jpg`;
}

function workUrl(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return `https://openlibrary.org${key}`;
}

/**
 * Search Open Library by subject tags.
 * Does multiple targeted searches and merges/deduplicates results
 * to get a good pool of candidates at genre intersections.
 */
export async function searchBooks(
  tags: string[],
  maxResults = 40,
): Promise<BookSearchResult[]> {
  if (tags.length === 0) return [];

  const seen = new Set<string>();
  const allResults: BookSearchResult[] = [];

  // Strategy: do a combined subject query, plus individual queries, then merge.
  // This gives us books at the intersection AND books strongly in each genre.
  const queries: string[] = [];

  // Combined query: "subject:X subject:Y" finds books matching both
  if (tags.length >= 2) {
    queries.push(tags.map((t) => `subject:"${t}"`).join(" "));
  }

  // Individual subject queries for breadth
  for (const tag of tags) {
    queries.push(`subject:"${tag}"`);
  }

  // Run queries (combined first, then individuals, stop when we have enough)
  const perQuery = Math.ceil(maxResults / queries.length);

  for (const query of queries) {
    if (allResults.length >= maxResults) break;

    const limit = Math.min(perQuery + 5, maxResults - allResults.length + 5);
    const url = `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=${limit}&fields=key,title,author_name,subject,ratings_average,ratings_count,cover_i,first_publish_year,edition_count&sort=rating`;

    try {
      const response = await fetch(url);
      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited — wait briefly and skip this query
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        continue;
      }

      const data: OpenLibraryResponse = await response.json();
      if (!data.docs) continue;

      for (const doc of data.docs) {
        if (!doc.title) continue;

        // Deduplicate by title + first author
        const dedupeKey = `${doc.title.toLowerCase()}::${(doc.author_name?.[0] ?? "").toLowerCase()}`;
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);

        const subjects = (doc.subject ?? [])
          .filter(isUsefulSubject)
          .slice(0, 8); // cap subjects per book

        allResults.push({
          title: doc.title,
          authors: doc.author_name ?? [],
          genres: subjects,
          description: "",
          starRating: doc.ratings_average,
          ratingCount: doc.ratings_count,
          infoUrl: workUrl(doc.key),
          thumbnail: coverUrl(doc.cover_i),
        });

        if (allResults.length >= maxResults) break;
      }
    } catch {
      // Network error on this query — continue with others
      continue;
    }
  }

  return allResults;
}
