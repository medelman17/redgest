import { listSubreddits } from "@/lib/dal";
import { serializeSubreddit } from "@/lib/types";
import { SubredditTable } from "@/components/subreddit-table";

export default async function SubredditsPage() {
  const subreddits = await listSubreddits();
  const serialized = subreddits.map(serializeSubreddit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Subreddits
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your monitored subreddits and insight prompts
        </p>
      </div>
      <SubredditTable subreddits={serialized} />
    </div>
  );
}
