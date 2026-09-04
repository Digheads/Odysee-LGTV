---
name: odysee-api
description: Technical reference for Odysee and LBRY APIs, endpoints, authentication, and architecture.
---

# Odysee API Reference Skill

This skill provides a comprehensive technical map of Odysee web/mobile/TV integrations. It serves as the primary reference for interacting with the Odysee/LBRY backend ecosystems.

## Reference Documentation
For complete technical details, API endpoints, and architectural blueprints, read the included reference document:
- [odysee-reference.md](./odysee-reference.md)

### When to use this skill
Use this skill whenever you need to:
- Authenticate a user (OAuth Bearer, Device flow, Legacy token).
- Search for claims or channels (`claim_search`, `resolve`).
- Interact with comments, reactions, or livestream chats.
- Fetch homepage categories or trending content.
- Track playback telemetry (Watchman) or view progress.

### Key API Bases Overview
- **SDK Proxy (`QUERY_API`):** `https://api.na-backend.odysee.com/api/v1/proxy`
- **Internal APIs (`ROOT_API`):** `https://api.odysee.com`
- **SSO Auth (`ROOT_SSO`):** `https://sso.odysee.com`
- **Comments (`COMMENT_API`):** `https://comments.odysee.tv/api/v2`
- **Search (`LIGHTHOUSE_API`):** `https://lighthouse.odysee.tv/search`
- **Livestreams (`NEW_LIVE_API`):** `https://api.odysee.live`

**Important:** Before making API requests, consult `odysee-reference.md` to ensure you are using the correct endpoint, payload shape (e.g. JSON-RPC), and token type.
