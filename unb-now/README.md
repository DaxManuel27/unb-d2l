# UNB Now

The sole Chrome extension implementation in this repository, adapted from WATnow.
See [UPSTREAM.md](UPSTREAM.md), [LICENSE](LICENSE), and [fonts/OFL.txt](fonts/OFL.txt)
for attribution and licenses.

## Install

1. Open `chrome://extensions` in the Chrome profile signed into UNB Brightspace.
2. Enable Developer mode, choose **Load unpacked**, and select this directory.
3. Reload `https://lms.unb.ca/d2l/home`, then open **UNB Now** from the toolbar.

For updates, reload the existing UNB Now extension and reopen its panel. Chrome
120+ is required. No build step or runtime dependencies are required.

Version **0.4.4** fixes course labels for term-prefixed and underscore-formatted
UNB shells. It shows only confirmed current-term enrollments, with an automatic
cache refresh when upgrading or entering a new semester. It also includes a
September 1, 2026 midnight Atlantic deadline cutoff and green/yellow/red times. Coursework and preferences stay in local
Chrome extension storage; there is no analytics or third-party backend.

The user has confirmed live coursework collection. Complete source coverage and
OS notification delivery still need verification. If a source fails, the panel
reports partial coverage and retains eligible cached items. Diagnostic reports
stay local unless explicitly copied and shared; they may include course names/IDs.

See the [project README](../README.md) for development commands, behavior and the
code map. The fictional preview and tests live outside this extension directory.
