# AGENTS.md

This file is for coding agents working in this repository.

## Goal

Maintain and evolve the Paletools mobile bookmark build plus FUT.GG SBC automation addon with minimal regression risk.

## First-Run Checklist

1. Read `README.md`.
2. Treat `paletools-mobile.user.js` as source of truth.
3. Confirm current build ID string format: `pt-futgg-YYYYMMDD-XX`.
4. Never edit `mobile-bookmark.prod.js` manually by hand for logic changes.
5. Regenerate `mobile-bookmark.prod.js` after every source change.

## Important Files

- `paletools-mobile.user.js`
  - Main codebase and addon logic.
- `mobile-bookmark.prod.js`
  - Generated URL-encoded payload.
- `index.html`
  - Bookmark drag page, must track build ID.

## Rules For Changes

- Keep edits in `paletools-mobile.user.js` unless explicitly doing release/build updates.
- Keep build references synchronized across:
  - `paletools-mobile.user.js`
  - `index.html`
  - `mobile-bookmark.prod.js` (regenerated)
- Run syntax check before commit:
  - `node --check paletools-mobile.user.js`
- Do not revert unrelated local changes unless requested.

## Release/Update Procedure

1. Implement code changes in `paletools-mobile.user.js`.
2. Bump `BUILD_ID`.
3. Update `index.html` build references.
4. Regenerate `mobile-bookmark.prod.js` from userscript source.
5. Run `node --check paletools-mobile.user.js`.
6. Commit only relevant files.
7. Push to `origin master`.

## UI Testing Protocol

- Preferred: test on a fresh tab with a logged-in session.
- If fresh tab is logged out, test on active logged-in tab and state it clearly.
- Reinject latest script before validating behavior.
- For SBC auto behavior, verify both:
  - Tile label (`Auto xN`)
  - Prompt max (`max N`)

## Known Gotchas

- Stale handlers after reinjection can cause mismatched behavior.
  - Current runtime includes shutdown/cleanup to mitigate this.
- Overlay UI can block taps on mobile.
  - Keep injected overlays non-intercepting unless interaction is required.
- Companion UI text can differ by view/state.
  - Token-based button matching must be defensive.

## Done Criteria

A change is done only when:
- Code compiles (`node --check` passes).
- Bookmark payload regenerated.
- Build IDs synchronized.
- Behavior validated in UI for the changed path.
- Commit and push completed.

