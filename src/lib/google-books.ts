export type GoogleBooksResult = {
  title: string;
  authors: string[];
  genres: string[];
  description: string;
  starRating?: number;
  ratingCount?: number;
  googleBooksUrl?: string;
  thumbnail?: string;
};

type VolumeInfo = {
  title?: string;
  authors?: string[];
  categories?: string[];
  description?: string;
  averageRating?: number;
  ratingsCount?: number;
  infoLink?: string;
  imageLinks?: {
    smallThumbnail?: string;
    thumbnail?: string;
  };
};

type GoogleBooksResponse = {
  totalItems?: number;
  items?: Array<{
    volumeInfo?: VolumeInfo;
  }>;
};

/**
 * Search Google Books API by genre/topic tags.
 * No API key required for basic queries (rate-limited).
 */
export async function searchGoogleBooks(
  tags: string[],
  maxResults = 20,
): Promise<GoogleBooksResult[]> {
  if (tags.length === 0) return [];

  // Build query: combine tags as subject terms joined by +
  // Google Books API uses + as space in query parameters
  const query = tags.map((tag) => `subject:${tag}`).join("+");
  const url = `https://www.googleapis.com/books/v1/volumes?q=${query}&maxResults=${maxResults}&orderBy=relevance&langRestrict=en`;

  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("Rate limited by Google Books API. Please try again in a moment.");
    }
    throw new Error(`Google Books API error: ${response.status}`);
  }

  const data: GoogleBooksResponse = await response.json();

  if (!data.items || data.items.length === 0) {
    return [];
  }

  return data.items
    .map((item): GoogleBooksResult | null => {
      const v = item.volumeInfo;
      if (!v?.title) return null;

      return {
        title: v.title,
        authors: v.authors ?? [],
        genres: v.categories ?? [],
        description: v.description ?? "",
        starRating: v.averageRating,
        ratingCount: v.ratingsCount,
        googleBooksUrl: v.infoLink,
        thumbnail: v.imageLinks?.thumbnail ?? v.imageLinks?.smallThumbnail,
      };
    })
    .filter((r): r is GoogleBooksResult => r != null);
}
