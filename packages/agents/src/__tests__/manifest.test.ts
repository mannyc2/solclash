import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadAgentManifest, validateAgentManifestsForArena } from "../index.js";

describe("agent manifests", () => {
  test("loads a valid manifest and resolves workspace relative to manifest", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-agent-manifest-"));
    try {
      await mkdir(join(root, "workspace", "program"), { recursive: true });
      const manifestPath = join(root, "solclash-agent.json");
      await Bun.write(
        manifestPath,
        JSON.stringify(
          {
            id: "alpha",
            arena_id: "btc-perp-v1",
            provider: "openai",
            workspace: "./workspace",
          },
          null,
          2,
        ),
      );

      const manifest = await loadAgentManifest(manifestPath);
      expect(manifest.id).toBe("alpha");
      expect(manifest.workspace_path).toBe(join(root, "workspace"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects invalid provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-agent-manifest-"));
    try {
      const manifestPath = join(root, "solclash-agent.json");
      await Bun.write(
        manifestPath,
        JSON.stringify({
          id: "alpha",
          arena_id: "btc-perp-v1",
          provider: "unknown",
          workspace: "./workspace",
        }),
      );

      await expect(loadAgentManifest(manifestPath)).rejects.toThrow(
        "Invalid agent manifest",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unknown legacy fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-agent-manifest-"));
    try {
      const manifestPath = join(root, "solclash-agent.json");
      await Bun.write(
        manifestPath,
        JSON.stringify({
          id: "alpha",
          arena_id: "btc-perp-v1",
          provider: "anthropic",
          workspace: "./workspace",
          execution_type: "rust",
        }),
      );

      await expect(loadAgentManifest(manifestPath)).rejects.toThrow(
        "Unrecognized key(s) in object",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects missing required fields", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-agent-manifest-"));
    try {
      const manifestPath = join(root, "solclash-agent.json");
      await Bun.write(
        manifestPath,
        JSON.stringify({
          id: "alpha",
          arena_id: "btc-perp-v1",
          provider: "anthropic",
        }),
      );

      await expect(loadAgentManifest(manifestPath)).rejects.toThrow(
        "workspace",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("validates manifest arena match and duplicate ids", async () => {
    const manifestA = {
      id: "alpha",
      arena_id: "btc-perp-v1",
      provider: "anthropic",
      workspace: ".",
      manifest_path: "/tmp/a/solclash-agent.json",
      workspace_path: "/tmp/a",
    } as const;

    const manifestB = {
      id: "alpha",
      arena_id: "btc-perp-v1",
      provider: "openai",
      workspace: ".",
      manifest_path: "/tmp/b/solclash-agent.json",
      workspace_path: "/tmp/b",
    } as const;

    expect(() =>
      validateAgentManifestsForArena([manifestA, manifestB], "btc-perp-v1"),
    ).toThrow("Duplicate agent id");

    expect(() =>
      validateAgentManifestsForArena([manifestA], "other-arena"),
    ).toThrow("targets arena_id");
  });
});
