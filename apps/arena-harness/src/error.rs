use thiserror::Error;

#[derive(Error, Debug)]
pub enum HarnessError {
    #[error("program not found: {0}")]
    ProgramNotFound(String),
    #[error("eval failed: {0}")]
    EvalFailed(String),
}
