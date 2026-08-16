# tailsacle-cli

Safe TypeScript CLI for Tailscale deployment workflows. Official binaries are `tailsacle-cli` and `tscli`.

## Status

The repository now ships a runnable contract-first CLI foundation: config and trust-credential resolution, JSON envelopes, profile defaults, agent manifest, non-interactive commands, and safety gates. Network/API binary, policy, DNS, Funnel and cleanup adapters are intentionally exposed as guarded seams until their integration tests are added; no command claims a remote side effect it did not verify.

```bash
npm install
npm run build
node dist/cli.js doctor --detect-credentials --json
node dist/cli.js agent-manifest --json
```

Credential precedence is explicit secret, named trust env, exact `tskey-client-` scan, then error. Multiple matches fail instead of guessing. Secrets are masked and never returned raw.

See `docs/implementation_plan.md` and `docs/user_requirement_addendum_2026-08-16.md` for the source requirements.
