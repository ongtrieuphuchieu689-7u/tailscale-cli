#!/usr/bin/env bash
# Example: 1 PostgreSQL Database Relay + NexQL MCP Server
# Forwards local port 15433 -> remote target 192.168.50.79:5433
# Exposes MCP on HTTP port 8787 accessible via Tailnet (0.0.0.0 bind)

export PGPASSWORD="your-database-password"

tailsacle-cli relay-mcp-postgres \
  --listen 15433 \
  --target 192.168.50.79:5433 \
  --user postgres \
  --database mydb \
  --mcp-port 8787 \
  --mcp-bind 0.0.0.0 \
  --token "mcp-bearer-token-12345678" \
  --connect-timeout 5000 \
  --db-retry-interval 3000 \
  --json
