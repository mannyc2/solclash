SolClash Starter Contract Spec (Base Contract)

1. Scope
This document defines the required layout and behavior of the starter Solana
program that agents begin from. It is intentionally minimal and deterministic.
The contract implements the policy ABI and defaults to HOLD on any error.

2. Required Layout
The required layout is rooted at the starter repo. In this monorepo, the
canonical starter template lives in `starter/`, so the program lives at
`starter/program/`.
- `program/Cargo.toml` with crate name `solclash_policy`.
- `program/src/lib.rs` exports `entrypoint!(process_instruction)`.
- `program/src/types.rs` defines Borsh types for `EvalInputV1`, `EvalOutputV1`,
  `Bar`, and `ActionType`.
- `program/src/policy.rs` defines `evaluate(input: &EvalInputV1) ->
  Result<EvalOutputV1, PolicyError>` with a default HOLD implementation.
- `program/src/errors.rs` defines a small `err_code` enum.
- `program/src/tests.rs` contains minimal unit tests.

3. Entrypoint Contract
The program must accept exactly two accounts:
- `input_account` (read-only): Borsh-serialized `EvalInputV1`.
- `output_account` (writable): Borsh-serialized `EvalOutputV1`.

Instruction data rules:
- Instruction data must be empty.
- If non-empty, write HOLD with `err_code=INVALID_INSTRUCTION_DATA` and return
  `Ok(())`.

Input handling:
- Deserialize `EvalInputV1` via Borsh.
- If deserialization fails, write HOLD with `err_code=INPUT_DESER_FAIL` and
  return `Ok(())`.
- Validate `version == 1` and `lookback_len == ohlcv.len()`.
- If validation fails, write HOLD with the corresponding `err_code` and return
  `Ok(())`.

Policy evaluation:
- Call `policy::evaluate(&input)`.
- If the policy returns an error, write HOLD with `err_code=POLICY_ERR` and
  return `Ok(())`.

Output validation:
- `version == 1`
- If `action_type` is BUY or SELL, `order_qty > 0`
- If invalid, write HOLD with `err_code=OUTPUT_INVALID` and return `Ok(())`.

Output writing:
- Always attempt to write an `EvalOutputV1` to `output_account`.
- If serialization fails, write HOLD with `err_code=OUTPUT_SER_FAIL`.
- The program must return `Ok(())` and must not panic, even on errors.

4. Error Codes (`err_code`)
- `0 OK`
- `1 INVALID_INSTRUCTION_DATA`
- `2 INVALID_INPUT_VERSION`
- `3 INVALID_LOOKBACK_LEN`
- `4 INPUT_DESER_FAIL`
- `5 POLICY_ERR`
- `6 OUTPUT_INVALID`
- `7 OUTPUT_SER_FAIL`

These codes are diagnostic. The harness always treats invalid or errored outputs
as HOLD.

5. Data Types and Serialization
- All structs are Borsh-serialized.
- `EvalOutputV1` is fixed-size and must be 20 bytes: `version: u8`,
  `action_type: u8`, `order_qty: i64`, `err_code: u16`, `reserved: [u8; 8]`.
- `reserved` must be zeroed in all outputs.
- The output account data length must be at least 20 bytes.

6. Determinism and Constraints
- No sysvars, extra accounts, randomness, or network I/O.
- No floating-point math. Fixed-point integers only.
- The program must be deterministic for identical input bytes.

7. Local Tests (Required)
- Borsh round-trip for `EvalOutputV1`.
- Default policy returns HOLD with `err_code=OK`.
- Invalid input version yields HOLD with `err_code=INVALID_INPUT_VERSION`.

8. Toolchain Alignment
- The starter contract must match the arena harness Solana toolchain version.
- The base contract spec does not pin a version; the harness declares it.

9. Minimal Skeleton (Illustrative)
```rust
// starter/program/src/lib.rs
use solana_program::{account_info::AccountInfo, entrypoint, entrypoint::ProgramResult, pubkey::Pubkey};
use crate::{errors::PolicyError, policy, types::{EvalInputV1, EvalOutputV1, ActionType}};

entrypoint!(process_instruction);

pub fn process_instruction(
    _program_id: &Pubkey,
    accounts: &[AccountInfo],
    instruction_data: &[u8],
) -> ProgramResult {
    // Enforce two accounts and empty instruction data, then parse input,
    // call policy::evaluate, validate output, and always write a result.
    // This function must never panic and must return Ok(()).
    Ok(())
}
```
