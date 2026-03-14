"use client";

import { useState, useTransition, useRef } from "react";
import { Search, Loader2 } from "lucide-react";
import { fetchSearchResults } from "@/lib/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SerializedSubreddit, SerializedSearchResult } from "@/lib/types";

interface SearchPanelProps {
  subreddits: SerializedSubreddit[];
}

function sentimentVariant(
  sentiment: string | null,
): "default" | "secondary" | "destructive" | "outline" {
  if (sentiment === "positive") return "default";
  if (sentiment === "negative") return "destructive";
  return "secondary";
}

export function SearchPanel({ subreddits }: SearchPanelProps) {
  const [query, setQuery] = useState("");
  const [subreddit, setSubreddit] = useState("");
  const [sentiment, setSentiment] = useState("");
  const [since, setSince] = useState("");
  const [minScore, setMinScore] = useState("");
  const [results, setResults] = useState<SerializedSearchResult[] | null>(null);
  const [searched, setSearched] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;

    startTransition(async () => {
      const params: Parameters<typeof fetchSearchResults>[0] = {
        query: trimmed,
        limit: 25,
      };
      if (subreddit) params.subreddit = subreddit;
      if (since) params.since = since;
      if (sentiment) params.sentiment = sentiment;
      if (minScore !== "") params.minScore = Number(minScore);

      const data = await fetchSearchResults(params);
      setResults(data);
      setSearched(true);
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleSearch();
    }
  };

  return (
    <div className="space-y-6">
      {/* Search bar + filters */}
      <Card>
        <CardHeader>
          <CardTitle className="font-mono text-base">Search Posts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Query input */}
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              placeholder="Search across post summaries..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              className="flex-1"
              aria-label="Search query"
            />
            <Button onClick={handleSearch} disabled={isPending || !query.trim()} className="gap-2">
              {isPending ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="size-4" />
                  Search
                </>
              )}
            </Button>
          </div>

          {/* Filter row */}
          <div className="flex flex-wrap gap-4">
            {/* Subreddit filter */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Subreddit</Label>
              <Select value={subreddit} onValueChange={setSubreddit}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="All subreddits" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All subreddits</SelectItem>
                  {subreddits.map((s) => (
                    <SelectItem key={s.id} value={s.name}>
                      r/{s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Sentiment filter */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Sentiment</Label>
              <Select value={sentiment} onValueChange={setSentiment}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Any" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any</SelectItem>
                  <SelectItem value="positive">Positive</SelectItem>
                  <SelectItem value="neutral">Neutral</SelectItem>
                  <SelectItem value="negative">Negative</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Time range filter */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Time range</Label>
              <Select value={since} onValueChange={setSince}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder="Any time" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">Any time</SelectItem>
                  <SelectItem value="24h">Last 24 hours</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Min score filter */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground" htmlFor="minScore">
                Min score
              </Label>
              <Input
                id="minScore"
                type="number"
                min={0}
                placeholder="Any"
                value={minScore}
                onChange={(e) => setMinScore(e.target.value)}
                className="w-24"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Loading state */}
      {isPending && (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Searching...
        </div>
      )}

      {/* Results */}
      {!isPending && searched && results !== null && (
        <>
          <p className="text-sm text-muted-foreground">
            {results.length === 0
              ? "No results found."
              : `${results.length} result${results.length !== 1 ? "s" : ""} found`}
          </p>

          {results.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No posts matched your search. Try different keywords or broaden the filters.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {results.map((result) => (
                <SearchResultCard key={result.postId} result={result} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SearchResultCard({ result }: { result: SerializedSearchResult }) {
  return (
    <Card className="relative">
      {/* Relevance rank badge */}
      <span className="absolute right-3 top-3 font-mono text-xs text-muted-foreground">
        #{result.relevanceRank}
      </span>

      <CardHeader className="pb-2 pr-12">
        <CardTitle className="text-base font-medium leading-snug">
          {result.title}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Badge variant="outline" className="font-mono text-xs">
            r/{result.subreddit}
          </Badge>
          {result.sentiment && (
            <Badge variant={sentimentVariant(result.sentiment)} className="text-xs capitalize">
              {result.sentiment}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">
            Score: {result.score.toLocaleString()}
          </span>
          {result.digestDate && (
            <span className="text-xs text-muted-foreground">
              Digest:{" "}
              {new Date(result.digestDate).toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "numeric",
              })}
            </span>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-2">
        {result.summarySnippet && (
          <p className="text-sm text-muted-foreground">{result.summarySnippet}</p>
        )}

        {result.matchHighlights.length > 0 && (
          <div className="space-y-1">
            {result.matchHighlights.map((highlight, i) => (
              <p
                key={i}
                className="rounded-sm bg-muted px-2 py-1 text-xs leading-relaxed [&_b]:font-semibold [&_b]:text-foreground"
                // ts_headline returns <b>…</b> tags for matched terms
                dangerouslySetInnerHTML={{ __html: highlight }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
