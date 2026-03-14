import { Badge } from "@/components/ui/badge";
import type { DeliveryStatusChannel } from "@redgest/core";

interface DeliveryBadgesProps {
  channels: DeliveryStatusChannel[];
}

export function DeliveryBadges({ channels }: DeliveryBadgesProps) {
  if (channels.length === 0)
    return <span className="text-muted-foreground">{"\u2014"}</span>;

  return (
    <div className="flex gap-1">
      {channels.map((ch) => (
        <Badge
          key={ch.channel}
          variant={
            ch.status === "SENT"
              ? "default"
              : ch.status === "FAILED"
                ? "destructive"
                : "secondary"
          }
        >
          {ch.channel} {ch.status.toLowerCase()}
        </Badge>
      ))}
    </div>
  );
}
