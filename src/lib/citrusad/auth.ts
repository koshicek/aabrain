import { OktaTokenResponse } from "./types";
import crypto from "crypto";

const OKTA_AUTH_SERVER =
  "https://okta.citrusad.com/oauth2/aus2wlpl47Yx5o53g5d7";
const OKTA_CLIENT_ID = "0oa5orsjuyGCdBE315d7";
const REDIRECT_URI = "https://alzaads.citrusad.com/okta/callback";

function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

function generateState(): string {
  return crypto.randomBytes(30).toString("base64url");
}

export async function authenticateWithCredentials(
  username: string,
  password: string
): Promise<OktaTokenResponse> {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Step 1: Interact
  const interactRes = await fetch(`${OKTA_AUTH_SERVER}/v1/interact`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: OKTA_CLIENT_ID,
      scope: "openid profile",
      redirect_uri: REDIRECT_URI,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }),
  });
  const { interaction_handle } = await interactRes.json();
  if (!interaction_handle) {
    throw new Error("Failed to get interaction handle from Okta");
  }

  // Step 2: Introspect
  const introspectRes = await fetch(
    "https://okta.citrusad.com/idp/idx/introspect",
    {
      method: "POST",
      headers: { "Content-Type": "application/ion+json; okta-version=1.0.0" },
      body: JSON.stringify({ interactionHandle: interaction_handle }),
    }
  );
  const { stateHandle } = await introspectRes.json();
  if (!stateHandle) {
    throw new Error("Failed to get state handle from Okta");
  }

  // Step 3: Identify (username)
  const identifyRes = await fetch(
    "https://okta.citrusad.com/idp/idx/identify",
    {
      method: "POST",
      headers: { "Content-Type": "application/ion+json; okta-version=1.0.0" },
      body: JSON.stringify({ stateHandle, identifier: username }),
    }
  );
  const identifyData = await identifyRes.json();
  const stateHandle2 = identifyData.stateHandle;
  if (!stateHandle2) {
    throw new Error("Failed to identify user with Okta");
  }

  // Step 4: Challenge answer (password)
  const challengeRes = await fetch(
    "https://okta.citrusad.com/idp/idx/challenge/answer",
    {
      method: "POST",
      headers: { "Content-Type": "application/ion+json; okta-version=1.0.0" },
      body: JSON.stringify({
        stateHandle: stateHandle2,
        credentials: { passcode: password },
      }),
    }
  );
  const challengeData = await challengeRes.json();

  const interactionCode = challengeData?.successWithInteractionCode?.value?.find(
    (v: { name: string; value: string }) => v.name === "interaction_code"
  )?.value;

  if (!interactionCode) {
    throw new Error(
      "Authentication failed. Check your username and password."
    );
  }

  // Step 5: Exchange for token
  const tokenRes = await fetch(`${OKTA_AUTH_SERVER}/v1/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "interaction_code",
      client_id: OKTA_CLIENT_ID,
      interaction_code: interactionCode,
      code_verifier: codeVerifier,
      redirect_uri: REDIRECT_URI,
    }),
  });

  const tokenData: OktaTokenResponse = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error("Failed to obtain access token from Okta");
  }

  return tokenData;
}
