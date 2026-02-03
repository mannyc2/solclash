SolClash On-Chain Policy ABI (v1)

1. Scope
Defines the Solana program ABI for agent policy evaluation. Programs are executed
by the arena harness; they do not manage funds or state beyond producing actions.

2. Program Interface
Single instruction:
- evaluate_v1(input)

The program reads EvalInputV1 and writes EvalOutputV1 to an output account.
Instruction data must be empty. Non-empty instruction data is invalid.

3. Accounts
- input_account: read-only, contains EvalInputV1 bytes
- output_account: writable, contains EvalOutputV1 bytes
- program_id: the agent policy program

No other accounts are passed. Any attempt to read or write other accounts is invalid.
The output account data length must be at least 20 bytes (size of EvalOutputV1).

4. Serialization
- All structs are serialized with Borsh.
- Fixed-point integers are used for prices and balances.
- All integers are little-endian.

5. EvalInputV1
Fields:
- version: u8 (must be 1)
- window_id: [u8; 32]
- step_index: u32
- bar_interval_seconds: u32
- price_scale: u32 (e.g., 1_000_000)
- volume_scale: u32 (e.g., 1_000_000)
- cash_balance: i64 (USDC base units)
- position_qty: i64 (BTC base units, signed)
- avg_entry_price: i64 (USDC per BTC, fixed-point)
- max_leverage_bps: u32
- initial_margin_bps: u32
- maintenance_margin_bps: u32
- lookback_len: u16
- ohlcv: Vec<Bar> (length must equal lookback_len)

Bar:
- open: i64
- high: i64
- low: i64
- close: i64
- volume: i64

6. EvalOutputV1
Fields:
- version: u8 (must be 1)
- action_type: u8 (0=HOLD, 1=BUY, 2=SELL, 3=CLOSE)
- order_qty: i64 (BTC base units, positive)
- err_code: u16 (0 means OK)
- reserved: [u8; 8]

Action semantics are defined in the Core Spec. In short: BUY increases position,
SELL decreases position, CLOSE sets position to zero, and HOLD does nothing.
The reserved bytes must be zeroed in all outputs.

Err code mapping (diagnostic only):
- 0 OK
- 1 INVALID_INSTRUCTION_DATA
- 2 INVALID_INPUT_VERSION
- 3 INVALID_LOOKBACK_LEN
- 4 INPUT_DESER_FAIL
- 5 POLICY_ERR
- 6 OUTPUT_INVALID
- 7 OUTPUT_SER_FAIL

7. Validation Rules
- If EvalInputV1.version != 1, the harness treats output as HOLD.
- If lookback_len does not match ohlcv length, output is ignored.
- If EvalOutputV1.version != 1, output is ignored.
- If action_type is BUY or SELL and order_qty <= 0, output is ignored.
Err codes are diagnostic and do not affect scoring.

8. Execution Budget
- The harness sets a fixed compute unit limit for evaluate_v1.
- Programs exceeding the limit are treated as failed evaluations.

9. Determinism
- Programs must be deterministic for identical input bytes.
- Sysvars beyond the provided input and program id must not be used.
