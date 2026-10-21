# THE ADMIN MERGE — mechanical execution plan (the unfinished task)

## The goal (owner directive, verbatim intent)
The front page shows ONLY: (1) her 3D module (the hangar card + stats +
body language) and (2) an ADMIN drawer for editing/settings. The brain
controls everything else. All other sections fold away.

## The hard part, already solved tonight (do not rediscover this)
`DronePetPanel.tsx` is built from sequential self-contained JSX fragments:
`{(<> ... </>)}` pairs. The section COMMENTS (`{/* --- optical feed */}`)
sit INSIDE their fragments — cutting at comment boundaries orphans the
fragment opener/closer (two failed attempts, both reverted).

## The verified fragment map (line numbers at commit fdf4b3c)
| Fragment | Opens | Closes | Contains |
|---|---|---|---|
| A | 2056 | 2081 | camera block (optical feed) |
| B | 2083 | 2275 | **THE 3D MODULE** (flight body, stats, body language) + replay + missions |
| C | 2281 | 2357 | senses chip drawer + controls (WAKE SENSES, toggles) |
| D–I | 2358–2490 | … | audio meter, small sections |
| J–L | 2494–2704 | … | memory, mental map, task HUD, diary, routines, voice studio, about, speech log |

Re-derive with: `python - << EOF` scanning `\{(<>|</>\)\}` in order (the
exact script is in git history, commit 2fd5e2a's cleanup attempts).

## The mechanical steps (next session)
1. Re-derive the fragment map (numbers shift with every commit).
2. Keep visible: fragment B ONLY (plus consent modal, which lives before A).
3. Fold into ONE admin `<details>` (not three): fragments A, C, D–last,
   in order, each inside a labeled sub-section:
   - "SENSES" ← A, C
   - "MIND & MEMORY" ← D–I, J–L
   Implementation: build the drawer content by JOINING each fragment's
   span (they are balanced — verified: 4 opens / 4 closers in the tail).
4. Move fragment B to the top if it is not already first.
5. `npx tsc --noEmit` MUST pass before touching anything else. Then the
   Playwright screenshot: the visible page shows the hangar + one
   collapsed ADMIN drawer. If tsc fails, `git checkout --` and re-derive
   the map — do NOT hand-patch JSX.
6. The replay/missions blocks are inside fragment B: if they should fold
   too, split fragment B first (map ITS internal `{(<>` pairs the same
   way) — never cut mid-fragment.

## Why tonight's attempts failed (so it's not repeated)
- Attempt 1: cut at comment boundaries → orphaned fragment closers.
- Attempt 2: cut at comment boundaries again after "restoring" — same
  orphan pattern; plus a CLOSE_LEN off-by-one (the closer token is
  exactly 5 chars: `</>)}`).
- The revert (`git checkout --`) is the safety rail — it worked both
  times. Use it without hesitation.
