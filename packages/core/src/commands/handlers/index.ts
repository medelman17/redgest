import type { CommandType, CommandHandler } from "../types.js";
import { handleGenerateDigest } from "./generate-digest.js";
import { handleAddSubreddit } from "./add-subreddit.js";
import { handleRemoveSubreddit } from "./remove-subreddit.js";
import { handleUpdateSubreddit } from "./update-subreddit.js";
import { handleUpdateConfig } from "./update-config.js";

type HandlerRegistry = {
  [K in CommandType]?: CommandHandler<K>;
};

export const commandHandlers: HandlerRegistry = {
  GenerateDigest: handleGenerateDigest,
  AddSubreddit: handleAddSubreddit,
  RemoveSubreddit: handleRemoveSubreddit,
  UpdateSubreddit: handleUpdateSubreddit,
  UpdateConfig: handleUpdateConfig,
};

export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
};
