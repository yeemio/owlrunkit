# OwlRunKit 0.20.1 Release Truth and Profile Normalization Patch Decision

Date: 2026-08-13
Status: `release_artifact_registry_gated`

## Decision

OwlRunKit 0.20.1 is a bounded patch over 0.20.0. It fixes six defects found by
installing the official 0.20.0 registry package into an isolated consumer and
then running bootstrap, doctor, profile validation, Team recommendation, and
Quick attestation.

The patch does not add Team dispatch, new assurance gates, deployment
authority, or any other product branch.

## Verified 0.20.0 dogfood facts

- Exact registry installation and project-local bootstrap completed.
- Doctor was ready, 28 profiles validated, Team recommendation remained
  read-only, and Quick attestation returned GO.
- The installed 0.20.0 README, Skill, and release policy still carried stale
  candidate-lifecycle wording and a stale 0.19.2 registry pointer.
- Applying profile reconciliation rewrote tracked `profiles.json` bytes for a
  formatting-only normalization even though the update list was empty.
- An older bootstrap receiving the 0.20.0 exact spec reported only its own
  0.19.1 exact spec and a generic issue code instead of the install-and-retry
  correction.
- `inspect --json` retained complete execution and Project Driver history for
  a routine blank-session status read.
- Five historical `no_bound_verification_receipt` warnings were non-blocking
  but lacked severity, gate semantics, a recommended action, and aggregation.
- Doctor was ready while the project CLI/Core and process-level shared Skill
  were on different versions, with no visible reason why fleet activation was
  deferred.

## Product contract

### Lifecycle-stable release artifacts

`OwlCodaRunKitRegistryReleasePolicyV2` describes immutable artifact behavior,
not mutable registry time:

- `status=release_artifact_registry_gated`;
- `artifactVersion` is the package version;
- `rollbackRelease` is the exact already-published rollback baseline;
- adoption requires external exact-registry version, shasum, integrity, and
  tarball evidence;
- the artifact does not encode mutable publication state or name a moving
  latest release.

The V1 policy remains historical and is not reinterpreted in place.

### Formatting-only profile reconciliation

A dry-run may still report `normalizationOnly: true` and show the canonical
proposal. Applying that same plan is a semantic no-op:

- status is `profiles_already_current`;
- `writesPerformed=0`;
- the owner profile bytes remain unchanged;
- no reconcile receipt is created.

Real profile additions or command/path updates retain the existing atomic
write, receipt, and rollback behavior.

### Compact, actionable upgrade and recovery output

- A version-mismatched bootstrap returns the exact `npm install --save-exact`
  command for the requested successor and the matching project-local bootstrap
  dry-run command.
- `inspect --json --compact` emits `OwlCodaRunKitInspectCompactV1`: project
  truth hash, progress, dominant gap, owner, next action, warning groups,
  execution counts, and the false authority boundary only.
- Existing full inspect remains unchanged; compact cannot be combined with
  history, a selected run, or verbose output.

### Team warning and shared Skill diagnosis

Team Delivery Status V2 enriches and groups Project Driver warnings while
leaving Status V1 unchanged. A missing Quick/Formal reference remains
non-blocking, does not prove that any receipt was attested, and does not impose
retroactive Formal work on a completed historical WorkItem.

Doctor reports project-local CLI, project Core, and process-level shared Skill
versions separately. Shared Skill drift does not change `ready`; if fleet-safe
activation is blocked by an active execution or lease, the blocker and the
wait-then-refresh action are visible.

## Authority boundary

This document and the packaged artifact grant no npm publication, project
adoption, Git integration, deployment, production, or business authority.
All authorization fields remain false. Registry adoption becomes eligible only
after separate external evidence binds the exact official-registry version,
shasum, integrity, and tarball URL.
