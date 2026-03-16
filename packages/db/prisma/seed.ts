import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL!,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  // Remove stale test subreddits from earlier seeds
  await prisma.subreddit.deleteMany({
    where: { name: { startsWith: "__" } },
  });

  const subreddits = [
    {
      name: "ClaudeAI",
      insightPrompt:
        "New Claude model releases, prompt engineering techniques, API updates, novel use cases, and Anthropic announcements",
      maxPosts: 5,
    },
    {
      name: "ClaudeCode",
      insightPrompt:
        "Claude Code CLI tips, workflow patterns, MCP server integrations, new features, and productivity hacks",
      maxPosts: 5,
    },
    {
      name: "nextjs",
      insightPrompt:
        "Next.js framework updates, App Router patterns, Server Components, deployment strategies, and performance optimization",
      maxPosts: 5,
    },
    {
      name: "vibecoding",
      insightPrompt:
        "AI-assisted coding workflows, tool comparisons, creative coding with LLMs, and emerging development paradigms",
      maxPosts: 5,
    },
    {
      name: "HomeNetworking",
      insightPrompt:
        "Home network gear recommendations, WiFi optimization, firewall and VLAN setups, and troubleshooting guides",
      maxPosts: 3,
    },
    {
      name: "electricians",
      insightPrompt:
        "Electrical code updates, tool recommendations, residential wiring techniques, and safety best practices",
      maxPosts: 3,
    },
    {
      name: "newjersey",
      insightPrompt:
        "Notable local news, community events, infrastructure updates, and restaurant or activity recommendations",
      maxPosts: 3,
    },
  ];

  for (const sub of subreddits) {
    await prisma.subreddit.upsert({
      where: { name: sub.name },
      update: { insightPrompt: sub.insightPrompt, maxPosts: sub.maxPosts },
      create: sub,
    });
  }

  await prisma.config.upsert({
    where: { id: 1 },
    update: {
      globalInsightPrompt:
        "Prioritize posts with high-signal technical content: new releases, architectural patterns, production war stories, and emerging tools. Deprioritize memes, beginner questions, job posts, and low-effort content. Favor discussions with substantive community debate over link-only shares.",
      llmModel: "claude-haiku-4-5-20251001",
    },
    create: {
      id: 1,
      globalInsightPrompt:
        "Prioritize posts with high-signal technical content: new releases, architectural patterns, production war stories, and emerging tools. Deprioritize memes, beginner questions, job posts, and low-effort content. Favor discussions with substantive community debate over link-only shares.",
      defaultLookback: "24h",
      defaultDelivery: "NONE",
      llmProvider: "anthropic",
      llmModel: "claude-haiku-4-5-20251001",
    },
  });

  // Ensure Default digest profile exists
  const allSubs = await prisma.subreddit.findMany({
    where: { isActive: true },
    select: { id: true },
  });

  const defaultProfile = await prisma.digestProfile.upsert({
    where: { name: "Default" },
    update: {},
    create: {
      name: "Default",
      insightPrompt:
        "Prioritize posts with high-signal technical content: new releases, architectural patterns, production war stories, and emerging tools. Deprioritize memes, beginner questions, job posts, and low-effort content. Favor discussions with substantive community debate over link-only shares.",
      lookbackHours: 24,
      maxPosts: 5,
      delivery: "NONE",
    },
  });

  // Link all active subreddits to Default profile (idempotent)
  for (const sub of allSubs) {
    await prisma.digestProfileSubreddit.upsert({
      where: {
        profileId_subredditId: {
          profileId: defaultProfile.id,
          subredditId: sub.id,
        },
      },
      update: {},
      create: {
        profileId: defaultProfile.id,
        subredditId: sub.id,
      },
    });
  }

  console.log(`Seed complete: ${subreddits.length} subreddits + config singleton + Default profile`);
}

main()
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
