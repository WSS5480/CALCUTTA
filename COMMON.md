# Common rules for every Oddable coder
- Read /home/claude/OWNER-DECISIONS.md fully, including the newest sections at the end (G16, S-ALL, P1, H1), and your repo's HANDOFF.md.
- A previous coder may have been stopped partway through. Your repo may have UNCOMMITTED work: run `git status` and `git diff` first, then keep that work and finish it. Never reset or discard it.
- Do NOT push, merge or deploy. No live data writes (no live server POSTs, no Supabase writes). Never spend Odds API credits.
- Money is display only; Oddable never collects, holds or pays.
- Use the live Oddable look.
- The floating My Bets banner must never cover tabs, buttons or cards.
- No sideways-scrolling tables on phones; wrap them into cards. Table headers sit over their data: numbers right, text left.
- Every summary number or tile drills down to the detail behind it, with a back button.
- Run all tests. Take Playwright screenshots at 430x900 where there's UI.
- Update HANDOFF.md in the same commit. End every commit message with:
  Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01GQBUzRa3mp2z4f5XMngnXQ
- Report commit hashes, test results and screenshot paths. Don't stop until done.
- Never use the owner's Chrome or any claude-in-chrome / browser-extension tool. Verify with headless Playwright in the sandbox and Render logs only.
- Never kill processes by a broad name match (e.g. `pkill -f server.js`): other coders and reviewers run servers here. Kill only PIDs you started, and use your own ports.
