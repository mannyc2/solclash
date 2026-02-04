import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ArenaConfigResolved, OhlcvBar } from "@solclash/simulator";
import type { RoundMeta } from "@solclash/arena";
import type { AgentSource } from "../runner.js";
import type { ContainerRuntime } from "../runtime/container.js";

interface CompetitionContainerOpts {
  round: number;
  config: ArenaConfigResolved;
  bars: OhlcvBar[];
  outputDir: string;
  agentSources: AgentSource[];
  runtime: ContainerRuntime;
  image: string;
}

export async function runCompetitionInContainer(
  opts: CompetitionContainerOpts,
): Promise<RoundMeta> {
  const { round, config, bars, outputDir, agentSources, runtime, image } = opts;
  const roundDirHost = resolve(join(outputDir, "rounds", `${round}`));
  await mkdir(roundDirHost, { recursive: true });

  const tempDir = await mkdtemp(join(tmpdir(), "solclash-competition-"));
  const configPath = join(tempDir, "arena-config.json");
  const barsPath = join(tempDir, "bars.json");

  await writeFile(configPath, JSON.stringify(config, null, 2));
  await writeFile(barsPath, JSON.stringify(bars, null, 2));

  const container = await runtime.create({
    image,
    workdir: "/opt/solclash",
  });

  console.log(`\nCompetition Phase: Running arena in container...`);

  const containerRoundDir = `/logs/rounds/${round}`;
  const containerInputsDir = "/inputs";
  const containerAgentsDir = "/opt/solclash/agents";

  try {
    await runtime.exec(container, [
      "mkdir",
      "-p",
      containerInputsDir,
      containerRoundDir,
      containerAgentsDir,
    ]);
    await runtime.copyTo(
      container,
      configPath,
      `${containerInputsDir}/arena-config.json`,
    );
    await runtime.copyTo(
      container,
      barsPath,
      `${containerInputsDir}/bars.json`,
    );

    const workspaceAgentManifests: string[] = [];

    for (const agent of agentSources) {
      if (agent.provider === "builtin") {
        continue;
      }
      if (!agent.workspace) {
        throw new Error(`Missing workspace for agent ${agent.id}`);
      }
      const containerRoot = `${containerAgentsDir}/${agent.id}`;
      await runtime.exec(container, ["mkdir", "-p", containerRoot]);
      await runtime.copyTo(container, `${agent.workspace}/.`, containerRoot);
      const manifestPath = `${containerInputsDir}/agent-${agent.id}.json`;
      const manifestHostPath = join(tempDir, `agent-${agent.id}.json`);
      await writeFile(
        manifestHostPath,
        JSON.stringify(
          {
            id: agent.id,
            arena_id: config.arena_id,
            provider: agent.provider,
            workspace: containerRoot,
            ...(agent.model ? { model: agent.model } : {}),
          },
          null,
          2,
        ),
      );
      await runtime.copyTo(container, manifestHostPath, manifestPath);
      workspaceAgentManifests.push(manifestPath);
    }

    const args = [
      "bun",
      "run",
      "apps/arena/src/cli.ts",
      "--config",
      `${containerInputsDir}/arena-config.json`,
      "--data",
      `${containerInputsDir}/bars.json`,
      "--output",
      containerRoundDir,
    ];

    for (const manifestPath of workspaceAgentManifests) {
      args.push("--agent", manifestPath);
    }
    if (workspaceAgentManifests.length > 0) {
      args.push("--harness", "/usr/local/bin/solclash-harness");
    }

    const result = await runtime.exec(container, args, {
      cwd: "/opt/solclash",
    });
    if (result.code !== 0) {
      console.error(`\nArena failed (exit ${result.code}):`);
      console.error(result.stderr);
      throw new Error(`Arena CLI failed: ${result.stderr}`);
    }

    console.log(`Competition Phase: ✓ Complete`);

    await runtime.copyFrom(container, `${containerRoundDir}/.`, roundDirHost);
    const meta = await Bun.file(join(roundDirHost, "round_meta.json")).json();
    return meta as RoundMeta;
  } finally {
    await runtime.remove(container);
    await rm(tempDir, { recursive: true, force: true });
  }
}
