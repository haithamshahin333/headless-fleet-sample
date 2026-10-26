"""A test MCP server with one tool, `whoami`, behind Keycloak bearer tokens.

Every request must carry a Keycloak access token issued for this server: signed by the
realm (RS256), from OIDC_ISSUER, with MCP_AUDIENCE in `aud`, not expired. The SDK's
RequireAuthMiddleware answers 401 to anything else. `whoami` reports the user behind the
token, so a Fleet run shows whose token LangSmith attached. Tokens are never logged or
returned.
"""

import asyncio
import logging
import os
import time

import jwt
from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.auth.provider import AccessToken
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer

ISSUER = os.environ["OIDC_ISSUER"]  # http://keycloak.mcp-test.svc:8080/realms/mcp-test
AUDIENCE = os.environ["MCP_AUDIENCE"]  # mcp-server
PUBLIC_URL = os.environ["MCP_PUBLIC_URL"]  # http://mcp.mcp-test.svc:8000/mcp

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("whoami")
jwks = jwt.PyJWKClient(f"{ISSUER}/protocol/openid-connect/certs", cache_keys=True, lifespan=300)


class KeycloakVerifier:
    async def verify_token(self, token: str) -> AccessToken | None:
        try:
            key = await asyncio.to_thread(jwks.get_signing_key_from_jwt, token)
            claims = jwt.decode(
                token,
                key.key,
                algorithms=["RS256"],
                audience=AUDIENCE,
                issuer=ISSUER,
                options={"require": ["exp", "iat", "iss", "aud", "sub"]},
            )
        except jwt.PyJWTError as e:
            log.info("token refused: %s", type(e).__name__)
            return None
        return AccessToken(
            token=token,
            client_id=str(claims.get("azp", "")),
            scopes=str(claims.get("scope", "")).split(),
            expires_at=int(claims["exp"]),
            resource=AUDIENCE,
            subject=str(claims["sub"]),
            claims=claims,
        )


mcp = MCPServer(
    "whoami",
    instructions="Test server: reports which Keycloak user the caller's token belongs to.",
    token_verifier=KeycloakVerifier(),
    # The verifier checks `aud` itself, so the SDK's own resource check stays off.
    auth=AuthSettings(issuer_url=ISSUER, resource_server_url=PUBLIC_URL, validate_token_resource=False),
)


@mcp.tool()
def whoami() -> dict:
    """Return the Keycloak user this MCP server sees for the current call: username, subject, scopes and token expiry."""
    t = get_access_token()
    if t is None:
        return {"error": "no authenticated user"}
    c = t.claims or {}
    log.info("whoami user=%s client=%s", c.get("preferred_username"), t.client_id)
    return {
        "username": c.get("preferred_username"),
        "subject": t.subject,
        "issued_to_client": t.client_id,
        "audience": c.get("aud"),
        "scopes": t.scopes,
        "expires_in_seconds": (t.expires_at or 0) - int(time.time()),
    }


app = mcp.streamable_http_app(stateless_http=True, host="0.0.0.0")
