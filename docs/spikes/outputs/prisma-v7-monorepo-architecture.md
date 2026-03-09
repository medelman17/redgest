# Prisma v7 monorepo architecture with CQRS and Postgres

**Prisma v7 fundamentally restructures how the ORM integrates into TypeScript projects**, replacing the Rust query engine with a pure TypeScript client, mandating a new `prisma.config.ts` configuration file, and requiring explicit output paths for generated code. For a TurboRepo monorepo with CQRS patterns, this means rethinking client generation, migration workflows, event store design, and data access abstractions. This report covers every priority area with v7-specific code, schemas, and architectural decisions ready for implementation.

---

## How `prisma.config.ts` replaces the old configuration model

Prisma v7 (released November 19, 2025) introduced `prisma.config.ts` as the **mandatory** configuration entry point for the CLI. Database URLs, migration paths, and seed commands have all moved out of `schema.prisma` and `package.json` into this single TypeScript file. The schema now focuses purely on data models and generator configuration.

```ts
// packages/db/prisma.config.ts
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

The full `PrismaConfig` type exposes these options:

- **`schema`** — path to schema file or directory (default: `./prisma/schema.prisma`)
- **`migrations.path`** — where migration SQL files live
- **`migrations.seed`** — command for `prisma db seed` (replaces `package.json#prisma.seed`)
- **`migrations.initShadowDb`** — SQL to run on shadow DB before migrations
- **`views.path`** — directory for SQL view definitions
- **`typedSql.path`** — directory for TypedSQL `.sql` files
- **`datasource.url`** — connection URL (**required**)
- **`datasource.shadowDatabaseUrl`** — shadow DB for migration diffing

Critical breaking changes: environment variables are **no longer auto-loaded** (you must `import "dotenv/config"` explicitly), `datasource.directUrl` was removed (use `url` instead), and the `engine` property no longer exists because v7 eliminated the Rust binary engine entirely.

The config file must live at the **root of the package** where Prisma runs — in a monorepo, that's `packages/db/prisma.config.ts`. Supported file names include `prisma.config.ts` and `.config/prisma.ts` with `.js`, `.mjs`, `.cjs`, `.mts`, or `.cts` extensions.

---

## TurboRepo monorepo structure and the `@repo/db` pattern

The official Prisma + TurboRepo guide prescribes a dedicated `packages/db` package that owns the schema, generated client, and all database scripts. Every app imports from this single boundary.

```
repo/
  apps/
    web/              # Next.js or other app
    api/              # API server
  packages/
    db/               # Prisma package — schema, client, migrations
      prisma/
        schema.prisma
        migrations/
        seed.ts
      src/
        index.ts      # Public exports
        client.ts     # Singleton PrismaClient
        generated/
          prisma/     # Generated client output
      prisma.config.ts
      package.json
    ui/               # Shared UI (optional)
  turbo.json
```

The generator in `schema.prisma` must use the new **`prisma-client` provider** (not `prisma-client-js`) with an explicit `output` path:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
  // No url here — it's in prisma.config.ts
}
```

The `prisma-client` provider replaces `prisma-client-js` with a **Rust-free, pure TypeScript client**. Key differences: the generated code lives in your source tree (not `node_modules`), the bundle is **~90% smaller**, ESM is the default module format, and driver adapters are now required for all databases. The old provider remains available as a deprecated fallback but will be removed in a future release.

The generated file structure splits types across multiple files for better tree-shaking:

```
generated/prisma/
  ├── client.ts          # PrismaClient + all types
  ├── browser.ts         # Frontend-safe types (no PrismaClient)
  ├── enums.ts           # Enum values
  ├── models.ts          # All model types
  └── models/
      ├── User.ts        # Per-model types
      └── Post.ts
