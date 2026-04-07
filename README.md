# BTSL Schema Playground

A client-side playground for the **Bitcoin Transaction Schema Language (BTSL)** — a declarative validation schema for PSBT workflows.

Parse BTSL schemas, bind parameters against live on-chain data, generate JavaScript code, and export unsigned PSBTs ready for signing.

> **All operations run entirely in your browser. No private keys are ever involved.**

## npm packages (`@btsl/*`)

Publishable libraries (parser, runtime, validator) are developed in a **separate** directory/repo: **`btsl-packages`** (sibling of this repo in a typical `dev/` layout). See `../btsl-packages/ARCHITECTURE.md` for the package split and roadmap. This repository remains the playground and the reference copy of the engine under `lib/btsl/` until those packages consume it.

## What is BTSL?

BTSL is a declarative language that specifies **what a valid Bitcoin transaction should look like** before anyone signs it. It separates construction logic from validation logic, enabling independent verification of transaction invariants (fees, change, output structure) by any signer or auditor.

BTSL does not modify the PSBT format or introduce new consensus rules. It operates above BIP174/BIP370 as a pure validation layer.

- [BTSL Specification v1.0](https://github.com/tsua0002/btsl-standard)
- [Delving Bitcoin discussion](https://delvingbitcoin.org/t/btsl-bitcoin-transaction-schema-language-a-declarative-validation-schema-for-psbt-workflows/2338)

**Local spec copy:** `docs/spec/` mirrors the current markdown from the [`btsl-standard`](https://github.com/tsua0002/btsl-standard) repo (`btsl-spec-v1.0.md`, `btsl-implementation-guide-v1.0.md`, `btsl-checker-predicates-v1.0.md`) for offline reading and diffing against this codebase. It is not consumed by the app build; refresh it when the upstream spec changes.

## Validator (Checker)

The **Validator** tab runs `runCheckerPipeline` (`lib/btsl/checker-pipeline.ts`) against the [BTSL v1.0.0 spec §9.3.1](https://github.com/tsua0002/btsl-standard/blob/v1.0.0/spec/btsl-spec-v1.0.md) checker predicates: **S-1/S-2** (`ERR_13`), **I-1…I-4**, **I-3** (`ERR_11`), **O-1/O-2**, **A-1…A-5** (algebraic phase), with error codes aligned to **§5.3**. Field-level helpers live in `lib/btsl/checker-predicates.ts`.

## Pipeline

The playground implements the **Maker pipeline** from the spec:

```
Schema Input → Parameter Binding → Code Generation → PSBT Output
```

1. **Schema Input** — Paste or select a BTSL schema from the built-in catalog.
2. **Parameter Binding** — Fill `@PARAM` values (UTXOs, addresses, fee rate). UTXOs are fetched live from Blockstream API, fee rates from Mempool.space.
3. **Code Generation** — Generates standalone JavaScript that constructs the PSBT via `bitcoinjs-lib`, runs `calc`, evaluates `ASSERT`, and performs the zero-trust audit (balance check, dust check, weight check).
4. **PSBT Output** — Export the unsigned PSBT as Base64 or Hex. Import into Sparrow, Coldcard, bitcoin-cli, or any BIP174-compatible signer.

## Built-in Examples

| Example | Pattern | Spec Section |
|---------|---------|-------------|
| Simple Payment | `From(@PUBKEY)` + CHANGE | §6.5 |
| TRI-COUNT | Multi-input shared settlement | §6.1 |
| Multisig 1-of-2 / 2-of-2 | P2WSH SCRIPT_DEFS + witness_data | §6.2 |
| OP_RETURN Deploy | OP_RETURN + CHANGE | §6.3 |
| Taproot Vault | P2TR + DEPENDS_ON workflow | §6.4 |

## Getting Started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tests

```bash
pnpm test
```

Parser corpus tests validate all built-in examples and error cases against deterministic snapshots.

## Status

This playground covers the **Maker (construction) pipeline** of the BTSL specification. The **Validator (verification) pipeline** — including Zero-Trust UTXO restoration and independent ASSERT replay — is under active development.

## License

[MIT](LICENSE)
