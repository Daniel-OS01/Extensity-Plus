#!/usr/bin/env node
"use strict";

const http = require("node:http");
const https = require("node:https");
const { URL, URLSearchParams } = require("node:url");

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_PORT = 8765;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--client-id" && argv[i + 1]) {
      args.clientId = argv[++i];
    } else if (arg === "--client-secret" && argv[i + 1]) {
      args.clientSecret = argv[++i];
    } else if (arg === "--port" && argv[i + 1]) {
      args.port = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... npm run cws:bootstrap
  npm run cws:bootstrap -- --client-id ID --client-secret SECRET [--port 8765]

Obtains a long-lived refresh token for the Chrome Web Store API.

IMPORTANT: Use credentials from a Google Cloud OAuth client of type "Desktop app".
Do NOT use a "Chrome extension" or "Web application" client — those reject this flow.

Before running, add this redirect URI to your Desktop OAuth client in Google Cloud Console:
  http://127.0.0.1:8765/
(Use a different port with --port or CWS_OAUTH_PORT if 8765 is busy.)

Never commit the refresh token; add it as CWS_REFRESH_TOKEN in GitHub Actions secrets.`);
}

function requireCredentials(cliArgs) {
  const clientId = cliArgs.clientId || process.env.CWS_CLIENT_ID;
  const clientSecret = cliArgs.clientSecret || process.env.CWS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing credentials. Set CWS_CLIENT_ID and CWS_CLIENT_SECRET, or pass --client-id and --client-secret.");
    process.exit(1);
  }

  return { clientId, clientSecret };
}

function resolvePort(cliArgs) {
  const fromArgs = cliArgs.port;
  const fromEnv = process.env.CWS_OAUTH_PORT ? Number(process.env.CWS_OAUTH_PORT) : null;
  const port = fromArgs || fromEnv || DEFAULT_PORT;

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error("Invalid port. Use --port or CWS_OAUTH_PORT with an integer between 1 and 65535.");
    process.exit(1);
  }

  return port;
}

function buildRedirectUri(port) {
  return `http://127.0.0.1:${port}/`;
}

function buildConsentUrl(clientId, redirectUri) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent"
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function postForm(url, body) {
  const data = new URLSearchParams(body).toString();

  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(data)
        }
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => {
          raw += chunk;
        });
        response.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch (error) {
            reject(new Error(`Token endpoint returned non-JSON (${response.statusCode}): ${raw}`));
            return;
          }

          if (response.statusCode < 200 || response.statusCode >= 300) {
            const message = parsed.error_description || parsed.error || raw;
            reject(new Error(`Token exchange failed (${response.statusCode}): ${message}`));
            return;
          }

          resolve(parsed);
        });
      }
    );

    request.on("error", reject);
    request.write(data);
    request.end();
  });
}

function waitForAuthorizationCode(port, redirectUri) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let requestUrl;
      try {
        requestUrl = new URL(req.url || "/", redirectUri);
      } catch (error) {
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Bad request");
        return;
      }

      const code = requestUrl.searchParams.get("code");
      const error = requestUrl.searchParams.get("error");
      const errorDescription = requestUrl.searchParams.get("error_description");

      if (error) {
        res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<h1>Authorization failed</h1><p>${error}</p><p>${errorDescription || ""}</p><p>You can close this tab.</p>`
        );
        server.close();
        reject(new Error(`OAuth error: ${error}${errorDescription ? ` — ${errorDescription}` : ""}`));
        return;
      }

      if (code) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          "<h1>Success</h1><p>Authorization complete. Close this tab and return to the terminal.</p>"
        );
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for authorization (5 minutes)."));
    }, 5 * 60 * 1000);

    server.on("close", () => {
      clearTimeout(timeout);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      if (err.code === "EADDRINUSE") {
        reject(
          new Error(
            `Port ${port} is already in use. Pick another port with --port or CWS_OAUTH_PORT and add http://127.0.0.1:PORT/ to your Desktop OAuth client redirect URIs.`
          )
        );
        return;
      }
      reject(err);
    });

    server.listen(port, "127.0.0.1");
  });
}

async function main() {
  const cliArgs = parseArgs(process.argv);
  if (cliArgs.help) {
    printHelp();
    return;
  }

  const { clientId, clientSecret } = requireCredentials(cliArgs);
  const port = resolvePort(cliArgs);
  const redirectUri = buildRedirectUri(port);
  const consentUrl = buildConsentUrl(clientId, redirectUri);

  console.log("Chrome Web Store OAuth bootstrap (localhost redirect)");
  console.log("");
  console.log("Use a Google Cloud OAuth client of type: Desktop app");
  console.log("(NOT \"Chrome extension\" or \"Web application\" — those cause Error 400 invalid_request)");
  console.log("");
  console.log("In Google Cloud Console, open your Desktop OAuth client and add this redirect URI:");
  console.log(`  ${redirectUri}`);
  console.log("");
  console.log("Waiting for browser callback on 127.0.0.1:" + port + " ...");
  console.log("");
  console.log("Open this URL in your browser and sign in with the publisher Google account:");
  console.log("");
  console.log(consentUrl);
  console.log("");

  const waitPromise = waitForAuthorizationCode(port, redirectUri);
  const code = await waitPromise;

  console.log("Authorization code received. Exchanging for tokens...");

  const tokenResponse = await postForm(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code"
  });

  if (!tokenResponse.refresh_token) {
    console.error("No refresh_token in response. Revoke app access at https://myaccount.google.com/permissions and run again.");
    console.error(JSON.stringify(tokenResponse, null, 2));
    process.exit(1);
  }

  console.log("");
  console.log("Success. Add this value as a GitHub Actions secret named CWS_REFRESH_TOKEN:");
  console.log("");
  console.log(tokenResponse.refresh_token);
  console.log("");
  console.log("Also add CWS_CLIENT_ID, CWS_CLIENT_SECRET, and CWS_EXTENSION_ID (gbojjphhdboeaafjdilfibonoflhgcde).");
  console.log("Do not commit the refresh token to the repository.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
