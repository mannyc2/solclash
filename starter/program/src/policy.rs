use crate::errors::PolicyError;
use crate::types::{EvalInputV1, EvalOutputV1};

pub fn evaluate(_input: &EvalInputV1) -> Result<EvalOutputV1, PolicyError> {
    Ok(EvalOutputV1::hold(0))
}
