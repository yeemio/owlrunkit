# Contributing to OwlRunKit

Thanks for helping improve evidence-backed AI-agent delivery.

This public repository is the corresponding-source, documentation, issue,
release, and trust surface for OwlRunKit. Day-to-day product development happens
in a private source repository. Public issues, reproducible dogfood reports,
documentation fixes, contract questions, and security reports are valuable;
source proposals should begin with an issue so the product boundary and license
path are agreed before implementation starts.

## Before opening an issue

Please include:

- exact `owlrunkit` version and Node.js version;
- project-local command used, preferably `npx --no-install owlrunkit ...`;
- expected result and actual result;
- the smallest safe reproduction;
- whether the workspace, an external runtime, or both changed;
- receipt or diagnostic paths with credentials and private data removed;
- whether the report concerns continuity, assurance, delivery lifecycle, or
  authority wording.

Do not attach private source, API keys, production logs, or unredacted business
data.

## Product boundary

Changes should preserve these invariants:

- continuity and assurance remain independent;
- ordinary work stays light;
- candidate and evidence identities fail closed;
- source acceptance, integration, deployment, live readback, and product
  acceptance remain separate;
- no RunKit result grants Git, release, deployment, production, automation,
  money, or BusinessAction authority;
- domain Business Truth and executor Session/Attempt identity stay outside
  RunKit.

## Code proposals

Until a CLA or copyright-assignment process is published, external source-code
contributions are accepted only after maintainer approval. Small documentation
fixes are welcome; for code or contract changes, open an issue before writing a
large patch.

If a proposal is accepted, keep it narrowly scoped, add focused contract tests,
and show the candidate identity and commands used for verification. Do not
weaken fail-closed behavior merely to make a test green.

## License

OwlRunKit is distributed under `GPL-3.0-or-later`. Commercial, OEM, or embedded
distribution uses a separate maintainer license path.
