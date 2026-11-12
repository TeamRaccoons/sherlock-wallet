//! LiteSVM compiled to WebAssembly (memory64) with a tiny C-style ABI.
//!
//! No wasm-bindgen: the JS side (src/sim/wasmSvm.ts) copies bytes in and out of
//! linear memory. One global VM instance; accounts are pushed in by the host
//! (fetched from an RPC and optionally overridden), then transactions are
//! simulated read-only, so the same loaded state can serve many simulations.
//!
//! Exports (all integers are i64 on wasm64 because usize is 64-bit):
//!   svm_alloc(len) -> ptr            svm_free(ptr, len)
//!   svm_reset()                      fresh VM (LiteSVM's mainnet feature snapshot)
//!   svm_feature_ids()                JSON array of every feature id this runtime knows
//!   svm_reset_with_features(ptr, len) fresh VM with exactly these active features
//!                                    (packed: id[32] activation_slot:u64le, repeated)
//!   svm_drop()                       free the VM (linear memory stays allocated)
//!   svm_set_account(ptr, len) -> i32 packed account, see `set_account`
//!   svm_set_clock(slot, epoch_start_ts, epoch, leader_epoch, unix_ts)
//!   svm_simulate(ptr, len) -> i32    wire transaction; JSON result, state unchanged
//!   svm_execute(ptr, len) -> i32     wire transaction; JSON result, state COMMITTED
//!   svm_get_accounts(ptr, len)       packed addresses -> JSON accounts (or null)
//!   svm_out_ptr() / svm_out_len()    last JSON output (result or error)

use {
    base64::Engine,
    agave_feature_set::FeatureSet,
    litesvm::LiteSVM,
    serde_json::{json, Value},
    solana_account::Account,
    solana_address::Address,
    solana_clock::Clock,
    solana_transaction::versioned::VersionedTransaction,
    std::cell::RefCell,
};

pub use litesvm;

