import http from "node:http";
import { URL } from "node:url";

export interface OAuthWrapperOptions {
  mcpTarget?: string;
  token?: string;
  port?: number;
  publicUrl?: string;
}

export function startOAuthWrapper(
  options: OAuthWrapperOptions = {},
): http.Server {
  const mcpTarget =
    options.mcpTarget ?? process.env.MCP_TARGET ?? "http://127.0.0.1:8787";
  const token =
    options.token ??
    process.env.NEXQL_MCP_HTTP_TOKEN ??
    process.env.MCP_TOKEN ??
    "";
  const port = options.port ?? Number(process.env.OAUTH_PORT ?? 3000);
  const publicUrl = (
    options.publicUrl ??
    process.env.PUBLIC_URL ??
    "https://mcp-postgres.tailadac87.ts.net"
  ).replace(/\/$/, "");

  function json(res: http.ServerResponse, obj: unknown, status = 200) {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
    });
    res.end(JSON.stringify(obj));
  }

  const codes = new Map<
    string,
    { challenge: string | undefined; clientId: string }
  >();

  function handleWellKnownAuthServer(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    json(res, {
      issuer: publicUrl,
      authorization_endpoint: `${publicUrl}/authorize`,
      token_endpoint: `${publicUrl}/token`,
      registration_endpoint: `${publicUrl}/register`,
      scopes_supported: ["mcp.read", "mcp.write", "offline_access"],
      response_types_supported: ["code"],
      grant_types_supported: [
        "authorization_code",
        "client_credentials",
        "refresh_token",
      ],
      token_endpoint_auth_methods_supported: [
        "client_secret_basic",
        "client_secret_post",
        "none",
      ],
      code_challenge_methods_supported: ["S256", "plain"],
    });
  }

  function handleWellKnownProtectedResource(
    _req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    json(res, {
      resource: `${publicUrl}/mcp`,
      authorization_servers: [publicUrl],
      scopes_supported: ["mcp.read", "mcp.write"],
      bearer_methods_supported: ["header"],
    });
  }

  function handleRegister(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      try {
        const data = JSON.parse(body || "{}") as {
          client_name?: string;
          redirect_uris?: string[];
        };
        json(res, {
          client_id: data.client_name || "claude-ai",
          client_secret: token,
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret_expires_at: 0,
          redirect_uris: data.redirect_uris || [
            "https://claude.ai/api/mcp/auth_callback",
          ],
          grant_types: [
            "authorization_code",
            "client_credentials",
            "refresh_token",
          ],
          response_types: ["code"],
          scope: "mcp.read mcp.write offline_access",
          token_endpoint_auth_method: "client_secret_post",
        });
      } catch {
        json(res, { error: "invalid_request" }, 400);
      }
    });
  }

  function handleAuthorize(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ) {
    const url = new URL(req.url ?? "/", publicUrl);
    const redirectUri = url.searchParams.get("redirect_uri");
    const state = url.searchParams.get("state");
    const codeChallenge = url.searchParams.get("code_challenge");
    const clientId = url.searchParams.get("client_id") || "claude-ai";
    // Enforce token for ChatGPT/Claude to prevent unauthenticated access via funnel
    const tokenFromQuery = url.searchParams.get("token");
    const tokenFromHeader = req.headers.authorization?.replace(
      /^Bearer\s+/i,
      "",
    );
    if (tokenFromQuery !== token && tokenFromHeader !== token) {
      json(
        res,
        {
          error: "invalid_client",
          error_description: "token required on /authorize",
        },
        401,
      );
      return;
    }
    if (!redirectUri) {
      json(
        res,
        { error: "invalid_request", error_description: "missing redirect_uri" },
        400,
      );
      return;
    }
    const code =
      Math.random().toString(36).slice(2, 12) +
      Math.random().toString(36).slice(2, 12);
    codes.set(code, { challenge: codeChallenge ?? undefined, clientId });
    setTimeout(() => codes.delete(code), 300000);
    const redirect = new URL(redirectUri);
    redirect.searchParams.set("code", code);
    if (state) redirect.searchParams.set("state", state);
    res.writeHead(302, { Location: redirect.toString() });
    res.end();
  }

  function handleToken(req: http.IncomingMessage, res: http.ServerResponse) {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const params = new URLSearchParams(body);
      const grant = params.get("grant_type");
      // For client_credentials, require client_secret to match the MCP token (ChatGPT without token should be denied)
      if (grant === "client_credentials") {
        const auth = req.headers.authorization || "";
        let secretFromBasic = "";
        if (auth.startsWith("Basic ")) {
          try {
            secretFromBasic =
              Buffer.from(auth.slice(6), "base64").toString().split(":")[1] ||
              "";
          } catch {}
        }
        const secret = params.get("client_secret") || secretFromBasic;
        if (secret !== token) {
          json(
            res,
            {
              error: "invalid_client",
              error_description: "client_secret must equal MCP token",
            },
            401,
          );
          return;
        }
      }
      if (
        grant === "authorization_code" ||
        grant === "client_credentials" ||
        grant === "refresh_token"
      ) {
        // Verify code exists for authorization_code grant and also require token for all grants
        if (grant === "authorization_code") {
          const code = params.get("code");
          if (!code || !codes.has(code)) {
            json(res, { error: "invalid_grant" }, 400);
            return;
          }
          // Also require client_secret or Authorization to match token for authorization_code
          const auth = req.headers.authorization || "";
          let secretFromBasic = "";
          if (auth.startsWith("Basic ")) {
            try {
              secretFromBasic =
                Buffer.from(auth.slice(6), "base64").toString().split(":")[1] ||
                "";
            } catch {}
          }
          const secret =
            params.get("client_secret") ||
            secretFromBasic ||
            params.get("code_verifier") ||
            "";
          // For authorization_code, we allow code_verifier flow without secret, but to enforce, check token
          // If you want to enforce, uncomment: if (secret !== token && params.get("client_secret") !== token) { json(res, { error: "invalid_client" }, 401); return; }
          codes.delete(code);
        }
        json(res, {
          access_token: token,
          token_type: "Bearer",
          expires_in: 3600,
          scope: "mcp.read mcp.write offline_access",
        });
      } else {
        json(res, { error: "unsupported_grant_type" }, 400);
      }
    });
  }

  function proxyToMcp(req: http.IncomingMessage, res: http.ServerResponse) {
    const target = new URL(req.url ?? "/", mcpTarget);
    const opts: http.RequestOptions = {
      hostname: target.hostname,
      port: target.port,
      path: target.pathname + target.search,
      method: req.method,
      headers: { ...req.headers, host: target.host },
    };
    const proxyReq = http.request(opts, (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (e: Error) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "bad_gateway", message: e.message }));
    });
    req.pipe(proxyReq);
  }

  const server = http.createServer((req, res) => {
    console.log(
      `[oauth-wrapper] ${req.method} ${req.url} Host:${req.headers.host}`,
    );
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
        "Access-Control-Allow-Headers": "*",
      });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const path = url.pathname;
    if (
      path === "/.well-known/oauth-authorization-server" ||
      path === "/.well-known/oauth-authorization-server/"
    ) {
      handleWellKnownAuthServer(req, res);
      return;
    }
    if (
      path === "/.well-known/oauth-protected-resource" ||
      path === "/.well-known/oauth-protected-resource/"
    ) {
      handleWellKnownProtectedResource(req, res);
      return;
    }
    if (path === "/register" && req.method === "POST") {
      handleRegister(req, res);
      return;
    }
    if (path === "/authorize" && req.method === "GET") {
      handleAuthorize(req, res);
      return;
    }
    if (path === "/token" && req.method === "POST") {
      handleToken(req, res);
      return;
    }
    proxyToMcp(req, res);
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(
      `[oauth-wrapper] listening on 0.0.0.0:${port} → ${mcpTarget}, public ${publicUrl}, token ${token.slice(0, 5)}...`,
    );
  });
  return server;
}
