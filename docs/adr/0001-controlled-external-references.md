# ADR 0001: Control external engineering references

- Status: Accepted
- Date: 2026-07-29
- Issue: #50

## Context

External engineering documents can disappear, change, carry unclear rights, or
be interpreted differently by each agent. A local filename is not evidence of
authorship, publication, provenance, version, or permission to redistribute.
QA-Suite also ships through tagged-repository plugin channels and two generated
archives, so an uncontrolled tracked binary can cross a distribution boundary.

## Decision

External references are controlled evidence inputs, never executable project
authority.

- The tracked register and policy at `docs/external-reference-register.json`
  and `docs/external-references.md` control identity, integrity, provenance,
  rights, storage, review, supersession, retention, and disposition.
- Classification is operational: only `public` sources can be repository or
  distribution candidates. `internal` and `restricted` sources stay in
  approved external storage or metadata-only control.
- The default safe state is metadata-only or an approved external document
  store. Repository storage requires Git LFS, verified rights, and an explicit
  distribution allowlist.
- Project rules derived from a reference live in a reviewed ADR, RFC, or
  equivalent authority. Each rule cites a `REF-####` ID and exact page or
  section, records adopted, modified, or rejected treatment, and explains why.
- Release validation reads the exact Git ref, rejects uncontrolled reference
  binaries across the whole tagged repository, and validates any exceptional
  Git LFS pointer against the register.
- New versions receive new IDs. Prior records and source versions are retained
  or receive a dated disposal entry; they are never silently overwritten.

`REF-0001` is the motivating example only. This ADR adopts no engineering
guidance from that document. Its provenance and redistribution rights remain
unverified, so only its metadata and digest are retained and its binary is
excluded from Git and distribution.

## Consequences

Future agents have one durable intake path and one authority boundary. Missing
provenance or rights fails closed without discarding the evidence that a source
was reviewed. An explicitly approved repository binary carries the operational
cost of Git LFS, license evidence, channel review, and release validation.

The register is append-oriented. A later promotion, supersession, or disposal
changes the record through review; it cannot be inferred from a file appearing
in a checkout.
