# Good Terms native Figma verification — 2026-10-25

The Good Terms interface was exercised in Figma Beta 126.11.5 on Windows, in the actual `Scope & Settle — Demo (Copy)` file. This is native desktop evidence, separate from the earlier browser theme simulation.

## Completed checks

- Ran the registered development plugin from this checkout at 440 × 720 with `themeColors: true`.
- Connected using a fresh designer link from an isolated loopback fixture.
- Switched Figma Preferences → Theme explicitly to Light and then Dark while the plugin remained open; the plugin updated live without reconnecting.
- Checked readable text, controls and the vertical Request → Quote → Approval → Payment board; the lower stages and footer remained reachable by scrolling.
- Restored the original System theme preference and confirmed Figma saved `themePreference: "system"`.
- Closed and reopened the plugin; the designer workspace restored without re-entering the access link.
- Verified the built HTML contains the embedded Hanken Grotesk WOFF2 font, dark-theme and focus-visible rules, and no external `/assets/` references.

The initial theme and restoration checks used PR head `8998a1e31d811087674d01ae840d1d0da58258a8`. Screenshots and fixture-readiness hashes are retained in the ignored operator evidence directory `output/track1-native-2026-10-25/`.

## Reconnection error correction

The native walkthrough exposed a pre-existing recovery issue: after an old saved session expired, connecting with a valid fresh link opened the workspace but left the earlier expired-session error visible.

The connection path now clears that previous notice only after designer access is accepted and before loading the workspace. Rejected credentials and fresh loading errors remain visible. A regression test was observed failing against the old code and passing after the correction.

The rebuilt plugin was then checked against a fresh isolated fixture: the cached session produced the expected expired-session warning, and successful reconnection removed it without manual dismissal. Native screenshots before and after recovery are retained as `banner-regression-before-reconnect.png` and `banner-regression-after-reconnect.png` in the same operator evidence directory.

## Validation and limits

- Focused designer tests: **4 passed, 0 failed, 0 skipped**.
- Full application build and test suite: **81 passed, 0 failed, 0 skipped**.
- Independent code review found no issues; its additional diagnostics confirmed that rejected credentials and fresh loading errors were preserved.
- The fixture intercepted all Figma, AI and PayPal provider requests. This walkthrough created no real invoice, payment or outbound message and does not replace hosted-release qualification.
- This was a native appearance, connection and recovery check, not a full keyboard-accessibility audit or a populated-order-state matrix.
