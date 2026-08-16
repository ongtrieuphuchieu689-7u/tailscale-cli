# Security

Trust credentials, client secrets, access tokens and auth keys are masked and never persisted. Environment scanning only checks exact `tskey-client-` values and reports variable names, never values. Policy writes require a minimal diff, backup, validation, ETag protection and confirmation. Cleanup only targets matching offline devices and is never a broad offline delete.
