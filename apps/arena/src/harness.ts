import type { EvalInputV1, EvalOutputV1 } from "@solclash/simulator";
import type { FileSink, Subprocess } from "bun";

export interface HarnessProgram {
  id: string;
  so_path: string;
}

interface HarnessInitRequest {
  type: "init";
  request_id: number;
  programs: HarnessProgram[];
  compute_unit_limit?: number;
}

interface HarnessEvalRequest {
  type: "eval";
  request_id: number;
  agent_id: string;
  input: HarnessEvalInput;
}

interface HarnessShutdownRequest {
  type: "shutdown";
  request_id: number;
}

type HarnessRequest =
  | HarnessInitRequest
  | HarnessEvalRequest
  | HarnessShutdownRequest;

interface HarnessOkResponse {
  type: "ok";
  request_id: number;
}

interface HarnessErrorResponse {
  type: "error";
  request_id: number;
  message: string;
}

interface HarnessResultResponse {
  type: "result";
  request_id: number;
  agent_id: string;
  status: string;
  output: HarnessEvalOutput;
}

type HarnessResponse =
  | HarnessOkResponse
  | HarnessErrorResponse
  | HarnessResultResponse;

interface HarnessEvalInput {
  version: number;
  window_id: string;
  step_index: number;
  bar_interval_seconds: number;
  price_scale: number;
  volume_scale: number;
  cash_balance: string;
  position_qty: string;
  avg_entry_price: string;
  max_leverage_bps: number;
  initial_margin_bps: number;
  maintenance_margin_bps: number;
  lookback_len: number;
  ohlcv: Array<{
    open: string;
    high: string;
    low: string;
    close: string;
    volume: string;
  }>;
}

interface HarnessEvalOutput {
  version: number;
  action_type: number;
  order_qty: string;
  err_code: number;
}

export class HarnessClient {
  private proc: Subprocess;
  private stdin: FileSink;
  private pending = new Map<
    number,
    { resolve: (value: HarnessResponse) => void; reject: (err: Error) => void }
  >();
  private nextId = 1;
  private closed = false;
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();

  private constructor(proc: Subprocess) {
    this.proc = proc;
    this.stdin = proc.stdin as FileSink;
    void this.readLoop();
    void this.proc.exited.then(() => {
      this.closed = true;
      for (const [, pending] of this.pending) {
        pending.reject(new Error("Harness process exited"));
      }
      this.pending.clear();
    });
  }

  static async start(
    harnessPath: string,
    programs: HarnessProgram[],
    computeUnitLimit?: number,
    args: string[] = [],
  ): Promise<HarnessClient> {
    const proc = Bun.spawn([harnessPath, ...args], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "inherit",
    });
    const client = new HarnessClient(proc);
    await client.init(programs, computeUnitLimit);
    return client;
  }

  async init(
    programs: HarnessProgram[],
    computeUnitLimit?: number,
  ): Promise<void> {
    const msg: HarnessInitRequest = {
      type: "init",
      request_id: this.nextRequestId(),
      programs,
      compute_unit_limit: computeUnitLimit,
    };
    const response = await this.send(msg);
    if (response.type === "error") {
      throw new Error(response.message);
    }
  }

  async eval(agentId: string, input: EvalInputV1): Promise<EvalOutputV1> {
    const msg: HarnessEvalRequest = {
      type: "eval",
      request_id: this.nextRequestId(),
      agent_id: agentId,
      input: serializeEvalInput(input),
    };
    const response = await this.send(msg);
    if (response.type === "error") {
      throw new Error(response.message);
    }
    if (response.type !== "result") {
      throw new Error("Unexpected harness response");
    }
    return parseEvalOutput(response.output);
  }

  async shutdown(): Promise<void> {
    if (this.closed) return;
    const msg: HarnessShutdownRequest = {
      type: "shutdown",
      request_id: this.nextRequestId(),
    };
    const response = await this.send(msg);
    if (response.type === "error") {
      throw new Error(response.message);
    }
    this.closed = true;
    void this.stdin.end();
    this.proc.kill();
  }

  private nextRequestId(): number {
    return this.nextId++;
  }

  private async send(msg: HarnessRequest): Promise<HarnessResponse> {
    if (this.closed) {
      throw new Error("Harness is closed");
    }
    const json = JSON.stringify(msg);
    void this.stdin.write(this.encoder.encode(`${json}\n`));
    await this.stdin.flush();
    return new Promise((resolve, reject) => {
      this.pending.set(msg.request_id, { resolve, reject });
    });
  }

  private async readLoop(): Promise<void> {
    const stdout = this.proc.stdout;
    if (!stdout || typeof stdout === "number") {
      return;
    }
    const reader = stdout.getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      buffer += this.decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n");
      while (idx >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line.length > 0) {
          this.handleLine(line);
        }
        idx = buffer.indexOf("\n");
      }
    }
  }

  private handleLine(line: string): void {
    let msg: HarnessResponse;
    try {
      msg = JSON.parse(line) as HarnessResponse;
    } catch (err) {
      return;
    }
    const pending = this.pending.get(msg.request_id);
    if (!pending) {
      return;
    }
    this.pending.delete(msg.request_id);
    pending.resolve(msg);
  }
}

function serializeEvalInput(input: EvalInputV1): HarnessEvalInput {
  const priceScale = input.instrument.price_scale;
  const volumeScale = input.instrument.volume_scale;

  return {
    version: input.version,
    window_id: input.window_id,
    step_index: input.step_index,
    bar_interval_seconds: input.bar_interval_seconds,
    price_scale: priceScale,
    volume_scale: volumeScale,
    cash_balance: toI64(input.account.cash_balance),
    position_qty: toI64(input.account.position_qty),
    avg_entry_price: toI64(input.account.avg_entry_price),
    max_leverage_bps: input.max_leverage_bps,
    initial_margin_bps: input.initial_margin_bps,
    maintenance_margin_bps: input.maintenance_margin_bps,
    lookback_len: input.lookback_len,
    ohlcv: input.ohlcv.map((bar) => ({
      open: toI64(bar.open),
      high: toI64(bar.high),
      low: toI64(bar.low),
      close: toI64(bar.close),
      volume: toI64(bar.volume),
    })),
  };
}

function parseEvalOutput(output: HarnessEvalOutput): EvalOutputV1 {
  return {
    version: 1,
    action_type: output.action_type,
    order_qty: Number(output.order_qty),
    err_code: output.err_code,
  };
}

function toI64(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return Math.trunc(value).toString();
}
