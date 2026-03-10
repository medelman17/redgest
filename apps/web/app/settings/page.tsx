import { getConfig } from "@/lib/dal";
import { serializeConfig } from "@/lib/types";
import type { SerializedConfig } from "@/lib/types";
import { SettingsForm } from "@/components/settings-form";

const DEFAULT_CONFIG: SerializedConfig = {
  id: 1,
  globalInsightPrompt: "",
  defaultLookback: "24h",
  defaultDelivery: "NONE",
  llmProvider: "anthropic",
  llmModel: "claude-sonnet-4-20250514",
  schedule: null,
  updatedAt: new Date().toISOString(),
};

export default async function SettingsPage() {
  const config = await getConfig();
  const serialized = config ? serializeConfig(config) : DEFAULT_CONFIG;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure digest generation, LLM providers, and delivery channels
        </p>
      </div>
      <SettingsForm config={serialized} />
    </div>
  );
}
