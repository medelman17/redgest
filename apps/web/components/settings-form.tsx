"use client";

import { useActionState } from "react";
import { Loader2 } from "lucide-react";
import { useActionToast } from "@/lib/hooks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { updateConfigAction } from "@/lib/actions";
import type { SerializedConfig } from "@/lib/types";

function parseLookbackHours(lookback: string): number {
  const match = lookback.match(/^(\d+)h$/);
  return match ? Number(match[1]) : 24;
}

interface SettingsFormProps {
  config: SerializedConfig;
}

export function SettingsForm({ config }: SettingsFormProps) {
  const [state, formAction, isPending] = useActionState(
    updateConfigAction,
    null,
  );

  useActionToast(state, "Settings saved");

  return (
    <form action={formAction} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="globalInsightPrompt">Global Insight Prompt</Label>
        <Textarea
          id="globalInsightPrompt"
          name="globalInsightPrompt"
          placeholder="e.g. Focus on practical insights, new tools, and industry trends"
          defaultValue={config.globalInsightPrompt}
          rows={3}
        />
        <p className="text-xs text-muted-foreground">
          Guides LLM triage across all subreddits. Subreddit-level prompts
          take precedence.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="defaultLookbackHours">Default Lookback (hours)</Label>
          <Input
            id="defaultLookbackHours"
            name="defaultLookbackHours"
            type="number"
            min={1}
            max={168}
            defaultValue={parseLookbackHours(config.defaultLookback)}
          />
          <p className="text-xs text-muted-foreground">
            How far back to look for posts (1–168 hours)
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="defaultDelivery">Delivery Channel</Label>
          <Select
            name="defaultDelivery"
            defaultValue={config.defaultDelivery}
          >
            <SelectTrigger id="defaultDelivery">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="SLACK">Slack</SelectItem>
              <SelectItem value="ALL">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="llmProvider">LLM Provider</Label>
          <Select name="llmProvider" defaultValue={config.llmProvider}>
            <SelectTrigger id="llmProvider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="llmModel">LLM Model</Label>
          <Input
            id="llmModel"
            name="llmModel"
            placeholder="claude-sonnet-4-20250514"
            defaultValue={config.llmModel}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule">Digest Schedule (cron)</Label>
        <Input
          id="schedule"
          name="schedule"
          placeholder="0 7 * * *"
          defaultValue={config.schedule ?? ""}
        />
        <p className="text-xs text-muted-foreground">
          Cron expression for scheduled digests (e.g. &quot;0 7 * * *&quot; =
          daily at 7 AM). Leave empty to disable.
        </p>
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending && <Loader2 className="mr-1.5 size-4 animate-spin" />}
        Save Settings
      </Button>
    </form>
  );
}
