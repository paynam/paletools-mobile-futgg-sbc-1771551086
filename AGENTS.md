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

## Browser Debug Workflow

- Use full Chrome, not a lightweight/headless substitute, when the user needs to log in.
- Reuse a persistent Chrome profile so EA login survives restarts.
  - Example used in this repo: `.chrome-profile-fc`
- If the site breaks when DevTools opens because of `debugger`, avoid the visible DevTools UI and use the remote debugging socket instead.
- When testing mobile-only behavior, emulate an actual phone viewport and user agent.
  - Example that worked: iPhone Safari, `390x844`, DPR `3`, touch enabled.
- Verify the page is actually in phone mode before drawing conclusions.
  - Useful signal: `body` contains `phone`.
- Reinject the latest local script into the active logged-in tab after code changes.
  - Do not assume the old bookmark payload or prior injection matches local source.
- If the bookmark page has not been refreshed yet, direct injection from local file/network is acceptable for debugging, but final validation must use the regenerated build.

## Mobile SBC Debug Notes

- On mobile SBC overview pages, the visible pen/edit button can be required before Smart Builder appears.
- Do not rely only on token search in the DOM for mobile SBC actions.
  - Prefer inspecting the active EA controller/view objects when DOM text is missing.
- Useful controller path:
  - `getAppMain() -> root controller -> current tab bar -> current navigation controller -> current SBC controller`
- Relevant mobile controllers observed in this flow:
  - `UTSBCSquadOverviewViewController`
  - `UTSBCSquadDetailPanelViewController`
- Useful controller actions observed in this flow:
  - Overview detail open: `_eDetailsButtonSelected`
  - Detail smart builder: `_eSmartBuilderSelected`
  - Navigation back: `eBackButtonTapped` / `_eBackButtonTapped`
  - Overview submit: `_eSubmitSelected`
- If a visible button click does nothing, inspect the control's tap bindings.
  - Many EA controls expose target/action bindings under `_targets._collection.tap`
- For Daily Bronze style flows on mobile, the working sequence was:
  1. Open SBC tile
  2. Open detail panel / pen button
  3. Trigger Smart Builder
  4. Go back to overview
  5. Submit from overview

## End-to-End Validation Notes

- When testing auto-run prompts, restore any temporary `window.prompt` override after the test.
  - Otherwise later taps can look broken because they silently reuse the forced value.
- Validate the actual post-run state, not just logs.
  - Example checks:
  - `Auto x5 -> Auto x4`
  - `Completed 0 times -> Completed 1 times`
- If the auto button appears to open the SBC instead of prompting, first rule out prompt overrides and stale injected handlers before changing event code.

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
