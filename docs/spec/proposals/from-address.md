# Proposal: `From(@ADDRESS) AS alias` (in addition to `From(@PUBKEY)`)

## Motivation (UX)

Newcomers often know **an address** (e.g. `bc1q…`, `bc1p…`) but do not have the corresponding
**public key** handy. In wallet UIs, the address is the primary identifier, while the pubkey
is sometimes hidden.

Adding `From(@ADDRESS)` enables a “paste address → resolve a funding UTXO → build PSBT”
experience that is significantly easier for first-time users in the BTSL playground.

## Why `@PUBKEY` exists (and what you lose with `@ADDRESS`)

`From(@PUBKEY)` is not only an indexer lookup; it is a **key-anchored resolver**:

- It can be used to ensure the selected UTXO is bound to a specific **key** (by derivation).
- It supports choosing the correct address encoding by **declared input type**
  (`NATIVE P2WPKH`, `NATIVE P2PKH`, `NATIVE P2TR`/`P2TR_KEY`).

`From(@ADDRESS)` is an **address-anchored resolver**:

- It can enumerate UTXOs for an address (indexer list-query) and pick the largest-first.
- It does **not** prove which pubkey(s) can spend the output (for P2WSH/P2TR script-path, etc.).
- It does **not** provide a cryptographic “this is the key X” anchor; it is a weaker binding.

This is acceptable for the **playground UX** and for workflows where “address is the contract anchor”.
For higher-assurance schemas, `From(@PUBKEY)` remains the recommended primitive.

## Proposed spec addition (normative shape)

Add a resolver form alongside `From(@PUBKEY)`:

```
utxo: From(@ADDR) AS alias
```

Where:

- `@ADDR` MUST be declared as `@ADDR:Address` in `PARAMS`.
- The engine MUST list confirmed UTXOs for `@ADDR` and select the **largest by amount**
  (largest-first).
- The selected UTXO is bound under `alias` exactly as with `From(@PUBKEY)`:
  - `alias.amount` is a `SAT` integer usable in `calc`.
  - `alias.address` may be used in `OUTPUTS` as an `address_ref`.
- If no confirmed UTXO is found → `BTSL_ERR_09`.

### Validation note

Unlike `From(@PUBKEY)`, `From(@ADDRESS)` does not derive the address. Therefore no
`native_input_type`-based derivation applies. The binding is purely “UTXO(s) at this address”.

## Suggested documentation note for implementers

Implementations should treat `From(@ADDRESS)` as a UX convenience and keep
`From(@PUBKEY)` as the “key-anchored” option. A checker/signer that wants key-level
assurance should prefer `From(@PUBKEY)` or require an explicit pubkey/script anchor.

## GitHub issue recommendation

This should be a **public issue** if BTSL is intended to be community-reviewed and to
converge on a shared standard. Public discussion helps catch edge cases (Taproot,
script-path spends, wallet interoperability).

If there are concerns about premature exposure, start public with a clear label
`proposal` / `spec-change` and mark it `[DRAFT]` (like the spec), or open privately
and mirror publicly once the normative wording is stable.

