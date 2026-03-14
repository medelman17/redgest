import { listProfiles, listSubreddits } from "@/lib/dal";
import { serializeProfile, serializeSubreddit } from "@/lib/types";
import { ProfileTable } from "@/components/profile-table";

export default async function ProfilesPage() {
  const [profiles, subreddits] = await Promise.all([
    listProfiles(),
    listSubreddits(),
  ]);

  const serializedProfiles = profiles.map(serializeProfile);
  const serializedSubreddits = subreddits.map(serializeSubreddit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Profiles
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage digest profiles with custom subreddit sets, schedules, and delivery settings
        </p>
      </div>
      <ProfileTable profiles={serializedProfiles} subreddits={serializedSubreddits} />
    </div>
  );
}
