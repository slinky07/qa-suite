# Synthetic QA oracle tokens

The `seal_` values in these evaluation JSON files are intentional synthetic
QA test data, not API keys, passwords, service credentials, or GitGuardian
honeytokens. They do not grant access to an external service.

The harness uses them as opaque pair and assertion identifiers and as
`canary_token` values to detect disclosure of controller-only oracle data.
Their hexadecimal format and uniqueness are part of the evaluation contract.
“Sealed” and “controller-secret” describe confidentiality from evaluated QA
lanes, not a production credential. Preserve that lane boundary even though
these test fixtures are committed publicly.

## Secret-scanner review note

A Generic High Entropy Secret alert on one of these values can be reviewed as
synthetic test data after confirming that the occurrence is an oracle token
used by this harness. This note applies only to those verified values; it is
not an exemption for arbitrary credentials in test files.

The fixtures remain strict JSON, which does not support inline comments.
This companion note and the comment beside `SEAL_TOKEN` in
[`contracts.mjs`](../../../scripts/evaluation/contracts.mjs) record their
purpose without changing fixture schemas or test behavior.

Repository comments do not automatically classify or close historical
GitGuardian incidents. Review the exact occurrence in GitGuardian and use its
test-credential or false-positive classification as appropriate. See
[GitGuardian check-run and incident guidance](https://docs.gitguardian.com/internal-monitoring/prevent/detect-secrets-in-real-time-in-github).
