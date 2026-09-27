# QA Checklist

## Automated checks

Automated coverage (Rails integration tests, Playwright, CI jobs and the live admin tester) is
described in [TESTER.md](TESTER.md). This file is the manual pass that automation does not replace.

## Manual browser checks before release
- candidate registration/login/logout/reload session
- employer registration/login/logout/reload session
- admin login and unauthorized route blocking
- mobile nav at 320/375/430 widths
- keyboard-only navigation
- screen-reader labels for forms and icon buttons
- dark-mode contrast
- long company/job/candidate names
- empty states
- API error states and offline handling
- duplicate apply
- portfolio-required apply
- expired application deadline
- suspended user session
- employer cannot access another employer’s applications
- candidate cannot access admin/employer pages
- messaging deep-link via `?conversation=`
- unread notification count/read state
- verification duplicate request
- report moderation
- review eligibility enforcement
- job rejection note visibility
- search combinations and no-result state
- save/unsave race conditions
- date/time timezone display
