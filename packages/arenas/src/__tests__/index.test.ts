import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getArenaDefinition,
  validateSupportedBaselines,
  validateWorkspaceForArena,
} from "../index.js";

describe("arena definitions", () => {
  test("throws for unknown arena", () => {
    expect(() => getArenaDefinition("unknown")).toThrow("Unknown arena_id");
  });

  test("validates workspace requirements", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-arena-workspace-"));
    try {
      await mkdir(join(root, "program", "src"), { recursive: true });
      await Bun.write(
        join(root, "program", "Cargo.toml"),
        '[package]\nname="x"\nversion="0.1.0"\n',
      );

      const validated = await validateWorkspaceForArena("btc-perp-v1", root);
      expect(validated.program_dir).toBe(join(root, "program"));
      expect(validated.artifact_path).toBe(
        join(root, "program", "target", "deploy", "solclash_policy.so"),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects workspace missing required files", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-arena-workspace-"));
    try {
      await mkdir(join(root, "program", "src"), { recursive: true });
      await expect(
        validateWorkspaceForArena("btc-perp-v1", root),
      ).rejects.toThrow("missing program/Cargo.toml");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unsupported baselines", () => {
    expect(() =>
      validateSupportedBaselines("btc-perp-v1", ["BUY_AND_HOLD", "NOPE"]),
    ).toThrow("Unsupported baseline");
  });
});
