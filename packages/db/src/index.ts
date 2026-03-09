export { prisma } from "./client.js";
export * from "./generated/prisma/client.js";

// Transaction client type — same model accessors as PrismaClient
// but without lifecycle methods ($connect, $disconnect, etc.)
export type TransactionClient = Omit<
  import("./generated/prisma/client.js").PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
