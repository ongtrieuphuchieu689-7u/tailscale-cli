export const manifest = {
  version: 2,
  commands: ['doctor', 'deploy', 'up', 'funnel', 'serve', 'dns', 'policy', 'status', 'cleanup', 'update-bin', 'agent-manifest'],
  rules: {
    first: 'doctor --detect-credentials --json',
    secretHandling: 'mask secrets; never persist raw credentials',
    policy: 'HuJSON diff, validate, backup, ETag and confirmation before write',
    cleanup: 'offline threshold + exact hostname/tag match + confirmation',
    binary: 'use existing binary; update only with explicit update-bin',
    idempotence: 'reruns converge on the same local node state',
  },
} as const;
