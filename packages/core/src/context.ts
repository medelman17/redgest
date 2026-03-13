import type { PrismaClient, TransactionClient } from "@redgest/db";
import type { RedgestConfig } from "@redgest/config";
import type { DomainEventBus } from "./events/bus.js";
import type { SearchService } from "./search/index.js";

export type DbClient = PrismaClient | TransactionClient;

export type HandlerContext = {
  db: DbClient;
  eventBus: DomainEventBus;
  config: RedgestConfig;
  searchService?: SearchService;
};
