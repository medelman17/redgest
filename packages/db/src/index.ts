export { prisma } from "./client";
export * from "./generated/prisma/client";

// Transaction client type — same model accessors as PrismaClient
// but without lifecycle methods ($connect, $disconnect, etc.)
export type TransactionClient = Omit<
  import("./generated/prisma/client").PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;
