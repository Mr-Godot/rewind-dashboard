# Security Policy

## Supported Versions

Only the latest release receives security updates.

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, use [GitHub Security Advisories](https://github.com/GodotH/rewind-dashboard/security/advisories/new) to report them privately.

Include:
- Description of the vulnerability
- Steps to reproduce
- Suggested fix (if any)

I'll acknowledge reports within 48 hours and provide an action plan within 7 days.

## Scope

This is a **local-only** dashboard — no external server, no auth, no network requests. Security concerns are limited to:
- Path traversal outside `~/.claude`
- Command injection via session launch
- XSS from crafted session data
- Dependency vulnerabilities
