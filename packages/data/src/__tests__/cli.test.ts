import { describe, expect, test } from "bun:test";

describe("shared CLI error formatting", () => {
  test("data CLI prints usage on missing subcommand", async () => {
    const proc = Bun.spawn(["bun", "run", "packages/data/src/cli.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage:");
    expect(stderr).not.toContain("CliUsageError");
  });

  test("tournament CLI prints usage on missing --config", async () => {
    const proc = Bun.spawn(["bun", "run", "apps/tournament/src/cli.ts"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    expect(exitCode).toBe(1);
    expect(stderr).toContain("Usage: solclash-tournament");
    expect(stderr).not.toContain("CliUsageError");
  });
});
