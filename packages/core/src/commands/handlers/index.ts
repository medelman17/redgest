import type { CommandType, CommandHandler } from "../types.js";
import { handleGenerateDigest } from "./generate-digest.js";
import { handleAddSubreddit } from "./add-subreddit.js";
import { handleRemoveSubreddit } from "./remove-subreddit.js";
import { handleUpdateSubreddit } from "./update-subreddit.js";
import { handleUpdateConfig } from "./update-config.js";
import { handleCancelRun } from "./cancel-run.js";
import { handleCreateProfile } from "./create-profile.js";
import { handleUpdateProfile } from "./update-profile.js";
import { handleDeleteProfile } from "./delete-profile.js";

type HandlerRegistry = {
  [K in CommandType]?: CommandHandler<K>;
};

export const commandHandlers: HandlerRegistry = {
  GenerateDigest: handleGenerateDigest,
  AddSubreddit: handleAddSubreddit,
  RemoveSubreddit: handleRemoveSubreddit,
  UpdateSubreddit: handleUpdateSubreddit,
  UpdateConfig: handleUpdateConfig,
  CancelRun: handleCancelRun,
  CreateProfile: handleCreateProfile,
  UpdateProfile: handleUpdateProfile,
  DeleteProfile: handleDeleteProfile,
};

export {
  handleGenerateDigest,
  handleAddSubreddit,
  handleRemoveSubreddit,
  handleUpdateSubreddit,
  handleUpdateConfig,
  handleCancelRun,
  handleCreateProfile,
  handleUpdateProfile,
  handleDeleteProfile,
};
