import type { CommandType, CommandHandler } from "../types";
import { handleGenerateDigest } from "./generate-digest";
import { handleAddSubreddit } from "./add-subreddit";
import { handleRemoveSubreddit } from "./remove-subreddit";
import { handleUpdateSubreddit } from "./update-subreddit";
import { handleUpdateConfig } from "./update-config";
import { handleCancelRun } from "./cancel-run";
import { handleCreateProfile } from "./create-profile";
import { handleUpdateProfile } from "./update-profile";
import { handleDeleteProfile } from "./delete-profile";

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
