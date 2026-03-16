import { listSubreddits, getConfig, listProfiles } from "@/lib/dal";
import { serializeSubreddit, serializeProfile } from "@/lib/types";
import { parseLookbackHours } from "@/lib/utils";
import { DigestTriggerForm } from "@/components/digest-trigger-form";

export default async function TriggerPage() {
  const [subreddits, config, profiles] = await Promise.all([
    listSubreddits(),
    getConfig(),
    listProfiles(),
  ]);
  const serialized = subreddits
    .filter((s) => s.isActive)
    .map(serializeSubreddit);

  const serializedProfiles = profiles.map(serializeProfile);

  const lookbackHours = config
    ? parseLookbackHours(config.defaultLookback)
    : 24;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Manual Trigger
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Generate a digest on demand for selected subreddits
        </p>
      </div>
      <DigestTriggerForm
        subreddits={serialized}
        profiles={serializedProfiles}
        defaultLookbackHours={lookbackHours}
      />
    </div>
  );
}