```

### Singleton client and package exports

The singleton pattern now requires a **driver adapter** — `new PrismaClient()` without one will throw:

```ts
// packages/db/src/client.ts
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
```

```ts
// packages/db/src/index.ts
export { prisma } from "./client";
export * from "../generated/prisma/client"; // Re-export all types
```

Apps add `"@repo/db": "workspace:*"` to their dependencies and import everything through the package boundary: `import { prisma, User } from "@repo/db"`. Never import directly from `@prisma/client` or the generated path in consuming apps.

### TurboRepo task configuration

```json
{
  "globalEnv": ["DATABASE_URL"],
  "tasks": {
    "dev": { "cache": false, "persistent": true, "dependsOn": ["^db:generate"] },
    "build": { "dependsOn": ["^db:generate"], "outputs": [".next/**", "dist/**"] },
    "db:generate": { "cache": false },
    "db:migrate": { "cache": false },
    "db:deploy": { "cache": false }
  }
}
```

Both `dev` and `build` **must** depend on `^db:generate` because v7 no longer auto-runs `prisma generate` during `migrate dev`. The `DATABASE_URL` in `globalEnv` ensures correct task hashing. All database tasks should be uncached.

### ESM output and bundler interaction

Prisma v7 is **ESM-first**. The `packages/db` package needs `"type": "module"` in its `package.json` and ESM-compatible TypeScript settings (`"module": "ESNext"`, `"moduleResolution": "bundler"`). The generator supports explicit format control via `moduleFormat = "esm"` or `"cjs"`, and `generatedFileExtension` can be set to `"ts"`, `"mts"`, or `"cts"`. In TurboRepo's Just-in-Time packaging model, raw `.ts` files are exported and each app's bundler handles module resolution, so the default ESM output works without additional configuration.

---

## Migration workflow changes that affect monorepo CI/CD

Three significant behavioral changes in v7 migrations will break existing scripts if unaddressed:

1. **`prisma migrate dev` no longer runs `prisma generate`** — add an explicit `prisma generate` step after migration in CI pipelines
2. **`prisma migrate dev` no longer runs the seed script** — run `prisma db seed` explicitly when needed
3. **The `--skip-generate` and `--skip-seed` flags were removed** since these behaviors are no longer automatic

The `--schema` and `--url` CLI flags were also removed from several commands; everything routes through `prisma.config.ts`. For `prisma migrate diff`, `--from-url` became `--from-config-datasource`.

A typical CI pipeline for the monorepo:

```bash
# In packages/db
prisma migrate deploy          # Apply pending migrations
prisma generate                # Generate client (must be explicit)
prisma db seed                 # Seed if needed (must be explicit)
```

---

## Postgres view support remains in preview

Despite the Prisma Q4 2025 roadmap indicating plans to graduate views to GA alongside v7, **views remain a Preview feature as of v7.4.x**. You must enable the feature flag:

```prisma
generator client {
  provider        = "prisma-client"
  output          = "../src/generated/prisma"
  previewFeatures = ["views"]
}
```

Define views with the `view` keyword. Fields represent the columns returned by the underlying SQL query:

```prisma
view UserWithPostCount {
  id        String @unique  // @unique enables findUnique + relations
  email     String
  name      String
  postCount Int

  posts     Post[]          // Relations work via @unique
}
```

Views are **read-only** — Prisma generates no `create`, `update`, or `delete` operations. The `@unique` attribute is not enforced at the database level but enables `findUnique` queries, cursor-based pagination, and relation fields.

**Prisma Migrate does not create or manage views.** You must write the `CREATE VIEW` SQL yourself. The recommended workflow:

```bash
npx prisma migrate dev --create-only --name add_user_with_post_count_view
```

Then edit the generated migration file:

```sql
CREATE VIEW "UserWithPostCount" AS
  SELECT u.id, u.email, u.name, COUNT(p.id)::int AS "postCount"
  FROM "User" u
  LEFT JOIN "Post" p ON u.id = p."authorId"
  GROUP BY u.id;
