# OwlRunKit Notice

OwlRunKit is an independent package in the OwlCoda product family. It is not
affiliated with any model vendor, coding-agent vendor, or hosted agent service.

The OwlRunKit CLI, Core, contracts, and embedded attestation source on the
default branch are available under the [MIT License](LICENSE). This MIT grant
also applies to [`peer-linux.c`](scripts/runkit-contract/peer-linux.c), whose
historical SPDX header records the existing GPL grant. Keeping that source
byte-identical preserves the corresponding Core fingerprint.

Published releases retain the terms in their corresponding source tags and
npm archives. The [bundled skill](integrations/codex/skills/owlcoda-runkit/LICENSE)
and the Linux helper dependencies retain their component notices. OwlRunKit
uses Node.js built-in modules and declares no runtime npm dependencies.

Product and provider names may appear only where needed for interoperability,
portable integration guidance, compatibility history, or evidence captured by
the user. Such references do not imply endorsement, sponsorship, or
affiliation.

OwlRunKit records delivery continuity and verification evidence. It does not
grant Git, release, deployment, production, automation, money, or business
authority, and it does not become the Business Truth of a domain product.

The Linux helper binaries statically link musl. See
[`peer-linux.MUSL-COPYRIGHT`](scripts/runkit-contract/peer-linux.MUSL-COPYRIGHT)
for its copyright and license notices.
