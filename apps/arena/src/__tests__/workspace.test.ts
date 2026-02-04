import { describe, expect, test } from "bun:test";
import { basename, join } from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolveOnchainWorkspace } from "../workspace.js";

describe("resolveOnchainWorkspace", () => {
  test("accepts a valid Rust workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-workspace-"));
    try {
      await mkdir(join(root, "program", "src"), { recursive: true });
      await Bun.write(
        join(root, "program", "Cargo.toml"),
        '[package]\nname="x"\nversion="0.1.0"\n',
      );

      const workspace = await resolveOnchainWorkspace(root);
      expect(workspace.rootDir).toBe(root);
      expect(workspace.programDir).toBe(join(root, "program"));
      expect(workspace.agentId).toBe(basename(root));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects missing Cargo.toml", async () => {
    const root = await mkdtemp(join(tmpdir(), "solclash-workspace-"));
    try {
      await mkdir(join(root, "program"), { recursive: true });
      await expect(resolveOnchainWorkspace(root)).rejects.toThrow(
        "missing program/Cargo.toml",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