```

If view support limitations are blocking, alternatives include `$queryRaw` for direct SQL, **TypedSQL** (GA in v7) for type-safe raw queries via `.sql` files in `prisma/sql/`, and client extensions that encapsulate view logic.

---

## JSON fields lack native typing; enums had a rocky v7 launch

**Json type** handling is unchanged from v6. Fields typed as `Json` map to Postgres `jsonb` and produce `Prisma.JsonValue` in TypeScript — an untyped union. Prisma v7 introduces **no native typed JSON mechanism**, despite it being one of the most requested features (GitHub #3219). For type safety, use `prisma-json-types-generator` for compile-time type replacement or validate with Zod schemas at runtime:

```ts
const PreferencesSchema = z.object({
  theme: z.enum(["dark", "light"]),
  notifications: z.boolean(),
});
type Preferences = z.infer<typeof PreferencesSchema>;

// Validate on read
const prefs = PreferencesSchema.parse(user.preferences);
```

**Enum handling** had a turbulent v7 cycle. Version 7.0.0 introduced mapped enum runtime values where `@map("pending")` on an enum member changed the generated TypeScript value to `"pending"` instead of `"PENDING"`. This **broke existing codebases** and was **reverted in v7.3.0** after significant community pushback (GitHub #28599, #28843). Current behavior: `@map` on enum values affects only the database representation, not TypeScript output. Use Prisma enums for PostgreSQL — they map to native `CREATE TYPE ... AS ENUM` and provide type safety in both layers.

**UUID generation** supports both `@default(uuid())` (generated by Prisma ORM in TypeScript) and `@default(dbgenerated("gen_random_uuid()"))` (generated by Postgres). **UUIDv7 is fully supported** via `@default(uuid(7))` — time-sortable UUIDs with better B-tree index locality. Prefer `uuid(7)` for new tables where Prisma is the sole writer; use `dbgenerated()` when external tools also insert rows.

**Seeding** configuration moved from `package.json#prisma.seed` to `prisma.config.ts` under `migrations.seed`. In a monorepo, each `packages/db` has its own config with its own seed command, solving the old single-seed-per-project limitation. Always use `upsert()` for idempotent seeds and ensure `prisma generate` runs before seeding.

---

## CQRS event store table design for an audit trail

For a CQRS architecture where events serve as an **audit trail** (not the source of truth), the event store table should be append-only with these columns:

```sql
CREATE TABLE events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  aggregate_id    UUID NOT NULL,
  aggregate_type  VARCHAR(255) NOT NULL,
  type            VARCHAR(255) NOT NULL,
  version         INTEGER NOT NULL,
  payload         JSONB NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  correlation_id  UUID,
  causation_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**`BIGINT GENERATED ALWAYS AS IDENTITY`** is the optimal choice for the primary key. Benchmarks show it's **~1.6x faster** for inserts than UUID v7 and uses 8 bytes versus 16. Sequential values also produce smaller, denser B-tree indexes. Use UUID for `aggregate_id` where distributed ID generation matters, but keep the event's own `id` sequential for global ordering.

The `metadata` column (JSONB) holds operational concerns — `userId`, `traceId`, `schemaVersion`, `source` — separated from the domain `payload`. Promoting `correlation_id` and `causation_id` to top-level columns enables proper B-tree indexing; if you rarely query by them, they can live inside `metadata` instead.

### Optimistic concurrency is unnecessary for audit-trail events

When regular Postgres tables hold authoritative state, **concurrency control belongs on the state tables** (via row-level locking or version columns on the domain models). The event store is a secondary record — two concurrent successful writes to the state table should both be able to append audit events without conflict. Adding a `UNIQUE (aggregate_type, aggregate_id, version)` constraint would introduce unnecessary contention.

However, version numbers are still **informatively useful**: they enable gap detection, ordered replay for projection rebuilding, and future migration to full event sourcing. Store them without enforcing uniqueness unless you have a specific consistency requirement.

### Index strategy balances read patterns against write overhead

```sql
-- Primary: load all events for a specific aggregate, ordered
CREATE INDEX idx_events_aggregate
  ON events (aggregate_type, aggregate_id, version);

