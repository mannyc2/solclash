# solclash-harness

Rust-based Solana program test harness for evaluating on-chain trading policies. Runs compiled SBF programs in a local Solana validator and communicates via async JSON-over-stdin/stdout.

Used by `@solclash/arena` when `--onchain-agents` are provided (including in the arena container).

## Protocol

The harness reads newline-delimited JSON requests from stdin and writes JSON responses to stdout.

### Init

Loads one or more SBF programs into the validator.

```jsonc
// request
{ "type": "init", "request_id": 1, "programs": [{ "id": "my-agent", "so_path": "./target/deploy/solclash_policy.so" }], "compute_unit_limit": 200000 }

// response
{ "type": "ok", "request_id": 1 }
```

`compute_unit_limit` is optional (default: 200,000).

### Eval

Evaluates an agent's policy program with the given market state.

```jsonc
// request
{
  "type": "eval",
  "request_id": 2,
  "agent_id": "my-agent",
  "input": {
    "version": 1,
    "window_id": "w0",
    "step_index": 5,
    "bar_interval_seconds": 60,
    "price_scale": 1000000,
    "volume_scale": 1000000,
    "cash_balance": "10000000000",
    "position_qty": "0",
    "avg_entry_price": "0",
    "max_leverage_bps": 10000,
    "initial_margin_bps": 1000,
    "maintenance_margin_bps": 500,
    "lookback_len": 5,
    "ohlcv": [
      { "open": "50000000000", "high": "50500000000", "low": "49500000000", "close": "50200000000", "volume": "1000000000" }
    ]
  }
}

// response
{
  "type": "result",
  "request_id": 2,
  "agent_id": "my-agent",
  "status": "OK",
  "output": { "version": 1, "action_type": 1, "order_qty": "1", "err_code": 0 }
}
```

Numeric fields use strings to preserve i64 precision. `action_type`: 0 = HOLD, 1 = BUY, 2 = SELL.

Window IDs that are 64-character hex strings are parsed directly; all others are SHA256-hashed to 32 bytes.

### Shutdown

```jsonc
{ "type": "shutdown", "request_id": 3 }
{ "type": "ok", "request_id": 3 }
```

### Error Response

Any request can return an error:

```jsonc
{ "type": "error", "request_id": 2, "message": "unknown agent_id: foo" }
```

## Binary Serialization

Inputs are converted to Borsh-encoded `EvalInputV1` structs and written into Solana accounts. The program writes a 20-byte `EvalOutputV1` (version, action_type, order_qty, err_code, reserved) to the output account.

## Dependencies

- `solana-sdk` / `solana-program` / `solana-program-test` 1.18
- `tokio` (async runtime)
- `borsh` (binary serialization)
- `serde` / `serde_json` (JSON protocol)
- `sha2` (window ID hashing)

## Build

```sh
cargo build --release
# binary: target/release/solclash-harness
```

## Tests

```sh
cargo test
```

Unit tests cover Borsh serialization round-trips, window ID hashing, and JSON input parsing.
