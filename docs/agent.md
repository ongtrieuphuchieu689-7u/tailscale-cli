# Agent contract

The mandatory first operation is `doctor --detect-credentials --json`. Agents consume `resolved`, `warnings`, `requiredPrivileges`, `sideEffects` and `retryable`. Never retry permission or scope failures, never select an ambiguous credential, and never perform policy writes or deletion without the stated confirmation gates.
