import { listSubreddits } from "@/lib/dal";
import { serializeSubreddit } from "@/lib/types";
import { SearchPanel } from "@/components/search-panel";

export default async function SearchPage() {
  const subreddits = await listSubreddits();
  const serializedSubreddits = subreddits.map(serializeSubreddit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Search
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Search across posts and digests with full-text and semantic search
        </p>
      </div>
      <SearchPanel subreddits={serializedSubreddits} />
    </div>
  );
}
