import { describe, expect, test } from "bun:test";
import { loadAgentModule, resolveAgentsWithErrors } from "../agents.js";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

describe("resolveAgentsWithErrors", () => {
  test("collects invalid agents without throwing", async () => {
    const dir = join("/tmp", `solclash-agent-${randomUUID()}`);
    await Bun.spawn(["mkdir", "-p", dir]).exited;

    const goodPath = join(dir, "good.ts");
    const badPath = join(dir, "bad.ts");
    const throwPath = join(dir, "throw.ts");

    await Bun.write(
      goodPath,
      "export default function() { return { version: 1, action_type: 0, order_qty: 0, err_code: 0 }; }",
    );
    await Bun.write(badPath, "export default 123;");
    await Bun.write(throwPath, "throw new Error('boom');");

    const result = await resolveAgentsWithErrors(
      ["UNKNOWN_BASELINE"],
      [goodPath, badPath, throwPath],
    );

    expect(result.agents.map((a) => a.id)).toContain("good");
    expect(result.invalidAgents["UNKNOWN_BASELINE"]).toBe("unknown_baseline");
    expect(result.invalidAgents[badPath]).toBeDefined();
    expect(result.invalidAgents[throwPath]).toBeDefined();
  });
});

describe("loadAgentModule", () => {
  test("derives clean ID from basename without extension", async () => {
    const fixturePath = join(import.meta.dir, "fixtures", "momentum-agent.ts");
    const agent = await loadAgentModule(fixturePath);
    expect(agent.id).toBe("momentum-agent");
    expect(typeof agent.policy).toBe("function");
  });
});