-- Projection rebuilding: scan event types chronologically  
CREATE INDEX idx_events_type_created
  ON events (type, created_at);

-- Time-range queries: BRIN is 99%+ smaller than B-tree for append-only data
CREATE INDEX idx_events_created_brin
  ON events USING brin (created_at) WITH (pages_per_range = 32);

-- Distributed tracing: partial index excludes NULLs
CREATE INDEX idx_events_correlation
  ON events (correlation_id) WHERE correlation_id IS NOT NULL;
```

**BRIN indexes** are ideal for `created_at` on append-only tables because physical row order perfectly correlates with timestamp order (correlation ≈ 1.0). A BRIN index on 50M rows might be **136 KB** versus multiple gigabytes for an equivalent B-tree. Start with the aggregate lookup index and BRIN, then add others only when query patterns demand them — each index adds write overhead.

### Partition by time once you exceed ~50 million rows

For tables under 10–50M rows, a single unpartitioned table with good indexes is sufficient. Beyond that threshold, **range partitioning by `created_at`** (monthly or quarterly) delivers partition pruning on time-range queries, instant archival via `ALTER TABLE ... DETACH PARTITION`, independent per-partition indexes, and faster `VACUUM`.

```sql
CREATE TABLE events (
  id              BIGINT GENERATED ALWAYS AS IDENTITY,
  aggregate_id    UUID NOT NULL,
  aggregate_type  VARCHAR(255) NOT NULL,
  type            VARCHAR(255) NOT NULL,
  version         INTEGER NOT NULL,
  payload         JSONB NOT NULL,
  metadata        JSONB NOT NULL DEFAULT '{}',
  correlation_id  UUID,
  causation_id    UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);

CREATE TABLE events_2026_03 PARTITION OF events
  FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

The main tradeoff: the partition key must be included in all `PRIMARY KEY` and `UNIQUE` constraints, slightly weakening uniqueness enforcement. Use `pg_partman` or a custom function to auto-create future partitions and manage retention. **Pruning old data** becomes a near-instant metadata operation: detach the partition, optionally export to S3 or cold storage, then drop the table.

An optional append-only enforcement trigger prevents accidental mutations:

```sql
CREATE OR REPLACE FUNCTION prevent_event_mutation() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Event store is append-only. % not allowed.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_append_only
  BEFORE UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION prevent_event_mutation();
```

---

## Full-text search requires raw SQL but can be prepared now

Prisma v7 **does not natively support `tsvector`** as a column type — it must be declared as `Unsupported("tsvector")?` in the schema. GIN and GiST indexes cannot be defined in the schema either. PostgreSQL full-text search filtering via the `search` operator remains in **Preview** (requiring `previewFeatures = ["fullTextSearchPostgres"]`) and critically does not use GIN indexes, making it unsuitable for production-scale queries.

The recommended approach for preparing future FTS is a **trigger-based tsvector column** added through a custom migration. This avoids the migration drift issues Prisma has with `GENERATED ALWAYS AS` columns:

```prisma
model Post {
  id         String                    @id @default(uuid(7))
  title      String
  body       String
  textSearch Unsupported("tsvector")?  // Keeps Prisma aware of the column
}
```

In the migration file:

```sql
ALTER TABLE "Post" ADD COLUMN "textSearch" tsvector;
CREATE INDEX "Post_textSearch_idx" ON "Post" USING GIN ("textSearch");

CREATE OR REPLACE FUNCTION post_tsvector_trigger() RETURNS trigger AS $$
BEGIN
  NEW."textSearch" :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.body, '')), 'B');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

CREATE TRIGGER post_tsvector_update
  BEFORE INSERT OR UPDATE ON "Post"
  FOR EACH ROW EXECUTE FUNCTION post_tsvector_trigger();
```

Query via **TypedSQL** (GA in v7) for type-safe raw SQL, or `$queryRaw`:

