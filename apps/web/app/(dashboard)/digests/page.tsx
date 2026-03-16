import { listDigests } from "@/lib/dal";
import { serializeDigest } from "@/lib/types";
import { DigestTable } from "@/components/digest-table";

export default async function DigestsPage() {
  const result = await listDigests(20);
  const serialized = result.items.map(serializeDigest);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-mono text-2xl font-semibold tracking-tight">
          Digests
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Browse generated digests, view content, and check delivery status
        </p>
      </div>
      <DigestTable digests={serialized} />
    </div>
  );
}
