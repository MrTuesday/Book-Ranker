import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, BookOpen, Trophy } from "lucide-react";

const initialBooks = [
  { id: 1, title: "True Age", author: "Morgan Levine", rating: 3.7, ratingsCount: 125 },
  { id: 2, title: "Super Agers", author: "Eric Topol", rating: 3.48, ratingsCount: 1564 },
  { id: 3, title: "Ageless", author: "Andrew Steele", rating: 3.83, ratingsCount: 1470 },
  { id: 4, title: "Why We Die", author: "Venki Ramakrishnan", rating: 4.04, ratingsCount: 2512 },
];

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return "";
  return Number(value).toFixed(digits);
}

function computeWeightedScore(R, v, C, m) {
  if (!Number.isFinite(R) || !Number.isFinite(v) || v < 0) return null;
  return (v / (v + m)) * R + (m / (v + m)) * C;
}

export default function GoodreadsBookRankerApp() {
  const [baseline, setBaseline] = useState(3.9);
  const [priorWeight, setPriorWeight] = useState(500);
  const [books, setBooks] = useState(initialBooks);

  const rankedBooks = useMemo(() => {
    return books
      .map((book) => {
        const rating = Number(book.rating);
        const ratingsCount = Number(book.ratingsCount);
        const score = computeWeightedScore(rating, ratingsCount, Number(baseline), Number(priorWeight));
        return {
          ...book,
          rating,
          ratingsCount,
          score,
        };
      })
      .filter((book) => Number.isFinite(book.rating) && Number.isFinite(book.ratingsCount) && book.title.trim())
      .sort((a, b) => {
        if ((b.score ?? -Infinity) !== (a.score ?? -Infinity)) return (b.score ?? -Infinity) - (a.score ?? -Infinity);
        if (b.rating !== a.rating) return b.rating - a.rating;
        return b.ratingsCount - a.ratingsCount;
      })
      .map((book, index) => ({ ...book, rank: index + 1 }));
  }, [books, baseline, priorWeight]);

  const updateBook = (id, field, value) => {
    setBooks((current) => current.map((book) => (book.id === id ? { ...book, [field]: value } : book)));
  };

  const addBook = () => {
    setBooks((current) => [
      ...current,
      { id: Date.now(), title: "", author: "", rating: "", ratingsCount: "" },
    ]);
  };

  const removeBook = (id) => {
    setBooks((current) => current.filter((book) => book.id !== id));
  };

  const clearAll = () => {
    setBooks([{ id: Date.now(), title: "", author: "", rating: "", ratingsCount: "" }]);
  };

  const copyRankedTable = async () => {
    const lines = [
      "Rank\tTitle\tAuthor\tGoodreads Rating\tRatings Count\tWeighted Score",
      ...rankedBooks.map((b) => `${b.rank}\t${b.title}\t${b.author}\t${b.rating}\t${b.ratingsCount}\t${round(b.score)}`),
    ];
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch (err) {
      console.error("Clipboard copy failed", err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">Goodreads Book Ranker</h1>
            <p className="mt-2 max-w-3xl text-sm text-slate-600">
              Rank books using a Bayesian weighted score so that a high rating with a substantial number of ratings
              counts as a stronger signal than a tiny sample.
            </p>
          </div>
          <div className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
            <div className="text-xs uppercase tracking-wide text-slate-500">Formula</div>
            <div className="mt-1 text-sm font-medium text-slate-800">Score = (v / (v + m)) × R + (m / (v + m)) × C</div>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <BookOpen className="h-5 w-5" />
                Book inputs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="space-y-2">
                  <Label htmlFor="baseline">Baseline mean (C)</Label>
                  <Input
                    id="baseline"
                    type="number"
                    step="0.01"
                    value={baseline}
                    onChange={(e) => setBaseline(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">A rough Goodreads-wide default is 3.90.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="priorWeight">Prior weight (m)</Label>
                  <Input
                    id="priorWeight"
                    type="number"
                    step="1"
                    value={priorWeight}
                    onChange={(e) => setPriorWeight(e.target.value)}
                  />
                  <p className="text-xs text-slate-500">Higher values penalize low-count books more strongly.</p>
                </div>
                <div className="flex items-end">
                  <Button onClick={addBook} className="w-full rounded-xl">
                    <Plus className="mr-2 h-4 w-4" />
                    Add book
                  </Button>
                </div>
                <div className="flex items-end gap-2">
                  <Button variant="outline" onClick={copyRankedTable} className="w-full rounded-xl">
                    Copy rankings
                  </Button>
                  <Button variant="outline" onClick={clearAll} className="rounded-xl">
                    Clear
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                {books.map((book, idx) => (
                  <div key={book.id} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-[1.3fr_1fr_0.6fr_0.8fr_auto]">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={book.title}
                        placeholder={`Book ${idx + 1}`}
                        onChange={(e) => updateBook(book.id, "title", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Author</Label>
                      <Input
                        value={book.author}
                        placeholder="Author"
                        onChange={(e) => updateBook(book.id, "author", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Rating</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={book.rating}
                        placeholder="3.95"
                        onChange={(e) => updateBook(book.id, "rating", e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label># Ratings</Label>
                      <Input
                        type="number"
                        step="1"
                        value={book.ratingsCount}
                        placeholder="2500"
                        onChange={(e) => updateBook(book.id, "ratingsCount", e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeBook(book.id)}
                        className="rounded-xl text-slate-500 hover:text-red-600"
                        aria-label={`Remove ${book.title || `book ${idx + 1}`}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-0 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Trophy className="h-5 w-5" />
                Rankings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {rankedBooks.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500">
                    Add at least one book with a title, rating, and number of ratings.
                  </div>
                ) : (
                  rankedBooks.map((book) => (
                    <div key={book.id} className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Rank #{book.rank}</div>
                          <div className="mt-1 text-lg font-semibold text-slate-900">{book.title}</div>
                          <div className="text-sm text-slate-600">{book.author || "Unknown author"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Weighted score</div>
                          <div className="text-2xl font-semibold text-slate-900">{round(book.score)}</div>
                        </div>
                      </div>
                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-3">
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Goodreads rating</div>
                          <div className="mt-1 font-medium text-slate-900">{round(book.rating, 2)}</div>
                        </div>
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Ratings count</div>
                          <div className="mt-1 font-medium text-slate-900">{book.ratingsCount.toLocaleString()}</div>
                        </div>
                        <div className="rounded-xl bg-white p-3 ring-1 ring-slate-200 col-span-2 md:col-span-1">
                          <div className="text-xs uppercase tracking-wide text-slate-500">Adjustment</div>
                          <div className="mt-1 font-medium text-slate-900">
                            {book.score > book.rating ? "+" : ""}
                            {round(book.score - book.rating, 3)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
