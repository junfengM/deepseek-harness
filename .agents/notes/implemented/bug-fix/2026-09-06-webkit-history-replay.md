# Agent Note: WebKit history replay and durable Web authentication

Status: implemented

English | [中文](2026-09-06-webkit-history-replay.zh.md)

## Problem

WebKit clients could load the DSH session list but failed while replaying assistant-stream history, even though Chromium clients rendered the same sessions. Mobile users also needed a launch URL that remained valid after the managed Web process restarted.

## Decision

The lossless JSON validators in `@deepseek-ai/dsh-util-values` and the mirrored `@deepseek-ai/dsh-tools` implementation normalize whitespace in the native-constructor source returned by `Function#toString()` before recognizing intrinsic Array and Object prototypes. This keeps the cross-realm safety check while accepting JavaScriptCore's multiline native-function spelling. The `client-connection/browser-session` grant persists the launch token beside its signing secret, so a Web process restart reuses the token; the token remains authority-bound through the exchanged HttpOnly session cookie.

## Alternatives considered

**Trust every object with an `Object`-like constructor name.** Rejected because the validator would lose its protection against forged or exotic prototypes.

**Disable assistant-stream replay on WebKit.** Rejected because it would hide durable live-session data and leave browser behavior inconsistent.

**Mint a new launch token on every process restart.** Rejected because managed restarts would invalidate remote devices and require another out-of-band login.

## Consequences

Safari and iPhone Chrome can replay the same durable session records as Chromium after their cached plugin bundle is refreshed. A launch token is now a durable bearer credential in the local credentials store, so it must not be placed in documentation or shared; authority-bound cookies and the existing WAF gate remain separate controls. Native constructor source normalization is duplicated in the JSON-schema validator because that package has its own implementation.

## Testing

The browser-auth and JSON-schema suites pass with 30 tests. Host and client libraries plus the Web frontend build successfully, and the public chain was verified as no-cookie 403, login 200, WAF-only 401, authenticated root 200, and authenticated API probe 404. Mac Safari and iPhone Safari/Chrome display historical messages after a forced refresh.
