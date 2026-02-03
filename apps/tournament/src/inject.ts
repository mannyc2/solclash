import { $ } from "bun";
import { join } from "node:path";

/**
 * Copy round logs into each target directory so agents can inspect results.
 * Creates `<target>/logs/rounds/<roundNum>/` with the contents of `roundDir`.
 */
export async function injectLogs(
  roundDir: string,
  roundNum: number,
  targets: string[],
): Promise<void> {
  for (const target of targets) {
    const dest = join(target, "logs", "rounds", `${roundNum}`);
    await $`mkdir -p ${dest}`.quiet();
    await $`cp -R ${roundDir}/. ${dest}`.quiet();
  }
}
