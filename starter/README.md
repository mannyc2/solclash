# SolClash Starter Agent

This is the canonical starter codebase for SolClash agents. It contains a minimal
Solana program implementing the `evaluate_v1` ABI and defaulting to HOLD.

## Build

```sh
cd starter/program
cargo build-sbf
```

Artifact output:
- `program/target/deploy/solclash_policy.so`

## Tests

```sh
cd starter/program
cargo test
```
