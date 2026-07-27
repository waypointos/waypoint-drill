# Security

This module drives physical hardware (a lift screw and an auger). Take
anything that could bypass the halt latch, the auger interlock, or release
signing seriously.

## Reporting a vulnerability

Report vulnerabilities privately via GitHub:
https://github.com/waypointos/waypoint-drill/security/advisories/new

Do not open a public issue for a security problem. You should hear back
within a week.

## Verifying releases

Every release ships a `.raw` module image signed with cosign keyless
signing from this repository's release workflow. Verify with:

```
cosign verify-blob \
  --bundle drill-<version>.raw.cosign \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/waypointos/waypoint-drill/\.github/workflows/release\.yml@refs/tags/v' \
  drill-<version>.raw
```
