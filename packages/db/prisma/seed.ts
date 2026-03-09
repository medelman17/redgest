import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  const subreddits = [
    {
      name: "machinelearning",
      insightPrompt: "AI/ML research breakthroughs, new model architectures, practical deployment techniques",
      maxPosts: 5,
    },
    {
      name: "typescript",
      insightPrompt: "TypeScript language features, type system patterns, tooling improvements",
      maxPosts: 5,
    },
    {
      name: "selfhosted",
      insightPrompt: "Self-hosting tools, Docker setups, privacy-first alternatives to SaaS",
      maxPosts: 3,
    },
  ];

  for (const sub of subreddits) {
    await prisma.subreddit.upsert({
      where: { name: sub.name },
      update: sub,
      create: sub,
    });
  }

  await prisma.config.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      globalInsightPrompt:
        "I'm a software engineer interested in AI/ML, TypeScript ecosystem, and self-hosting. Focus on practical, actionable content.",
      defaultLookback: "24h",
      defaultDelivery: "NONE",
      llmProvider: "anthropic",
      llmModel: "claude-sonnet-4-20250514",
    },
  });

  console.log("Seed complete: 3 subreddits + config singleton");
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
