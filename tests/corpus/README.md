# BTSL parser corpus

Each `.btsl` file is **normative input** for the reference parser. CI compares output
to snapshots in `tests/__snapshots__/parser-corpus.test.ts.snap`.

## Standard examples ([btsl-standard `examples/`](https://github.com/tsua0002/btsl-standard/tree/master/examples))

| File | Upstream folder |
|------|-----------------|
| `examples-tri-count-shared-payment.btsl` | `tri-count-shared-payment/` |
| `examples-multisig-2-of-2.btsl` | `multisig-2-of-2/` |
| `examples-op-return-deploy.btsl` | `op-return-deploy/` |
| `examples-timelocked-vault.btsl` | `timelocked-vault/` |
| `examples-single-key-from-pubkey.btsl` | `single-key-from-pubkey/` |

**Indentation:** The reference parser expects **4 spaces per indent level**. Files in
`btsl-standard` often use a single leading space; corpus copies use 4-space blocks.

**Multisig:** Upstream `schema.bts` uses placeholder-empty `witness_data` and a
minimal `asm` line. This corpus uses **spec §6.2** asm and witness placeholders so
the document parses to a complete AST (same semantics as the spec).

**Timelock unlock:** `witness_data SIG1` uses `<SIGN_WITH(@USER_KEY)>` (spec-style)
where the upstream template leaves the value empty.

## Other fixtures

| File | Role |
|------|------|
| `invalid-no-schema.btsl` | Parse failure: no `PSBT_SCHEMA` |

## Adding fixtures

1. Add `name.btsl` here.
2. Run `npm run test -- --update` once, then review the snapshot diff.
