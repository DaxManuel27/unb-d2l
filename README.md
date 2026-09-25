# UNB Now

A Chrome side-panel extension for UNB Brightspace deadlines, adapted from
[WATnow](https://github.com/EricJujianZou/watnow). **`unb-now/` is the only extension
implementation in this repository.**

## Install or update

1. Open `chrome://extensions` in the Chrome profile signed into UNB Brightspace.
2. Enable Developer mode, choose **Load unpacked**, and select `unb-now/`.
3. Reload your UNB Brightspace homepage, then open **UNB Now** from the toolbar.

For an existing UNB Now installation, click **Reload** on its extension card and
close/reopen its panel. Keep the `unb-now/` folder at its current path to preserve
the unpacked extension identity and saved data. Chrome 120+ is required.

The retired UNB Course Planner and feasibility probe have been removed from the
repository. If Chrome still lists either one, remove its old extension card;
repository cleanup does not uninstall browser extensions.

## Behavior

- Shows only accessible enrollments confirmed for the **current UNB semester**:
  Winter (January–April), Summer (May–August), or Fall (September–December), using
  Atlantic time. Matches UNB term codes/names, then parent semester metadata for
  renamed courses. Older, future, and unconfirmed courses are excluded before
  reading coursework. Saved lists follow the same filter and rescan on update or
  a new term; current-course check-offs are preserved.

- Reads assignments, quizzes, discussions, content date/completion feeds and
  calendar events through allowlisted GET requests to `lms.unb.ca`.
- Uses the browser's existing sign-in, with an API relay through an already-open
  UNB tab when necessary. Scans never open, close, or navigate tabs.
- Refreshes every 30 minutes while Chrome runs. Stores coursework and settings
  locally, with no analytics or third-party requests.
- Includes course filters, check-offs, changed-date notices, per-type reminders,
  course muting, and light/dark themes.
- Excludes deadlines before **September 1, 2026, midnight Atlantic time**, including
  saved older items. APIs without date filters may return older rows; they are
  discarded before import, and old assignments do not trigger submission reads.
- Deadline times are **green** for future days, **yellow/gold** when due today,
  and **red** after the deadline. Completed times remain muted.

The user has confirmed that live collection returns coursework. Complete coverage,
Chrome lifecycle behavior and OS notification delivery still need live verification.
Dates only in documents or external tools may be absent. Display times use the
computer's timezone; partial API failures are reported in the panel.

## Development

Requires Node.js 22+. No dependency installation or build step is needed.

```sh
npm test
npm run check
npm run dev
```

The preview is at `http://127.0.0.1:4174/panel/panel.html`. It uses fictional,
in-memory data and cannot access UNB or send notifications. `npm run dev:unb`
and `npm run test:unb` remain aliases for the same preview and test suite.

## Code map

| Path | Purpose |
| --- | --- |
| `unb-now/manifest.json` | Chrome extension entry points and permissions |
| `unb-now/src/background.js` | Scanning, reconciliation, alarms and notifications |
| `unb-now/src/data/` | Brightspace API collection, UNB policy and date cutoff |
| `unb-now/src/content/` | Same-origin API relay |
| `unb-now/src/core/` | Storage, dates, deadline view model and reminder rules |
| `unb-now/panel/`, `unb-now/options/` | Side panel and settings |
| `scripts/` | Local fictional preview and syntax checks |
| `tests/` | UNB API, storage, reminder and background tests |

Upstream release-build demo stubs remain where imported by WATnow's shared code;
they are not another extension and cannot enable demo mode in the installed build.
The browser preview adapter lives outside the packaged extension.

See [upstream attribution](unb-now/UPSTREAM.md), the [MIT license](unb-now/LICENSE),
and bundled [font licenses](unb-now/fonts/OFL.txt).