```ts
const results = await prisma.$queryRaw<Post[]>`
  SELECT id, title, body,
    ts_rank("textSearch", websearch_to_tsquery('english', ${term})) AS rank
  FROM "Post"
  WHERE "textSearch" @@ websearch_to_tsquery('english', ${term})
  ORDER BY rank DESC LIMIT 20
`;
```

---

## Repository pattern and transaction support for CQRS command handlers

Prisma v7 supports three approaches for abstracting data access behind repository interfaces. For CQRS, the **class-based repository with a Unit of Work** provides the cleanest separation between domain and infrastructure:

```ts
// Domain interface — no Prisma dependency
interface IOrderRepository {
  findById(id: string): Promise<DomainOrder | null>;
  save(order: DomainOrder): Promise<DomainOrder>;
}

// Infrastructure implementation
class PrismaOrderRepository implements IOrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<DomainOrder | null> {
    const row = await this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });
    return row ? toDomainOrder(row) : null;
  }

  async save(order: DomainOrder): Promise<DomainOrder> {
    const row = await this.prisma.order.upsert({
      where: { id: order.id },
      update: toPrismaData(order),
      create: toPrismaData(order),
    });
    return toDomainOrder(row);
  }
}
```

**Interactive transactions** wrap CQRS command handlers in atomic multi-table writes. V7.4.0 added **batching inside interactive transactions**, improving performance:

```ts
class PrismaUnitOfWork implements IUnitOfWork {
  constructor(private readonly prisma: PrismaClient) {}

  async execute<T>(
    work: (repos: Repositories) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      return work({
        orders: new PrismaOrderRepository(tx as any),
        events: new PrismaEventRepository(tx as any),
      });
    }, {
      maxWait: 5000,
      timeout: 10000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    });
  }
}
```

A command handler then uses the unit of work to persist state changes and append audit events atomically:

```ts
class PlaceOrderHandler {
  constructor(private readonly uow: IUnitOfWork) {}

  async execute(cmd: PlaceOrderCommand) {
    return this.uow.execute(async ({ orders, events }) => {
      const order = DomainOrder.create(cmd);
      const saved = await orders.save(order);
      await events.append({
        aggregateId: saved.id,
        aggregateType: "Order",
        type: "OrderPlaced",
        version: 1,
        payload: cmd,
      });
      return saved;
    });
  }
}
```

For mapping between Prisma-generated types and domain types, use **`Prisma.Result<T, Args, Operation>`** for inferred types from specific queries and plain mapper functions (`toDomainOrder`, `toPrismaData`) at the repository boundary. The `Prisma.validator` helper was removed in v7 — use TypeScript's `satisfies` operator instead. **Client extensions** (GA since v4.16, fully supported in v7) offer an alternative for lighter repository needs, adding custom methods directly to model delegates without a separate class layer.

---

## Conclusion

Prisma v7's architectural shift — pure TypeScript client, explicit output paths, mandatory driver adapters, and `prisma.config.ts` — aligns well with monorepo patterns but requires deliberate setup. The key insight for a TurboRepo project is that **`packages/db` becomes the single authority** for schema, generated types, and client singleton, with `turbo.json` task dependencies ensuring generation runs before all builds.

For CQRS, the event store design should prioritize **simplicity over premature optimization**: a single unpartitioned table with BIGINT identity, BRIN index on `created_at`, and no enforced version uniqueness (since events are audit trail only). Partition when you approach 50M rows. The repository + Unit of Work pattern with Prisma's interactive transactions provides clean command handler atomicity while keeping domain logic infrastructure-agnostic.

The most important gaps to track: **views remain in Preview** with no GA timeline, **PostgreSQL full-text search** needs raw SQL and cannot leverage GIN indexes through Prisma's API, and **typed JSON** still requires third-party generators. These limitations are workable with TypedSQL, custom migrations, and Zod validation, but they define where Prisma ends and raw Postgres begins in your architecture.