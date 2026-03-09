import type {
  QueryType,
  QueryMap,
  QueryResultMap,
  QueryHandler,
} from "./types.js";
import type { HandlerContext } from "../context.js";

type QueryHandlerRegistry = {
  [K in QueryType]?: QueryHandler<K>;
};

/**
 * Create the query() dispatch function with a handler registry.
 * No transaction, no events — just dispatch -> handler -> result.
 */
export function createQuery(handlers: QueryHandlerRegistry) {
  return async function query<K extends QueryType>(
    type: K,
    params: QueryMap[K],
    ctx: HandlerContext,
  ): Promise<QueryResultMap[K]> {
    const handler = handlers[type] as QueryHandler<K> | undefined;
    if (!handler) {
      throw new Error(`No handler registered for query: ${type}`);
    }
    return handler(params, ctx);
  };
}
