#![cfg(feature = "agave-unstable-api")]
#![allow(clippy::arithmetic_side_effects)]
pub mod macros;
pub mod measure;

// svm-wasm patch: std::time::Instant::now() panics on wasm*-unknown-unknown ("time not
// implemented on this platform"). Timings are only metrics, so on wasm they read as zero.
#[cfg(not(target_family = "wasm"))]
pub use std::time::Instant;

#[cfg(target_family = "wasm")]
#[derive(Debug, Clone, Copy)]
pub struct Instant;

#[cfg(target_family = "wasm")]
impl Instant {
    pub fn now() -> Self {
        Instant
    }
    pub fn elapsed(&self) -> std::time::Duration {
        std::time::Duration::ZERO
    }
}
