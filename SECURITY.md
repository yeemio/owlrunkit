# Security Policy

## Supported versions

OwlRunKit is pre-1.0. Only the latest published minor line receives security
fixes.

| Version | Supported |
|---|---|
| `0.23.x` | Yes |
| `< 0.23` | No |

## Reporting a vulnerability

Do not file a public GitHub issue for a vulnerability. Email
**yeemio@gmail.com** with:

- a description of the issue and likely impact;
- the affected OwlRunKit and Node.js versions;
- minimal reproduction steps or a proof of concept;
- whether a protected workspace, receipt, lease, registry identity, or external
  authority boundary is affected;
- a preferred disclosure timeline, if relevant.

You should receive an acknowledgement within 72 hours. We aim to ship a fix or
publish a public advisory within 90 days of the initial report, whichever comes
first.

## Security-relevant boundaries

Reports are especially welcome for:

- workspace escape, path traversal, symlink, or canonicalization failures;
- command or shell-argument injection;
- receipt, candidate, source fingerprint, or provenance substitution;
- lease, single-writer, or atomic-recovery failures;
- sandbox or verification-envelope bypasses;
- registry, package, Core, Config, or shared-Skill identity confusion;
- authority output that can falsely grant Git, release, deployment,
  production, automation, money, or business permission;
- secret or private-data leakage through logs, receipts, or output summaries.

## Out of scope

- actions a user explicitly runs outside RunKit;
- vulnerabilities in third-party executors, model providers, package
  registries, or operating systems;
- social engineering that does not exploit OwlRunKit behavior;
- reports that require exposing private customer data.