thread_local! {
    static VM: RefCell<Option<LiteSVM>> = const { RefCell::new(None) };
    static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn new_vm() -> LiteSVM {
    vm_with_features(LiteSVM::mainnet_feature_set())
}

fn vm_with_features(features: FeatureSet) -> LiteSVM {
    // Like LiteSVM::new() minus the bundled SPL program ELFs (we load the real
    // mainnet programs from the RPC instead) and with sigverify/blockhash
    // checks off, as for RPC simulateTransaction with sigVerify=false.
    LiteSVM::default()
        .with_feature_set(features)
        .with_builtins()
        .with_sysvars()
        .with_feature_accounts()
        .with_sigverify(false)
        .with_blockhash_check(false)
        .with_transaction_history(0)
        .with_log_bytes_limit(Some(10_000)) // same truncation as Agave RPC
        .with_precompiles() // ed25519, secp256k1, secp256r1 (vendored, no OpenSSL)
}

fn with_vm<R>(f: impl FnOnce(&mut LiteSVM) -> R) -> R {
    VM.with(|vm| {
        let mut vm = vm.borrow_mut();
        f(vm.get_or_insert_with(new_vm))
    })
}

fn set_out(v: &Value) {
    OUT.with(|o| *o.borrow_mut() = serde_json::to_vec(v).unwrap_or_default());
}

fn b58(bytes: &[u8]) -> String {
    bs58::encode(bytes).into_string()
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[no_mangle]
pub extern "C" fn svm_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr`/`len` must come from `svm_alloc`.
#[no_mangle]
pub unsafe extern "C" fn svm_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

#[no_mangle]
pub extern "C" fn svm_out_ptr() -> *const u8 {
    OUT.with(|o| o.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn svm_out_len() -> usize {
    OUT.with(|o| o.borrow().len())
}

#[no_mangle]
pub extern "C" fn svm_reset() {
    VM.with(|vm| *vm.borrow_mut() = Some(new_vm()));
}

#[no_mangle]
pub extern "C" fn svm_drop() {
    VM.with(|vm| *vm.borrow_mut() = None);
    OUT.with(|o| *o.borrow_mut() = Vec::new());
}

/// Writes the JSON array of every feature id known to this runtime to the out buffer.
#[no_mangle]
pub extern "C" fn svm_feature_ids() {
    let fs = FeatureSet::default();
    let ids: Vec<String> = fs
        .inactive()
        .iter()
        .chain(fs.active().keys())
        .map(|id| id.to_string())
        .collect();
    set_out(&json!(ids));
}

/// Replaces the VM with one whose active features are exactly the given ones
/// (read from the chain's feature accounts by the host).
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn svm_reset_with_features(ptr: *const u8, len: usize) {
    let buf = std::slice::from_raw_parts(ptr, len);
    let mut fs = FeatureSet::default();
    for chunk in buf.chunks_exact(40) {
        let id = Address::new_from_array(chunk[..32].try_into().unwrap());
        fs.activate(&id, u64::from_le_bytes(chunk[32..].try_into().unwrap()));
    }
    VM.with(|vm| *vm.borrow_mut() = Some(vm_with_features(fs)));
}

#[no_mangle]
pub extern "C" fn svm_set_clock(
    slot: u64,
    epoch_start_timestamp: i64,
    epoch: u64,
    leader_schedule_epoch: u64,
    unix_timestamp: i64,
) {
    with_vm(|vm| {
        vm.set_sysvar(&Clock {
            slot,
            epoch_start_timestamp,
            epoch,
            leader_schedule_epoch,
            unix_timestamp,
        })
    });
}

/// Packed account: address[32] owner[32] lamports:u64le rent_epoch:u64le
/// executable:u8 data[..]. Returns 0 on success, 1 on error (JSON in out).
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn svm_set_account(ptr: *const u8, len: usize) -> i32 {
    let buf = std::slice::from_raw_parts(ptr, len);
    if buf.len() < 81 {
        set_out(&json!({ "error": "account buffer too short" }));
        return 1;
    }
    let address = Address::new_from_array(buf[0..32].try_into().unwrap());
    let owner = Address::new_from_array(buf[32..64].try_into().unwrap());
    let lamports = u64::from_le_bytes(buf[64..72].try_into().unwrap());
    let rent_epoch = u64::from_le_bytes(buf[72..80].try_into().unwrap());
    let executable = buf[80] != 0;
    let account = Account {
        lamports,
        data: buf[81..].to_vec(),
        owner,
        executable,
        rent_epoch,
    };
    match with_vm(|vm| vm.set_account(address, account)) {
        Ok(()) => 0,
        Err(e) => {
            set_out(&json!({ "error": format!("set_account {address}: {e:?}") }));
            1
        }
    }
}

unsafe fn decode_tx(ptr: *const u8, len: usize) -> Option<VersionedTransaction> {
    let bytes = std::slice::from_raw_parts(ptr, len);
    match wincode::deserialize(bytes) {
        Ok(tx) => Some(tx),
        Err(e) => {
            set_out(&json!({ "error": format!("decode transaction: {e}") }));
            None
        }
    }
}

fn account_json(a: &impl solana_account::ReadableAccount) -> Value {
    json!({
        "lamports": a.lamports(),
        "owner": a.owner().to_string(),
        "executable": a.executable(),
        "data": b64(a.data()),
    })
}

/// The per-transaction result object shared by svm_simulate and svm_execute.
fn result_json(
    err: Value,
    meta: &litesvm::types::TransactionMetadata,
    post: &[(Address, solana_account::AccountSharedData)],
) -> Value {
    let inner: Vec<Value> = meta
        .inner_instructions
        .iter()
        .enumerate()
        .filter(|(_, list)| !list.is_empty())
        .map(|(index, list)| {
            json!({
                "index": index,
                "instructions": list.iter().map(|ix| json!({
                    "programIdIndex": ix.instruction.program_id_index,
                    "accounts": ix.instruction.accounts,
                    "data": b58(&ix.instruction.data),
                    "stackHeight": ix.stack_height,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let return_data = if meta.return_data.data.is_empty() {
        Value::Null
    } else {
        json!({
            "programId": meta.return_data.program_id.to_string(),
            "data": [b64(&meta.return_data.data), "base64"],
        })
    };
    let post_accounts: Vec<Value> = post
        .iter()
        .map(|(k, a)| {
            let mut v = account_json(a);
            v["pubkey"] = json!(k.to_string());
            v
        })
        .collect();
    json!({
        "err": err,
        "logs": meta.logs,
        "unitsConsumed": meta.compute_units_consumed,
        "fee": meta.fee,
        "returnData": return_data,
        "innerInstructions": inner,
        "postAccounts": post_accounts,
    })
}

/// Simulates a VersionedTransaction (raw wire bytes: legacy, v0 or v1) without
/// changing the VM's state. Writes a JSON object to the out buffer:
/// { err, logs, unitsConsumed, fee, returnData, innerInstructions,
///   postAccounts: [{ pubkey, lamports, owner, executable, data (base64) }] }
/// Returns 0 when the VM ran (err may still be set), 1 when the input was bad.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn svm_simulate(ptr: *const u8, len: usize) -> i32 {
    let Some(tx) = decode_tx(ptr, len) else { return 1 };
    let out = match with_vm(|vm| vm.simulate_transaction(tx)) {
        Ok(info) => result_json(Value::Null, &info.meta, &info.post_accounts),
        Err(failed) => result_json(
            serde_json::to_value(&failed.err).unwrap_or(Value::Null),
            &failed.meta,
            &[],
        ),
    };
    set_out(&out);
    0
}

/// Executes a transaction and COMMITS it to the VM's accounts, as a validator
/// would: on success every account change is kept; on failure only the fee is
/// charged to the payer (when the transaction got far enough to be included),
/// everything else is left as it was. Same JSON as svm_simulate, with an empty
/// postAccounts: read the committed state with svm_get_accounts.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn svm_execute(ptr: *const u8, len: usize) -> i32 {
    let Some(tx) = decode_tx(ptr, len) else { return 1 };
    let out = match with_vm(|vm| vm.send_transaction(tx)) {
        Ok(meta) => result_json(Value::Null, &meta, &[]),
        Err(failed) => result_json(
            serde_json::to_value(&failed.err).unwrap_or(Value::Null),
            &failed.meta,
            &[],
        ),
    };
    set_out(&out);
    0
}

/// Reads accounts from the VM: packed 32-byte addresses in, JSON array out,
/// one { lamports, owner, executable, data (base64) } or null per address.
///
/// # Safety
/// `ptr` must point to `len` readable bytes.
#[no_mangle]
pub unsafe extern "C" fn svm_get_accounts(ptr: *const u8, len: usize) {
    let buf = std::slice::from_raw_parts(ptr, len);
    let out: Vec<Value> = with_vm(|vm| {
        buf.chunks_exact(32)
            .map(|c| {
                let address = Address::new_from_array(c.try_into().unwrap());
                vm.accounts_db()
                    .get_account_ref(&address)
                    .map(account_json)
                    .unwrap_or(Value::Null)
            })
            .collect()
    });
    set_out(&json!(out));
}

#[cfg(target_family = "wasm")]
mod rng {
    // Simulation never needs real entropy (only Keypair::new() for LiteSVM's
    // unused airdrop key). xorshift stream, no wasm-bindgen / JS import needed.
    static mut STATE: u64 = 0x9E37_79B9_7F4A_7C15;
    fn fill(buf: &mut [u8]) {
        for b in buf.iter_mut() {
            unsafe {
                STATE ^= STATE << 13;
                STATE ^= STATE >> 7;
                STATE ^= STATE << 17;
                *b = STATE as u8;
            }
        }
    }
    fn custom_02(buf: &mut [u8]) -> Result<(), getrandom_02::Error> {
        fill(buf);
        Ok(())
    }
    getrandom_02::register_custom_getrandom!(custom_02);

    #[no_mangle]
    unsafe extern "Rust" fn __getrandom_v03_custom(
        dest: *mut u8,
        len: usize,
    ) -> Result<(), getrandom_03::Error> {
        fill(core::slice::from_raw_parts_mut(dest, len));
        Ok(())
    }
}
