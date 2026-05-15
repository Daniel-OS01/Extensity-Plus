#!/usr/bin/env node
"use strict";

const https = require("node:https");
const readline = require("node:readline");
const { URLSearchParams } = require("node:url");

const SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const REDIRECT_URI = "urn:ietf:wg:oauth:2.0:oob";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--client-id" && argv[i + 1]) {
      args.clientId = argv[++i];
    } else if (arg === "--client-secret" && argv[i + 1]) {
      args.clientSecret = argv[++i];
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  CWS_CLIENT_ID=... CWS_CLIENT_SECRET=... npm run cws:bootstrap
  npm run cws:bootstrap -- --client-id ID --client-secret SECRET

Obtains a long-lived refresh token for the Chrome Web Store API.
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

function buildConsentUrl(clientId) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
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

function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  const cliArgs = parseArgs(process.argv);
  if (cliArgs.help) {
    printHelp();
    return;
  }

  const { clientId, clientSecret } = requireCredentials(cliArgs);
  const consentUrl = buildConsentUrl(clientId);

  console.log("Chrome Web Store OAuth bootstrap");
  console.log("");
  console.log("1. Open this URL in a browser and sign in with the Google account that owns the publisher:");
  console.log("");
  console.log(consentUrl);
  console.log("");
  console.log("2. Approve access. Google will show an authorization code on the page.");
  console.log("");

  const code = await prompt("Paste the authorization code here: ");
  if (!code) {
    console.error("No authorization code provided.");
    process.exit(1);
  }

  console.log("");
  console.log("Exchanging code for tokens...");

  const tokenResponse = await postForm(TOKEN_URL, {
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: REDIRECT_URI,
    grant_type: "authorization_code"
  });

  if (!tokenResponse.refresh_token) {
    console.error("No refresh_token in response. Re-run with prompt=consent or revoke prior access and try again.");
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
