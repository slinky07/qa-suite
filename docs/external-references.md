# Controlled external references

External playbooks, papers, PDFs, and similar documents are evidence inputs,
not executable QA-Suite authority. A source may inform a reviewed decision, but
future agents follow the resulting ADR, RFC, or project contract rather than
interpreting the source independently.

[`external-reference-register.json`](external-reference-register.json) is the
canonical inventory. [`adr/0001-controlled-external-references.md`](adr/0001-controlled-external-references.md)
owns the authority decision and citation model. `docs/releasing.md` owns the
distribution gate.

## Intake and approval

1. Assign the next stable `REF-####` ID. A new source version receives a new
   ID; never overwrite a prior record or binary.
2. Hash the exact reviewed bytes with SHA-256 and record every register field.
   Unknown provenance or rights data stays explicit as `null`; it is never
   inferred from a filename, branding, or cited upstream material.
3. The control owner chooses one storage mode:
   - `approved-document-store` is the default for a source that must be
     retained outside Git. Record its durable locator only after access and
     retention are approved.
   - `metadata-only` retains the identity, digest, and disposition when the
     source cannot be stored or redistributed. The register is durable; the
     local binary is not.
   - `repository-git-lfs` is exceptional. It requires verified provenance,
     documentary license evidence, explicit redistribution approval, an exact
     channel allowlist, and a reviewed Git LFS pointer. Store the pointer under
     `docs/external-reference-files/`, or under
     `qa-suite/references/external/` only when the generated archives are also
     explicitly approved. Raw document binaries are never committed.
4. Review classification, provenance, license, redistribution, retention, and
   distribution together. Pending or rejected entries have no repository path
   and no distribution channels.
5. Record a dated disposition. Supersession and disposal append history; they
   do not erase the previous record.

## Register contract

The register has `schema_version: 1` and a `references` array. Every reference
records:

- stable ID, title, independent author and publisher fields, original source
  URL, publication or version date and its basis, and acquisition date;
- control owner, classification, provenance status, license evidence,
  redistribution decision, SHA-256, review date, retention decision and
  review-due date, and current status;
- storage mode and locator, distribution decision and channels, derived
  authorities, supersession history, and final disposition.

`null` is allowed only as an explicit pending-provenance value. It never grants
permission. An active repository-distributed entry must have verified
provenance, non-empty license evidence, approved redistribution, and an exact
allowlist. The release check validates the complete entry and Git LFS pointer
from the immutable Git ref.

Classifications have operational consequences:

- `public` means the record and source are approved for public handling. It
  still grants no redistribution right by itself, but it is the only
  classification eligible for a repository path or distribution allowlist.
- `internal` means access is limited to the project team. Retain only metadata
  or an access-controlled document-store locator; do not put the source in Git
  or distribution.
- `restricted` means provenance, rights, sensitivity, or handling is unresolved
  or specifically limited. Keep the tracked record safe and minimal; the source
  remains outside Git and distribution.

Retention uses `retain-metadata`, `retain-source`, or `dispose-source`, with a
plain-language term and a review-due date for every non-final record.
Repository or approved-document-store sources use `retain-source`; metadata-only
records use `retain-metadata`. A disposal is dated and reasoned in
`disposition`. Review does not silently delete an older record or source.
`active` and `provenance-and-rights-pending` are non-final; `superseded`,
`disposed`, and `rejected` are final lifecycle states.

Distribution channels are:

- `tagged-repository` for the repository consumed by Claude Code and Codex;
- `claude-ai` for `qa-suite.skill`;
- `source-archive` for `qa-suite-source.zip` and the local-skill copy.

A repository path always requires `tagged-repository`. A path below
`qa-suite/` also requires `claude-ai` and `source-archive`, because the same
bytes enter both generated archives.

## Derived project authority

Guidance becomes project authority only through a reviewed ADR, RFC, or
equivalent tracked contract. Each adopted rule cites:

- the `REF-####` ID;
- an exact page, section, figure, table, or other stable locator;
- whether the guidance was adopted, modified, or rejected; and
- the project-specific reason.

The register mirrors those links in `derived_authorities`. Each entry points to
a tracked Markdown authority under `docs/adr/` or `docs/rfcs/`, and its locator
starts with a page, section, figure, or table reference. A source's title or
reputation cannot bypass review. If the source disappears or its rights remain
unknown, the derived decision stays auditable through the recorded digest and
locator, while the source binary remains excluded.

## REF-0001 disposition

The motivating local PDF is identified only by its reviewed title and SHA-256.
Its content says that it is an independent July 2026 synthesis for study and is
not affiliated with or endorsed by Anthropic. The PDF metadata does not name an
author or publisher, and the local copy provides no verifiable acquisition URL
or license grant. Attribution of cited public materials is not provenance or a
redistribution grant for the compilation.

`REF-0001` is therefore `provenance-and-rights-pending`, classified
`restricted`, and retained as metadata only. No guidance is adopted from it by
this decision. Its binary stays outside Git, plugin marketplaces, generated
archives, and release assets unless a later reviewed record proves provenance
and rights and explicitly allowlists the required channels.
