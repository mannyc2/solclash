use thiserror::Error;

#[derive(Error, Debug)]
pub enum PolicyError {
    #[error("policy error")]
    PolicyFailed,
}

#[repr(u16)]
pub enum ErrCode {
    Ok = 0,
    InvalidInstructionData = 1,
    InvalidInputVersion = 2,
    InvalidLookbackLen = 3,
    InputDeserFail = 4,
    PolicyErr = 5,
    OutputInvalid = 6,
    OutputSerFail = 7,
}
