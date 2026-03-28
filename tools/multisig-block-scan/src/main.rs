//! Scan a mainnet (or any) node for transactions in [start_height, end_height]
//! whose inputs reference a script (scriptSig or any witness stack item) that
//! contains both push-num-2 (0x52 / OP "2") and OP_CHECKMULTISIG (0xae).
//!
//! Env:
//!   BITCOIN_RPC_URL   default http://127.0.0.1:8332
//!   BITCOIN_RPC_COOKIE default ~/.bitcoin/.cookie
//!
//! Usage:
//!   multisig-block-scan START_HEIGHT END_HEIGHT
//!
//! One `get_block` RPC per block (binary block), then local scan only.

use std::env;
use std::path::PathBuf;
use std::time::Instant;

use bitcoin::blockdata::script::{Instruction, Script};
use bitcoin::Transaction;
use bitcoincore_rpc::{Auth, Client, RpcApi};

/// Minimal 2-of-2-style witness script is on the order of tens of bytes.
const WITNESS_ITEM_MIN_SCRIPT: usize = 24;
const OP_PUSHNUM_2: u8 = 0x52;
const OP_CHECKMULTISIG_U8: u8 = 0xae;

#[inline]
fn script_has_op2_and_checkmultisig(script: &Script) -> bool {
    let bytes = script.as_bytes();
    if bytes.len() < WITNESS_ITEM_MIN_SCRIPT {
        return false;
    }
    // Cheap rejection before instruction walk (both are single-byte opcodes in normal multisig).
    if !bytes.contains(&OP_CHECKMULTISIG_U8) || !bytes.contains(&OP_PUSHNUM_2) {
        return false;
    }

    let mut saw_2 = false;
    let mut saw_cms = false;
    for ins in script.instructions() {
        let Ok(inst) = ins else {
            break;
        };
        match inst {
            Instruction::Op(op) => {
                if op.to_u8() == OP_PUSHNUM_2 {
                    saw_2 = true;
                }
                if op.to_u8() == OP_CHECKMULTISIG_U8 {
                    saw_cms = true;
                }
                if saw_2 && saw_cms {
                    return true;
                }
            }
            Instruction::PushBytes(_) => {}
        }
    }
    false
}

#[inline]
fn input_might_match(txin: &bitcoin::TxIn) -> bool {
    let sp = txin.script_sig.as_script();
    if !sp.is_empty() && script_has_op2_and_checkmultisig(sp) {
        return true;
    }
    for item in txin.witness.iter() {
        if item.len() < WITNESS_ITEM_MIN_SCRIPT {
            continue;
        }
        if script_has_op2_and_checkmultisig(Script::from_bytes(item)) {
            return true;
        }
    }
    false
}

#[inline]
fn tx_matches(tx: &Transaction) -> bool {
    tx.input.iter().any(input_might_match)
}

fn default_cookie() -> PathBuf {
    let home = env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join(".bitcoin").join(".cookie")
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let start: u64 = args
        .next()
        .ok_or("usage: multisig-block-scan START_HEIGHT END_HEIGHT")?
        .parse()?;
    let end: u64 = args
        .next()
        .ok_or("usage: multisig-block-scan START_HEIGHT END_HEIGHT")?
        .parse()?;
    if end < start {
        return Err("END_HEIGHT must be >= START_HEIGHT".into());
    }

    let url = env::var("BITCOIN_RPC_URL").unwrap_or_else(|_| "http://127.0.0.1:8332".into());
    let cookie = env::var("BITCOIN_RPC_COOKIE").unwrap_or_else(|_| {
        default_cookie()
            .to_string_lossy()
            .into_owned()
    });

    let rpc = Client::new(&url, Auth::CookieFile(cookie.into()))?;
    rpc.ping()?;

    let t0 = Instant::now();
    let mut matches: Vec<String> = Vec::new();
    matches.reserve(256);

    for height in start..=end {
        let hash = rpc.get_block_hash(height)?;
        let block = rpc.get_block(&hash)?;
        for tx in &block.txdata {
            if tx_matches(tx) {
                matches.push(tx.compute_txid().to_string());
            }
        }
    }

    let elapsed = t0.elapsed();
    eprintln!(
        "Scanned blocks {}..={} in {:?} — {} matching txid(s)",
        start,
        end,
        elapsed,
        matches.len()
    );

    for id in matches {
        println!("{}", id);
    }

    Ok(())
}
