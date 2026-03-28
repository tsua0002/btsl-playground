//! Scan blocks for spends whose witness reveals a tapscript compatible with the BTSL
//! timelocked-vault pattern:
//!   `<user_pubkey> <csv_locktime> OP_CSV OP_DROP OP_CHECKSIG`
//! (see examples: `VAULT_P2TR` / `unlock_path` in `lib/btsl/examples-catalog.ts`).
//!
//! At **deposit**, only the P2TR output is visible on-chain (internal key + Merkle root).
//! The leaf script appears only on a **script-path spend**; this tool detects that reveal.
//!
//! Env:
//!   BITCOIN_RPC_URL      default http://127.0.0.1:8332
//!   BITCOIN_RPC_COOKIE   default ~/.bitcoin/.cookie
//!   VAULT_CSV_LOCKTIME   optional; if set (e.g. `100`), require the stack operand before OP_CSV
//!                        to decode to that integer (CScriptNum: **little-endian** sign-magnitude
//!                        as in Bitcoin Core; small values may use OP_0 / OP_1..OP_16).
//!
//! Usage:
//!   taproot-vault-block-scan START_HEIGHT END_HEIGHT
//!
//! One `get_block` RPC per block; local scan only.

use std::env;
use std::path::PathBuf;
use std::time::Instant;

use bitcoin::blockdata::script::{read_scriptint, Instruction, Script};
use bitcoin::Transaction;
use bitcoincore_rpc::{Auth, Client, RpcApi};

const OP_CHECKSEQUENCEVERIFY: u8 = 0xb2;
const OP_DROP: u8 = 0x75;
const OP_CHECKSIG: u8 = 0xac;

/// Tapscripts shorter than this are ignored (pubkey + locktime + 3 opcodes is already larger).
const MIN_VAULT_SCRIPT_LEN: usize = 38;

/// Operand pushed immediately before OP_CSV: decode as Bitcoin **CScriptNum** (LE on wire).
#[inline]
fn csv_operand_as_i64(inst: &Instruction) -> Option<i64> {
    match inst {
        Instruction::Op(op) => {
            let c = op.to_u8();
            // OP_0: empty push, numerically zero on stack (CSV operand).
            if c == 0x00 {
                Some(0)
            } else if (0x51..=0x60).contains(&c) {
                // OP_1 .. OP_16 → 1..16
                Some(i64::from(c - 0x50))
            } else {
                None
            }
        }
        Instruction::PushBytes(b) => read_scriptint(b.as_bytes()).ok(),
    }
}

#[inline]
fn instruction_is_locktime(inst: &Instruction, lt: u32) -> bool {
    match csv_operand_as_i64(inst) {
        Some(v) if v == i64::from(lt) && v >= 0 => true,
        _ => false,
    }
}

fn vault_like_tapscript(script: &Script, require_locktime: Option<u32>) -> bool {
    let bytes = script.as_bytes();
    if bytes.len() < MIN_VAULT_SCRIPT_LEN {
        return false;
    }
    if !bytes.contains(&OP_CHECKSEQUENCEVERIFY)
        || !bytes.contains(&OP_DROP)
        || !bytes.contains(&OP_CHECKSIG)
    {
        return false;
    }

    let mut instrs: Vec<Instruction<'_>> = Vec::with_capacity(8);
    for ins in script.instructions() {
        let Ok(inst) = ins else {
            return false;
        };
        instrs.push(inst);
    }

    let Some(csv_pos) = instrs.iter().position(|i| {
        matches!(i, Instruction::Op(op) if op.to_u8() == OP_CHECKSEQUENCEVERIFY)
    }) else {
        return false;
    };

    if csv_pos == 0 || csv_pos + 3 != instrs.len() {
        return false;
    }

    match (&instrs[csv_pos], &instrs[csv_pos + 1], &instrs[csv_pos + 2]) {
        (
            Instruction::Op(a),
            Instruction::Op(b),
            Instruction::Op(c),
        ) if a.to_u8() == OP_CHECKSEQUENCEVERIFY
            && b.to_u8() == OP_DROP
            && c.to_u8() == OP_CHECKSIG => {}
        _ => return false,
    }

    if let Some(lt) = require_locktime {
        if !instruction_is_locktime(&instrs[csv_pos - 1], lt) {
            return false;
        }
    }

    true
}

#[inline]
fn tx_input_reveals_vault(txin: &bitcoin::TxIn, require_locktime: Option<u32>) -> bool {
    for item in txin.witness.iter() {
        if item.len() < MIN_VAULT_SCRIPT_LEN {
            continue;
        }
        let scr = Script::from_bytes(item);
        if vault_like_tapscript(scr, require_locktime) {
            return true;
        }
    }
    false
}

#[inline]
fn tx_matches(tx: &Transaction, require_locktime: Option<u32>) -> bool {
    tx.input
        .iter()
        .any(|i| tx_input_reveals_vault(i, require_locktime))
}

fn default_cookie() -> PathBuf {
    let home = env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join(".bitcoin").join(".cookie")
}

fn parse_optional_csv_env() -> Result<Option<u32>, std::num::ParseIntError> {
    match env::var("VAULT_CSV_LOCKTIME") {
        Ok(s) if s.is_empty() => Ok(None),
        Ok(s) => s.parse::<u32>().map(Some),
        Err(_) => Ok(None),
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let require_lt = parse_optional_csv_env()?;

    let mut args = env::args().skip(1);
    let start: u64 = args
        .next()
        .ok_or("usage: taproot-vault-block-scan START_HEIGHT END_HEIGHT")?
        .parse()?;
    let end: u64 = args
        .next()
        .ok_or("usage: taproot-vault-block-scan START_HEIGHT END_HEIGHT")?
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
    matches.reserve(64);

    for height in start..=end {
        let hash = rpc.get_block_hash(height)?;
        let block = rpc.get_block(&hash)?;
        for tx in &block.txdata {
            if tx_matches(tx, require_lt) {
                matches.push(tx.compute_txid().to_string());
            }
        }
    }

    let elapsed = t0.elapsed();
    eprintln!(
        "Scanned blocks {}..={} in {:?} — {} txid(s) with vault-like tapscript in witness{}",
        start,
        end,
        elapsed,
        matches.len(),
        if let Some(lt) = require_lt {
            format!(" (CSV push must encode locktime {})", lt)
        } else {
            String::new()
        }
    );

    for id in matches {
        println!("{}", id);
    }

    Ok(())
}
