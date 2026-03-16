import { RedgestError } from "../../errors.js";
import type {
  QueryHandler,
  DeliveryStatusChannel,
  DeliveryStatusDigest,
} from "../types.js";

interface DigestRow {
  id: string;
  createdAt: Date;
  jobId: string;
}

interface DeliveryViewRow {
  digestId: string;
  jobId: string;
  channel: string;
  status: string;
  error: string | null;
  externalId: string | null;
  sentAt: Date | null;
  digestCreatedAt: Date;
}

export const handleGetDeliveryStatus: QueryHandler<"GetDeliveryStatus"> = async (
  params,
  ctx,
) => {
  let digests: DigestRow[];

  if (params.digestId) {
    // Specific digest lookup — scope through job for tenant isolation
    const raw = await ctx.db.digest.findFirst({
      where: { id: params.digestId, job: { organizationId: ctx.organizationId } },
      select: { id: true, createdAt: true, jobId: true },
    });
    if (!raw) {
      throw new RedgestError("NOT_FOUND", `Digest ${params.digestId} not found`);
    }
    digests = [raw as DigestRow];
  } else {
    // Recent digests — scope through job for tenant isolation
    const limit = Math.min(params.limit ?? 5, 20);
    const raw = await ctx.db.digest.findMany({
      where: { job: { organizationId: ctx.organizationId } },
      take: limit,
      orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, jobId: true },
    });
    digests = raw as DigestRow[];
  }

  if (digests.length === 0) {
    return { digests: [] };
  }

  // Fetch delivery rows for all digest IDs
  const digestIds = digests.map((d) => d.id);
  const rawDeliveries = await ctx.db.deliveryView.findMany({
    where: { digestId: { in: digestIds }, organizationId: ctx.organizationId },
    orderBy: { createdAt: "asc" },
  });
  const deliveries = rawDeliveries as DeliveryViewRow[];

  // Group deliveries by digestId
  const deliveryMap = new Map<string, DeliveryViewRow[]>();
  for (const d of deliveries) {
    const list = deliveryMap.get(d.digestId);
    if (list) {
      list.push(d);
    } else {
      deliveryMap.set(d.digestId, [d]);
    }
  }

  // Build result
  const result: DeliveryStatusDigest[] = digests.map((digest) => {
    const rows = deliveryMap.get(digest.id) ?? [];
    const channels: DeliveryStatusChannel[] = rows.map((r) => ({
      channel: r.channel as DeliveryStatusChannel["channel"],
      status: r.status as DeliveryStatusChannel["status"],
      error: r.error,
      externalId: r.externalId,
      sentAt: r.sentAt ? r.sentAt.toISOString() : null,
    }));

    return {
      digestId: digest.id,
      digestCreatedAt: digest.createdAt.toISOString(),
      jobId: digest.jobId,
      channels,
    };
  });

  return { digests: result };
};
