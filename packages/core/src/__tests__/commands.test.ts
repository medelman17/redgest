import { describe, it, expect } from "vitest";
import type {
  Command,
  CommandType,
  CommandMap,
  CommandResultMap,
} from "../commands/types.js";

describe("Command types", () => {
  it("CommandType includes all 5 command types", () => {
    const types: CommandType[] = [
      "GenerateDigest",
      "AddSubreddit",
      "RemoveSubreddit",
      "UpdateSubreddit",
      "UpdateConfig",
    ];
    expect(types).toHaveLength(5);
  });

  it("derives correct Command union", () => {
    const cmd: Command = {
      type: "GenerateDigest",
      params: { subredditIds: ["sub-1"], lookbackHours: 24 },
    };
    expect(cmd.type).toBe("GenerateDigest");
  });

  it("narrows params via type discriminant", () => {
    const cmd: Command = {
      type: "AddSubreddit",
      params: { name: "r/typescript", displayName: "TypeScript" },
    };
    if (cmd.type === "AddSubreddit") {
      expect(cmd.params.name).toBe("r/typescript");
      expect(cmd.params.displayName).toBe("TypeScript");
    }
  });

  // Type-level tests — these just need to compile
  it("CommandMap keys match CommandResultMap keys", () => {
    // If these compile, the types are in sync
    const _cmdKeys: (keyof CommandMap)[] = [
      "GenerateDigest",
      "AddSubreddit",
      "RemoveSubreddit",
      "UpdateSubreddit",
      "UpdateConfig",
    ];
    const _resultKeys: (keyof CommandResultMap)[] = [
      "GenerateDigest",
      "AddSubreddit",
      "RemoveSubreddit",
      "UpdateSubreddit",
      "UpdateConfig",
    ];
    expect(_cmdKeys).toEqual(_resultKeys);
  });
});
