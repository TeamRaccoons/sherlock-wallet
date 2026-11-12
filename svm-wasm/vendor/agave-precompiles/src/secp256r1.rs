// svm-wasm patch: the upstream file verifies with OpenSSL, which does not build for wasm64.
// Same checks, same order, same errors, with the pure-Rust `p256` crate:
// - offsets parsing and bounds as upstream (get_data_slice is unchanged);
// - r in [1, n-1] and s in [1, n/2] (low-S), checked on the 32-byte big-endian values;
// - public key: 33-byte SEC1 compressed point, InvalidPublicKey if it does not decode;
// - ECDSA over SHA-256(message), InvalidSignature if it does not verify.
// The constants and offsets struct are copied from solana-secp256r1-program 3.0.0, whose
// non-wasm32 module pulls OpenSSL in.
use {
    agave_feature_set::FeatureSet,
    bytemuck::{Pod, Zeroable},
    p256::ecdsa::{Signature, VerifyingKey, signature::Verifier},
    solana_precompile_error::PrecompileError,
};

pub const COMPRESSED_PUBKEY_SERIALIZED_SIZE: usize = 33;
pub const SIGNATURE_SERIALIZED_SIZE: usize = 64;
pub const SIGNATURE_OFFSETS_SERIALIZED_SIZE: usize = 14;
pub const SIGNATURE_OFFSETS_START: usize = 2;
pub const FIELD_SIZE: usize = 32;

// Order of secp256r1 minus one, and half the order (SEC2 2.7.2), big-endian.
pub const SECP256R1_ORDER_MINUS_ONE: [u8; FIELD_SIZE] = [
    0xFF, 0xFF, 0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xBC, 0xE6, 0xFA, 0xAD, 0xA7, 0x17, 0x9E, 0x84, 0xF3, 0xB9, 0xCA, 0xC2, 0xFC, 0x63, 0x25, 0x50,
];
pub const SECP256R1_HALF_ORDER: [u8; FIELD_SIZE] = [
    0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCF, 0x42, 0x79, 0xDC, 0xE5, 0x61, 0x7E, 0x31, 0x92, 0xA8,
];

#[derive(Default, Debug, Copy, Clone, Zeroable, Pod, Eq, PartialEq)]
#[repr(C)]
pub struct Secp256r1SignatureOffsets {
    pub signature_offset: u16,
    pub signature_instruction_index: u16,
    pub public_key_offset: u16,
    pub public_key_instruction_index: u16,
    pub message_data_offset: u16,
    pub message_data_size: u16,
    pub message_instruction_index: u16,
}

// 1 <= x <= max, on equal-length big-endian byte strings.
fn in_range(x: &[u8], max: &[u8; FIELD_SIZE]) -> bool {
    x.iter().any(|b| *b != 0) && x <= &max[..]
}

pub fn verify(
    data: &[u8],
    instruction_datas: &[&[u8]],
    _feature_set: &FeatureSet,
) -> Result<(), PrecompileError> {
    if data.len() < SIGNATURE_OFFSETS_START {
        return Err(PrecompileError::InvalidInstructionDataSize);
    }
    let num_signatures = data[0] as usize;
    if num_signatures == 0 {
        return Err(PrecompileError::InvalidInstructionDataSize);
    }
    if num_signatures > 8 {
        return Err(PrecompileError::InvalidInstructionDataSize);
    }

    let expected_data_size = num_signatures
        .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE)
        .saturating_add(SIGNATURE_OFFSETS_START);

    // We do not check or use the byte at data[1]
    if data.len() < expected_data_size {
        return Err(PrecompileError::InvalidInstructionDataSize);
    }

    for i in 0..num_signatures {
        let start = i
            .saturating_mul(SIGNATURE_OFFSETS_SERIALIZED_SIZE)
            .saturating_add(SIGNATURE_OFFSETS_START);

        // SAFETY: data[start..] holds at least SIGNATURE_OFFSETS_SERIALIZED_SIZE bytes (checked
        // above) and Secp256r1SignatureOffsets is POD, read unaligned.
        let offsets = unsafe {
            core::ptr::read_unaligned(data.as_ptr().add(start) as *const Secp256r1SignatureOffsets)
        };

        let signature = get_data_slice(
            data,
            instruction_datas,
            offsets.signature_instruction_index,
            offsets.signature_offset,
            SIGNATURE_SERIALIZED_SIZE,
        )?;
        let pubkey = get_data_slice(
            data,
            instruction_datas,
            offsets.public_key_instruction_index,
            offsets.public_key_offset,
            COMPRESSED_PUBKEY_SERIALIZED_SIZE,
        )?;
        let message = get_data_slice(
            data,
            instruction_datas,
            offsets.message_instruction_index,
            offsets.message_data_offset,
            offsets.message_data_size as usize,
        )?;

        let (r, s) = signature.split_at(FIELD_SIZE);
        if !in_range(r, &SECP256R1_ORDER_MINUS_ONE) || !in_range(s, &SECP256R1_HALF_ORDER) {
            return Err(PrecompileError::InvalidSignature);
        }
        let ecdsa_sig =
            Signature::from_slice(signature).map_err(|_| PrecompileError::InvalidSignature)?;
        let public_key =
            VerifyingKey::from_sec1_bytes(pubkey).map_err(|_| PrecompileError::InvalidPublicKey)?;
        public_key
            .verify(message, &ecdsa_sig)
            .map_err(|_| PrecompileError::InvalidSignature)?;
    }
    Ok(())
}

fn get_data_slice<'a>(
    data: &'a [u8],
    instruction_datas: &'a [&[u8]],
    instruction_index: u16,
    offset_start: u16,
    size: usize,
) -> Result<&'a [u8], PrecompileError> {
    let instruction = if instruction_index == u16::MAX {
        data
    } else {
        let signature_index = instruction_index as usize;
        if signature_index >= instruction_datas.len() {
            return Err(PrecompileError::InvalidDataOffsets);
        }
        instruction_datas[signature_index]
    };

    let start = offset_start as usize;
    let end = start.saturating_add(size);
    if end > instruction.len() {
        return Err(PrecompileError::InvalidDataOffsets);
    }

    Ok(&instruction[start..end])
}
