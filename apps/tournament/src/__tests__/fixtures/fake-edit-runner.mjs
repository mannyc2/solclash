import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i];
    const value = args[i + 1];
    if (key === "--input") {
      out.input = value;
      i += 1;
    } else if (key === "--log-dir") {
      out.logDir = value;
      i += 1;
    }
  }
  return out;
}

async function main() {
  const { input, logDir } = parseArgs();
  if (!input || !logDir) {
    console.error("Usage: fake-edit-runner --input <path> --log-dir <path>");
    process.exit(1);
  }

  const raw = await readFile(input, "utf8");
  const payload = JSON.parse(raw);

  await mkdir(logDir, { recursive: true });
  await writeFile(
    join(logDir, "sdk.jsonl"),
    JSON.stringify({ ok: true }) + "\n",
  );

  const status = process.env.FAKE_EDIT_STATUS ?? "success";
  if (status === "success") {
    const marker = join(payload.workspace_path, "edit_marker.txt");
    await writeFile(marker, `edited:${payload.agent_id}\n`);
    if (payload.round && Number(payload.round) > 1) {
      const prev = join(
        payload.workspace_path,
        "logs",
        "rounds",
        String(Number(payload.round) - 1),
        "summary.json",
      );
      let seen = false;
      try {
        await readFile(prev, "utf8");
        seen = true;
      } catch {
        seen = false;
      }
      await writeFile(
        join(payload.workspace_path, "log_seen.txt"),
        `seen:${seen}\n`,
      );
    }
  }

  const meta = {
    agent_id: payload.agent_id,
    status,
    session_id: "fake-session",
    checkpoint_id: "fake-checkpoint",
  };
  await writeFile(
    join(logDir, "edit_meta.json"),
    JSON.stringify(meta, null, 2),
  );

  if (status === "success") {
    process.exit(0);
  }
  if (status === "timeout") {
    process.exit(10);
  }
  process.exit(1);
}

main();
