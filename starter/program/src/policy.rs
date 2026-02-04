use crate::errors::PolicyError;
use crate::types::{EvalInputV1, EvalOutputV1};

/// Minimal starter policy — defaults to HOLD.
/// Replace this with your trading strategy.
pub fn evaluate(_input: &EvalInputV1) -> Result<EvalOutputV1, PolicyError> {
    Ok(EvalOutputV1::hold(0))
}
