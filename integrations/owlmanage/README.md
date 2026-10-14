# OwlManage lifecycle integration for Codex

This optional, maintainer-owned integration brings a small reusable part of
OwlManage's Codex governance into OwlRunKit: a compact-session continuity consumer
and the `manage-thread-lifecycle` and `thread-handoff` skills. OwlManage owns
portfolio governance; OwlRunKit owns project delivery continuity. This directory
is neither an OwlBridge mailbox nor an experimental queue implementation.

## Contents and ownership

- `skills/manage-thread-lifecycle/`: lifecycle judgment and its Python compact
  checkpoint consumer; source from OwlManage's `governance/codex/`.
- `skills/thread-handoff/`: the direct companion used when a genuine owner,
  environment, authority, or outcome boundary requires transfer.
- `examples/compact-session-start.toml.example`: an opt-in configuration fragment.
- `tests/`: inherited focused consumer-contract tests, using the current Python.
- `SOURCE-PROVENANCE.json`: relative source identities, hashes, and adaptations.

The source is provided under this repository's GPL-3.0-or-later license. Personal
policies, model profiles, user configuration, portfolio data, task records,
credentials, and machine-specific paths are intentionally excluded. No private
runtime transcript is part of this package.

## How it behaves

The script consumes a JSON hook event on stdin. Only a `SessionStart` event with
`source: "compact"` produces continuity context; other events produce no output.
It resolves the current Git root, checks for a regular project config and a local
OwlRunKit launcher contained in its package directory, and invokes `npx --no-install owlrunkit hook recovery --workspace <root>
--json` with a three-second timeout. It does not bootstrap a project or install
dependencies. The supported package floor is 0.22.0, with the exact
`OwlCodaRunKitHookRecoveryV1` shape validated by this consumer.

Actual binding/control errors are returned by the project-local CLI; the wrapper
does not initialize or repair them. A projection is accepted only when it is read-only, reports no writes, and every
authority field is false. Project text remains untrusted JSON data. The agent
must compare the current task's Goal/Done-when with the projected identity before
using a next action. Missing tooling, an unavailable or oversized projection,
invalid schema, or authority drift falls back to a small lifecycle reminder.
An open execution without a Project Driver exposes bounded control state only;
it does not create a new goal or task.

## Opt-in configuration

Python 3.11+, Git, and (for project recovery) Node 20.19+ and an existing
project-local OwlRunKit installation are required. Lifecycle fallback also works
without Node or OwlRunKit. This checkout does not activate either skill or hook.

1. Place the two skill folders in your chosen Codex skill location, or use them
   through your existing skill distribution workflow.
2. Review `examples/compact-session-start.toml.example`. Replace the placeholder
   with the absolute path to the script and a Python interpreter available on
   your machine; do not paste the placeholder as a working command.
3. Review and merge the fragment into your own configuration, preserving existing
   hooks. Follow your client's native hook trust/activation process. Configuration
   text alone is not proof that the platform loaded or ran a hook.
4. Verify the actual consumer in your own environment before adopting it.

There is no installer or automatic configuration mutation in this integration.
It does not replace personal model choices or install controller/agent profiles.

## Verification

From the repository root:

```sh
python3 -m unittest discover -s integrations/owlmanage/tests -p 'test_*.py'
```

These tests use explicit temporary project/projection fixtures. They prove the
consumer's identity boundary, false-authority requirement, JSON escaping,
no-driver/open-execution behavior, output bounds, and non-compact no-op. They do
not prove native Codex hook activation, actual model recovery, a global writer
inventory, or cross-product scheduling. A separate real-CLI smoke readback may
exercise the adapter, but still does not establish native hook activation.

## Limits

This component never launches, stops, takes over, or assigns an agent. It grants
no Git, release, deployment, production, automation, business, or money authority.
Compaction, task age, and a completed child are not reasons to change the goal.
A handoff requires a real semantic boundary or explicit user request.

The strict projection schema may require an explicit consumer update if Core
changes its shape; it must not be weakened to accept an unfamiliar payload.
The integration stores no session identity from the input and does not copy a
project's ledger, logs, private registry, or complete skill into hook context.
Experimental lock/recovery candidates are not included and are not promoted as
stable published components. Publishing this source does not install it or
approve any production operation.
