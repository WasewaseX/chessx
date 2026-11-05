# ChessReps — Arena & Puzzles Deep Dive (Task 14-a)

Companion to `docs/chessreps-re-report.md` (Task 12-a). This report documents the two
modes that were listed but not yet deeply mined: **Arena** and **Puzzles**, plus the
shared rating module and reply engine behind them. All findings are from a **fresh
re-fetch** of chessreps.com on this session (the previous `/tmp/cr-chunks/` evidence
was wiped).

**Citation convention.** The bundles are minified (each file is 1–2 physical lines),
so file:line is meaningless. Citations are `file.js @ <byte-offset>` — byte offsets
into the exact files stored in `/tmp/cr2/chunks/`, followed by VERBATIM excerpts.
Minified identifiers are renamed per scope; I decode them inline in the prose.

---

## 1. Evidence base

### 1.1 Fetch receipts (2025 session, direct curl, Chrome 131 UA, no proxy — all HTTP 200)

| URL | Saved as | Bytes |
|---|---|---|
| https://www.chessreps.com/ | /tmp/cr2/landing.html | 449,602 |
| https://www.chessreps.com/opening/london | /tmp/cr2/london.html | 234,161 |
| https://www.chessreps.com/about | /tmp/cr2/about.html | 92,391 |
| https://www.chessreps.com/plans | /tmp/cr2/plans.html | 92,474 |
| https://www.chessreps.com/dojo | /tmp/cr2/dojo.html | 112,542 |
| https://www.chessreps.com/community | /tmp/cr2/community.html | 1,198,090 |
| https://www.chessreps.com/leaderboards | /tmp/cr2/leaderboards.html | 108,194 |
| **HTML total** | | **2,288,458** |

### 1.2 Script bundles

- Bundle URLs extracted from all 7 pages: **151 unique** `/_app/immutable/...js` paths
  (`/tmp/cr2/bundle_urls.txt`), all downloaded into `/tmp/cr2/chunks/`.
- Plus 1 dynamically-imported chunk found while tracing the avatar module
  (`CmzmiD782.js`, referenced only from JS, not from HTML). Every dynamic
  `import("./…js")` in all chunks was cross-checked — no other missing files.
- **Total: 152 chunks, 1,654,788 bytes (~1.65 MB)** (the previous task's "5.6 MB"
  figure included page payloads; bundle-only is 1.65 MB).

Key files cited below:

| File | Bytes | Role |
|---|---|---|
| `chunks/141.M7C_DN8G.js` | 233,634 | Trainer page: mode engine, Arena controller, puzzle engine, UI |
| `chunks/EnTHfCXG.js` | 13,798 | **Shared rating module + persona pool + eval-job client** |
| `chunks/DlzRKsXw2.js` | 29,151 | Eval service (eval-jobs + local Stockfish) + game-review classifier + chess.com book |
| `chunks/DO8L44YV.js` | 331 | Elo clamp/default helpers |
| `chunks/CmzmiD782.js` | 130,136 | DiceBear avatar generator |
| `chunks/BhBa4sBr.js` | — | Mode-card config (colors, unlocks, hero stats) |
| `chunks/D6FBTmki.js` | 843 | Mode-card copy (i18n defaults) |

Negative check performed: `explorer.lichess.ovh`, `lichess`, `api.chess.com`,
`openingexplorer`, `ratings=`, `speeds=` — **zero hits in all 152 chunks** (the single
`variant=` hit is a starter-line UI flag, not an explorer param). ChessReps' real-player
replies come from **their own backend**, not a public explorer API, at runtime.

---

## 2. Arena mode mechanics

### 2.1 Opponent persona: 1000-name pool, Gaussian Elo sampling

The persona pool lives in the shared rating module, `chunks/EnTHfCXG.js @ ~6823`:

```js
var L=`Kaisley.Castiel.Kylee.Wilder.Jaylah.Blaine.Colette.Rylan.Paulina.Royal.…
  …Rylan Horn`.split(`.`);
```

- **Exactly 1000 first names** (dots separated; the last entry `Rylan Horn` is a two-word
  name). Names are common US-baby-name style; duplicates exist (e.g. `Kaison` twice).
- Each persona's Elo is derived **positionally**, not stored: the pool is stretched
  evenly over 100→2400:

```js
L.map((e,t)=>({name:e, elo:Math.round(100+t/(L.length-1)*2300)}))
```

  → persona i gets `round(100 + i/999*2300)` (~2.3 Elo spacing between adjacent names).

The picker `H` (EnTHfCXG.js, exported as `a`, used as `H` in the trainer) —
**verbatim, decoded**:

```js
function H(e,t=Math.random){
  let n=0,r=0;
  for(;n===0;)n=t();            // redraw on exact 0 (log(0) guard)
  for(;r===0;)r=t();
  let i=Math.sqrt(-2*Math.log(n))*Math.cos(2*Math.PI*r),   // Box–Muller gaussian
      a=Math.round(e+i*60);                                // μ = user's arenaElo, σ = 60
  return a=Math.max(100,Math.min(2400,a)),                 // clamp 100..2400
         L.map((e,t)=>({name:e,elo:Math.round(100+t/(L.length-1)*2300)}))
          .filter(e=>Math.abs(e.elo-a)<=200)               // keep personas within ±200
          .reduce((e,t)=>Math.abs(t.elo-a)<Math.abs(e.elo-a)?t:e)  // nearest wins
}
```

**Verified against the previous report's claim `elo + N(0,1)*60`: CONFIRMED, with the
addition that the sampled Elo is clamped to 100..2400, filtered to personas within
±200, and the closest persona wins.** Because the pool is ~2.3 Elo apart, the ±200
filter is effectively always satisfiable and the winner is the persona nearest the
sampled value.

Call site — game setup `pe()` ("setupLine"), `141.M7C_DN8G.js @ 100088`:

```js
function pe(){e.ensureAvatarModule(),e.resetTrainer();let t=e.getOpening();
  if(t.sharedOpeningPgn===void 0){console.error(`No shared opening PGN found for arena mode`);return}
  let n=H(e.getArenaElo());          // sample persona at the user's arena Elo
  i(c,{name:n.name,elo:n.elo},!0);   // store opponent {name, elo}
  let r=t.sharedOpeningPgn;
  if(t.sharedOpeningPgn===``){       // course without trunk: random line's first 9 half-moves
    let e=Math.floor(Math.random()*t.lines.length);
    r=t.lines[e].split(` `).slice(0,9).join(` `)}
  e.setTargetLine(r),me(r),ce(e.getFen()),he(r,n.elo)}
```

Avatar: `createGeneratedAvatar(opponent.name)` — **DiceBear-style deterministic SVG
data-URI** (`chunks/CmzmiD782.js @ 129941`:

```js
K={mouth:[`smile`],eyes:[`default`],eyebrows:[`default`]};
function q(e){return e?C(H,{...K,seed:e}).toDataUri():C(H,K).toDataUri()}
```

), lazy-loaded as a module with `loading/loaded/failed` states
(`141.M7C_DN8G.js @ 140444`: `import('../chunks/CmzmiD782.js').then(e=>e.t)`).
Player avatar is seeded from `profile.avatarSeed ?? userId` (profile field
`avatar_seed` in `BODhiYbK.js`). DiceBear is free/open — same approach is portable.

### 2.2 Real-player reply model — their own server, NOT lichess/chess.com

Endpoints (`141.M7C_DN8G.js @ 86086`, verbatim):

```js
async function Fc(e){return Rc(`/api/arena/explorer-reply`,e)}
async function Ic(e){return Rc(`/api/arena/explorer-replies`,e)}
async function Lc(e){return Rc(`/api/arena/eval-reply`,e)}
async function Rc(e,t){let n=await fetch(e,{method:`POST`,
  headers:{"Content-Type":`application/json`},body:JSON.stringify(t)}),r;
  try{r=await n.json()}catch{r=null}
  if(!n.ok&&!zc(r))throw Error(`Arena request failed: ${n.status} ${n.statusText}`);return r}
function zc(e){return typeof e==`object`&&!!e&&`status`in e&&e.status===`unavailable`&&`reason`in e}
```

Request/response shapes (from call sites):

- `POST /api/arena/explorer-reply` body `{fen, elo, caller:"arena"}` →
  `{status:"move", move, totalGames, moveGames}` | `{status:"unavailable", reason, errorMessage}`.
- `POST /api/arena/explorer-replies` (batch) body `{fens:[…], elo, caller}` →
  `{replies:{[fen]: reply}}` where each reply is a single-position reply.
- The reply's `move` is applied only after a legality check via chess.js (`Se(n,r)` →
  `xe(e,t)`: `new Vn(e).move(t)` — `Vn` is the bundled **chess.js**).

**Who supplies the moves?** Nothing in the client touches lichess or chess.com
(negative check above). The marketing copy says where it comes from:

- plans.html: *"Arena gives you a bot near your rating. It plays the course line, then
  chooses replies **real players made at your level**."*
- about.html: *"...demolish the most common moves your opponents will actually throw
  at you, **sourced from a massive game database**."*

So the server holds its own game/move-stats database (site backend is
SvelteKit + Supabase per Task 12-a) and serves popularity-weighted replies at the
requested Elo. **Server-side weighting internals are UNVERIFIED** (client only
reveals the response contract: per-position `totalGames` and `moveGames` fields —
i.e., games in the position and games of the chosen move — which strongly implies
popularity-weighted sampling among candidate moves).

Client-side caching & prefetch (`141.M7C_DN8G.js @ 94162`, verbatim core):

```js
var Hc=new Map;
function Uc(e,t){return`${Pe(e)}|${t}`}          // cache key = normalizedFen + "|" + elo
function Wc(e,t,n=`arena-explorer-prefetch`){    // batch prefetch
  let r=Array.from(new Set(e.map(Pe))).filter(e=>!Hc.has(Uc(e,t)));
  if(r.length===0)return Promise.resolve({});
  let i=new Map;
  for(let e of r)Hc.set(Uc(e,t),new Promise(t=>{i.set(e,t)}));
  return Ic({fens:r,elo:t,caller:n}).then(e=>{let n={};
    for(let a of r){let r=e.replies?.[a],o=r&&r.status!==`unavailable`?r:void 0;
      i.get(a)?.(o),o||Hc.delete(Uc(a,t)),n[a]=o&&`totalGames`in o?o.totalGames:0}
    return n})
  .catch(e=>{console.warn(`[arena-explorer-prefetch] batch request failed`,
    {fenCount:r.length,elo:t,caller:n,error:e}); …}) }
function Gc(e,t){let n=Uc(e,t),r=Hc.get(n);return r?(Hc.delete(n),r):Promise.resolve(void 0)}
function Kc(){Hc.clear()}
```

- Cache key: `normalizedFen|personaElo`; entries are **single-use** promises (deleted on
  read), deleted on failure; whole cache cleared on game reset (`Kc()`).
- Prefetch triggers:
  1. **At game setup** — the book-exit FEN, caller `arena-explorer-prefetch-book-exit`
     (`141.M7C_DN8G.js @ 100891`):

     ```js
     function he(t,n){try{let r=new Vn;if(t&&r.loadPgn(t),r.turn()===e.getPlayerSide())return;
       Wc([r.fen()],n,`arena-explorer-prefetch-book-exit`)}
       catch(e){console.warn(`[arena-explorer-prefetch] book-exit prefetch failed`,…)}}
     ```
  2. **On every player turn** — all resulting FENs of legal moves (≤64), caller
     `arena-explorer-prefetch` (`141.M7C_DN8G.js @ 101136`):

     ```js
     function L(e){if(!A(c))return;let t=Pe(e),n=`${t}|${A(c).elo}`;if(o!==n){o=n;
       try{let e=xt(t);if(e.length===0||e.length>64)return;
         s={key:n,promise:Wc(e,A(c).elo)}}
       catch(e){console.warn(`[arena-explorer-prefetch] failed to enumerate legal moves`,…)}}}
     ```

  3. When prefetched per-move game counts exist, the top moves are ranked for eval
     prewarm with a **95 % coverage / 16 FEN cap** selector (`141.M7C_DN8G.js @ ~94962`):

     ```js
     var qc=.95;
     function Jc(e,t,{coverage:n=qc,maxFens:r=16}={}){
       let i=e.map(e=>[e,t[e]??0]).filter(([,e])=>e>0).sort((e,t)=>t[1]-e[1]),
           a=i.reduce((e,[,t])=>e+t,0);if(a<=0)return[];let o=[],s=0;
       for(let[e,t]of i)if(o.length>=r||(o.push(e),s+=t,s/a>=n))break;return o}
     ```

### 2.3 Game flow: booked line → "free play" → evaluation

**Turn engine.** The bot's move function `z` ("playMove"), `141.M7C_DN8G.js @ 105153`
— verbatim skeleton (decoded):

```js
async function z({skipDelay:t=!1}={}){
  let n=e.getFen();
  …
  if(e.getCurrentLineBoardMoves().length<e.getTargetLineMoves().length){
    // still inside the booked line: play the booked move
    let r=e.getTargetLineMoves()[e.getCurrentLineBoardMoves().length];
    Se(n,r),await ye(t),e.getChessController()?.move(r)   // ye = delay(getAiMoveDelay())
    return …}
  // ---- LEFT THE BOOK: free play ----
  Pe(n),yt(n);
  …
  let u=gt(n,{caller:`arena-eval-reply`,depth:20,minDepth:20,multiPv:1})…  // prewarm eval
  try{
    let t=await Gc(n,A(c).elo);                             // 1) prefetched explorer reply
    let a=t??await Fc({fen:Pe(n),elo:A(c).elo,caller:`arena`}); // 2) live explorer-reply
    if(a.status===`move`){r=a.move;…;s=t?`explorer_prefetched`:`explorer_live`;…}
    else if(a.status===`unavailable`){Ce(a.reason,a.errorMessage);…return!1}
    else{                                                   // 3) no explorer data → eval reply
      let t=await u,o=R(n,t);                               // R = pvs[0].line first move
      if(o){i(h,!0);r=o;s=`eval_prewarmed`;…}
      else{
        let t=await Lc({fen:Pe(n),caller:`arena-eval-reply`,depth:20,multiPv:1});
        if(t.status===`move`){r=t.move;s=`eval_live`}
        else if(t.status===`terminal`){i(g,!0);t.evaluation&&i(b,t.evaluation,!0);
          e.onPostMoveLineCompletion();return!0}
        else return Ce(t.reason,t.errorMessage),…,!1}}}
  catch(e){…}
  await ye(a);
  let d=a?0:await be();   // be(): hold up to 1500 ms waiting for the move-quality badge
  if(r){let t=e.getChessController()?.move(r)??!1;
    return t&&s&&Xc(`arena_opponent_reply`,{reply_source:s,reply_wait_ms:…,
      total_ms:…,annotation_hold_ms:d,opponent_elo:A(c).elo,
      move_index:e.getCurrentLineBoardMoves().length},{sampleRate:Yc}),t}
  …}
```

**Reply-source ladder** (telemetry values, `arena_opponent_reply` event, 2 % sample —
`Yc=.02` @ offset ~95000):
`explorer_prefetched` → `explorer_live` → `eval_prewarmed` → `eval_live` → terminal.
Eval replies are flagged (`opponentPlayedEvalReply`) and shown in result telemetry.

**Eval reply move choice** `R` (@ ~104788): first move of `pvs[0].line`, SAN-validated
through chess.js. Eval requests all go through `/api/eval-jobs` (see §2.6) with
`depth:20, minDepth:20, multiPv:1`.

**Delay:** bot reply delay = `getAiMoveDelay()` = **500 ms in Arena** (`141.M7C_DN8G.js @
~145980`: `case V.Learn:case V.Practice:case V.Arena:return 500`); skipDelay used by the
completion hotkey. Board animation duration is 150 ms in all modes.

**Move-quality badge hold.** Before the bot replies, `be()` (@ ~104275) polls up to
**1500 ms** (100 ms interval) until the player's last move has been annotated
(`isLastPlayerMoveAnnotated()`), so the badge appears before the opponent's reply.

**Player moves.** In Arena the player may play **any legal move** — the snap-back
wrong-move handler explicitly excludes Arena (`141.M7C_DN8G.js @ ~167990`:
`onPointerDown:… !(A(K)===V.Arena&&A(q))…`; mistakes in Arena are not treated as
course mistakes: `Ea`'s mistake branch handles Puzzle/Drill/Time only). Player color =
the course's `playerSide` (`gt=v(()=>A(H).playerSide)`).

**Game-end conditions** — `completionReason P()` (`141.M7C_DN8G.js @ 97871`, verbatim):

```js
function P(){return e.getMode()===V.Arena?
  e.isReviewBoardActive()?`game-review-navigation`:
  e.getIsCheckmate()?`checkmate`:
  A(h)&&e.getIsPlayerTurn()&&e.getCurrentIndex()===e.getMoveHistory().length-1?`eval-reply`:
  A(g)?`terminal-position`:`unknown`:`not-arena`}
```

- checkmate; terminal position with no reply available (stalemate etc. → the eval-reply
  endpoint returns `{status:"terminal", evaluation}` and ends the game); eval-reply
  played and it's the player's turn at the last move.
- **Move cap:** the auto-completion hotkey loop `we()` (`141.M7C_DN8G.js @ 107499`)
  alternates player/opponent moves **max 160 half-moves**:
  `for(;…&&n<160;){…}`, then `handleLineCompletion()`.
- **Resign:** a `hasResigned` state exists on the controller (no resign UI strings found
  in this chunk — likely rendered by the imported match-strip/dialog components).

**After the game** (`handleCompletion` `ve`, `141.M7C_DN8G.js @ ~101780`): view set to
`game`, completion phase `evaluating`, the game-review module is started on the final
PGN, final position evaluated (`caller:"arena-final-eval"`), then the result dialog
(`gameOverDialogOpen`) opens. `reviewCompletedGame` (`ge`, @ ~101700) switches to
`setArenaView('review')` with `startReview(pgn,{prepareReviewBoard:!0})`.

### 2.4 Arena Elo update — exact formula

The update lives in the **shared rating module** (used by both Arena and Puzzles),
`chunks/EnTHfCXG.js` — verbatim, decoded:

```js
function R(e){return 20+100*.95**e}                 // K(attempts)
function z(e,t,n,r){                                // newElo(elo, oppRating, result, attempts)
  let i=R(r),                                       //   K = 20 + 100·0.95^attempts
  a; a=n===`win`?1:n===`loss`?0:.5;                 //   score
  let o=1/(1+10**((t-e)/400)),                      //   expected = 1/(1+10^((opp-elo)/400))
      s=e+i*(a-o);                                  //   new = elo + K·(score−expected)
  return Math.round(s)}
```

- **K-factor: `K = 20 + 100·0.95^attempts`** → first game/attempts=0: K=120, decays
  toward K=20 (K=45 at ~13 games, K=25 at ~45).
- Clamp/default helpers, `chunks/DO8L44YV.js` (entire file, verbatim):

```js
function e(e){return Math.max(100,Math.round(e))}                       // floor at 100
function t(t){return typeof t!=`number`||!Number.isFinite(t)?950:e(t)}  // default 950
function n(t){let n=null;for(let[r,i]of Object.entries(t)){
  if(typeof i.arenaElo!=`number`)continue;let a=e(i.arenaElo);
  a!==i.arenaElo&&(n??={...t},n[r]={...i,arenaElo:a})}return n??t}       // migration clamp
```

Arena completion, `141.M7C_DN8G.js @ ~102950` (verbatim, decoded):

```js
…k!==void 0&&E){
  k===e.getPlayerSide()?e.shootConfetti():On();
  let t=e.getSharedProgress()??m,
      n=k===null?p                                  // DRAW → Elo unchanged
        :en(vt(p,o,k===e.getPlayerSide()?`win`:`loss`,
              t.arenaAttempts??m.arenaAttempts)),
      c=Nc(E,e.getPlayerSide(),D);
  t.arenaElo=n,i(_,n-p),                            // eloChange state = n−p
  i(l,{phase:`complete`,pgn:s,fen:d,opponent:a,oldArenaElo:p,newArenaElo:n,
       eloChange:A(_),winner:k,outcome:c,evaluation:E,bookExitEvaluation:D},!0),
  i(w,`ready`),…,
  Xc(`arena_game_completed`,{outcome:c,player_side:e.getPlayerSide(),
    book_exit_score_cp:Ac(D)??null,final_score_cp:te??null,completion_reason:v,
    elo_change:A(_),old_arena_elo:p,opponent_elo:o,
    move_count:e.getCurrentLineBoardMoves().length,
    target_line_move_count:e.getTargetLineMoves().length,
    final_eval_wait_ms:ae(C),opponent_played_eval_reply:A(h),
    terminal_position_reached:A(g)}),…}
else i(w,`failed`),i(T,A(T)??`Final position evaluation was unavailable.`,!0),…
```

where (import bindings from the two modules):
- `vt` = EnTHfCXG `z` (Elo formula above), `en` = DO8L44YV clamp `max(100, round(·))`.
- `k = F(E) = Mc(finalEval, playerSide, bookExitEval)` — **the win/draw/loss decision**.
- `c = Nc(E, playerSide, D)` — outcome string for telemetry (`win|draw|loss|unknown`).
- `m.arenaAttempts` is defaulted to 0 in the client but **never incremented client-side**
  (increment happens server/sync-side) — UNVERIFIED where exactly.

**Win/draw/loss from evals** (`141.M7C_DN8G.js @ 85562`, verbatim):

```js
function Ac(e){if(e){if(e.type===`checkmate`)return e.sideWhoCheckmated===`w`?1/0:-1/0;
  if(e.type===`score`)return e.score;
  if(e.type===`matein`&&e.matein!==void 0)return e.matein<0?-1/0:1/0}}
function jc(e){let t=Ac(e);return t!==void 0&&Number.isFinite(t)?t:0}
function Mc(e,t,n){let r=Ac(e);if(r===void 0)return;      // r = final eval (cp, White POV)
  let i=r-jc(n),                                          // delta vs baseline eval
      a=t===`w`?i:-i;                                     // from the mover's perspective
  return a>0?t:a>=-50?null:t===`w`?`b`:`w`}               // >0 win; ≥ −50cp draw; else loss
function Nc(e,t,n){let r=Mc(e,t,n);
  return r===void 0?`unknown`:r===null?`draw`:r===t?`win`:`loss`}
```

**Scoring baseline = the book-exit evaluation**: at setup, `me(targetLinePgn)`
(@ 100516) loads the booked line into chess.js and requests
`gt(fenAfterLine, {caller:"arena-book-exit-eval", depth:20, minDepth:20, multiPv:1})`
("`[arena] book-exit eval failed; scoring from 0.0`" on failure). At completion the
final position is evaluated (`caller:"arena-final-eval"`, same depth). Final delta vs
book-exit delta decides the result: **you win by "getting ahead in the opening"** —
which is exactly the mode card's detail copy ("Getting ahead in the opening wins you
elo!", chunks/D6FBTmki.js, i18n key `trainer_arena_detail`). If the opponent had to
resort to an eval reply (out of explorer data), the completion is delayed 700 ms and
`terminal_position_reached`/`opponent_played_eval_reply` are logged.

**Draws do not change Arena Elo** (`k===null ? p : …`). Opponent rating used in the
expected-score formula is the **persona's mapped Elo** (`o=A(c)?.elo`).

**Elo store defaults:** arena getter is `$t(sharedProgress?.arenaElo)` where `$t` =
DO8L44YV `t` → non-number ⇒ **950**; but the mode-card hero displays
`` `${typeof _.arenaElo==`number`?te(_.arenaElo):800}` `` (BhBa4sBr.js) → **display
fallback 800, operational default 950**. (Task 12-a reported "arenaElo default 800" —
that is the card-fallback only.)

### 2.5 Arena UI strings (verbatim)

Mode card (`141.M7C_DN8G.js @ 182360` + chunks/D6FBTmki.js + BhBa4sBr.js):

```js
alt:`Arena Mode`, title:`Arena Mode`, hint:  "Play a ranked game"          // trainer_arena_play_ranked
detail:                                      "Getting ahead in the opening wins you elo!"  // trainer_arena_detail
cta:`Start the match`, accentFrom:`#5eead4`, accentTo:`#14b8a6`,
accentGlow:`rgba(45, 212, 191, 0.55)`
// unavailable variant:
hint:`Arena is temporarily unavailable`,
detail:`We're working on it. Practice and other modes still work.`,
cta:`Back to practice`
// card unlock: unlocked: !!opening.sharedOpeningPgn && numCompletedLines>=2
// comingSoon: !opening.sharedOpeningPng (courses without a trunk)
```

Errors (controller states, verbatim):

- `` `Arena progress or opponent Elo was unavailable.` `` (missing progress/opponent)
- `` `Final position evaluation was unavailable.` ``
- `` `Arena analysis is temporarily unavailable.` `` (unavailable dialog message default)
- `` `No shared opening PGN found for arena mode` ``
- `` `Failed to build Arena game review` `` / `` `Failed to open the arena review in the analysis board` ``

Result explanation strings (review module, verbatim):

- `` `The game ended in checkmate after the opening.` ``
- `` `The game ended in mate after the opening.` ``
- `` `You had a forced mate (${r}) after the opening.` ``
- `` `You were getting mated (${r.slice(1)}) after the opening.` ``
- `` `Nice find! Your move also forces checkmate just as quickly.` ``
- `` `Nice find! Your move forces checkmate even faster.` ``
- `` `Your move still forces checkmate, though the course move does so faster.` ``

Match strip props (`141.M7C_DN8G.js @ ~178952`):

```js
r(n,{layout:`strip`,
  get opponentName(){return Y.opponent.name}, get opponentElo(){return Y.opponent.elo},
  get opponentAvatar(){return A(ra)},
  get playerName(){return A(e)},      // e = N.username.value ?? `You`
  get playerElo(){return G.arenaElo}, get playerAvatar(){return A(aa)},
  get isPlayerTurn(){return A(Nt)}, get gameOver(){return A(ln)},
  get eloChange(){return A(t)}})      // only when gameOver
```

- **Rematch:** none. `startNextGameFromDialog` (`_e`, @ ~101770) just calls
  `pe()` — i.e. **each game generates a fresh persona** (`i(u,!1),pe()`). No
  "rematch" string exists anywhere in the chunks.

### 2.6 Eval infrastructure (shared with Arena scoring + badges)

Two `/api/eval-jobs` clients exist:

1. Arena module (EnTHfCXG.js @ 0–6800): eval cache keyed
   `` `${fen}|d${depth}|m${multiPv}` ``, in-flight promise dedupe, client-side
   chess.js checkmate/draw short-circuit, then
   `POST /api/eval-jobs {fens, caller, longPollMs, depth, multiPv}` →
   `{jobId, status, summary, results:{[fen]:eval}}`; poll
   `GET /api/eval-jobs?jobId&caller&longPollMs` every 350 ms, max 10 s
   (defaults: longPollMs 0, pollLongPollMs 250, pollIntervalMs 350, maxPollMs 10000,
   caller default `arena-eval-prefetch`).
2. Review/eval service (DlzRKsXw2.js): create long-poll 5000 ms, polls every 1000 ms,
   overall deadline **120 s** (`w=5e3, ue=1e3, de=1e3, fe=12e4` @ DlzRKsXw2.js ~16900),
   and — importantly — a **local Stockfish WASM fallback worker** when the server job
   fails/times out (`getEvaluation:stockfishFallback:*` timings; worker command stream:
   `position fen …`, `setoption name MultiPV value …`, `go depth …`).

`GET /api/position-analysis/status` → `{available:boolean}` gates the feature
(`Bc()` @ 141 ~86700; `false` renders the "Arena analysis is temporarily unavailable"
state).

### 2.7 Move-quality feedback (badges) in Arena — YES, and it's chess.com-style

- The analysis board emits `onPlayerMovesVsStockfishMoves` into store `ya`
  (`141.M7C_DN8G.js @ ~179901`), and for Arena everything within the booked line is
  force-classified as book:

```js
onOrderedPlayerMovesVsStockfishMoves:e=>{A(q)||A(K)===V.Arena&&A(ln)||
  i(_n,e.map((e,t)=>t<=A(Q).length?{...e,classification:`book`,annotation:Ne.Book}:e),!0)}
```

- When the opponent replies and the line is complete, `Ca()` (@ 167880) emits:

```js
Xc(`arena_move_badge`,{shown:!!t,classification:t?.classification??null,
  available_at_play:e.availableAtPlay,window_ms:Math.round(performance.now()-e.playedAt),
  move_index:e.moveIndex,opponent_elo:Y.opponent?.elo??null},{sampleRate:Yc})
```

  i.e. badges are *per player move in free play*, and telemetry measures whether the
  badge was ready in time (`available_at_play`, `window_ms`).

- Classification engine (client, `chunks/DlzRKsXw2.js`) — **expected-points-loss
  ladder** with a review-Elo-aware win-probability model (verbatim):

```js
var R=178,z=1200,Ae=.225,B=2200,je=500,V=32e3;
function U(e,t=z){let n=Ne(t);return .5+Math.atan(e/n)/Math.PI}       // wp(cp, elo)
function Ne(e=z){let t=G(e);return t>=B?R:Math.min(je,R+(B-t)*Ae)}    // scale(elo)
function H(e){let t=W(e.bestEvaluation,e.playedBy),n=W(e.playedEvaluation,e.playedBy);
  if(t==null||n==null)return null;
  let r=G(e.reviewElo),i=U(t,r),a=U(n,r),o=Math.max(0,i-a);
  return{classification:Me(o),expectedPointsLoss:o,bestExpectedPoints:i,
         playedExpectedPoints:a,reviewElo:r}}
function Me(e){return e<=2**-52?`best`:e<=.02?`excellent`:e<=.05?`good`:
  e<=.1?`inaccuracy`:e<=.2?`mistake`:`blunder`}
```

  (scale: `min(500, 178+(2200−elo)·0.225)` for elo<2200, else 178; default reviewElo
  1200 ⇒ scale 403 cp). Special classes (same file): `book`
  (`reasonCode:"book_move"`), `forced` (`only_legal_move`), `greatFind`
  (multiPv pv0 vs pv1 win-prob gap ≥ `We=.1`), `other` (`missing_eval_or_best_move`),
  `terminal_checkmate`. Mate sequences: per-mate-distance ladder best/excellent/good/
  inaccuracy/mistake (±0..3 moves).

- **The `book` class uses a chess.com opening book shipped as an FNV-1a 64-bit hash
  set** (verbatim, DlzRKsXw2.js):

```js
function Re(e,t){if(!e||!t)return!1;
  if(!K)throw Error(`chess.com opening book is not installed; await loadChessComBook() (client) or import book-lookup.server (server) first`);
  return K.has(ze(e,t))}
function ze(e,t){return Ve(`${Be(e)}\t${He(t)}`)}       // Be(fen)="pieces turn castling ep(real?)", He(move)=lowercase
function Ve(e){let t=14695981039346656037n;for(let n=0;n<e.length;n+=1)
  t^=BigInt(e.charCodeAt(n)),t=BigInt.asUintN(64,t*1099511628211n);
  return t.toString(16).padStart(16,`0`)}
```

  (`Be` normalizes the FEN to `"<pieces> <turn> <castling> <ep>"` with a *real*
  en-passant check — ep field is `-` unless a capturing pawn is adjacent; `Ue/q`).
  The book data itself is loaded at runtime via `loadChessComBook()`/`Ie(list)`;
  **the hash-set contents are NOT in these chunks** — UNVERIFIED size/source beyond
  the name.

### 2.8 Marketing copy (fresh, verbatim)

- plans.html: *"**Arena** — Try your opening against a real opponent. Arena gives you a
  bot near your rating. It plays the course line, then chooses replies real players
  made at your level."*
- about.html: *"**Puzzles Mode:** These aren't your average computer-generated
  positions. Our green-hued puzzles are tactical situations taken from real games
  where the opening you're learning was played."*
- about.html: *"Beat Real Opponent Moves: Forget just learning "perfect theory." I
  teach you to demolish the most common moves your opponents will actually throw at
  you, sourced from a massive game database."*
- leaderboards: Drill + Time Trial leaderboards only (weekly/monthly/all-time) — **no
  Arena Elo leaderboard page**.

---

## 3. Puzzles mode mechanics

### 3.1 Batch fetch — endpoint, targeting, exclusion

Puzzle engine `ol()` (`141.M7C_DN8G.js @ ~117500–120500`). Batch fetch `S` (verbatim):

```js
async function S(n){
  let r=[...A(t)?.map(e=>e.id)??[],...p].slice(-300),
      i=new URLSearchParams({course:n,elo:String(Math.round(e.getPuzzlesElo()))});
  r.length&&i.set(`exclude`,r.join(`,`));
  let a=await fetch(`/api/puzzles/batch?${i}`);
  if(!a.ok)throw Error(`Failed to load puzzle batch`);
  return(await a.json()).puzzles}
```

- `GET /api/puzzles/batch?course=<slug>&elo=<round(puzzlesElo)>&exclude=<id,id,…>`
  → `{puzzles:[…]}`. **Exclusion list = current buffer ids + playedPuzzleIds, capped at
  the last 300** (`y()`: `t.playedPuzzleIds=[...p].slice(-300)` — cap 300 confirmed).
- Puzzle record fields used: `{id, Rating, Moves, pgn?, FEN?}` —
  `Moves` is space-separated SAN; the start position is recovered by
  `W({pgn, FEN})` (EnTHfCXG export `t`): walk the game PGN until the FEN matches and
  return the PGN prefix. This is exactly the **lichess-puzzle-DB shape**
  (GameUrl-PGN + FEN + Moves + Rating) hosted in their own DB.
- Buffer merge `C` (verbatim): dedupe by id, **sort by `Rating` ascending**
  (easiest first).
- Refill policy `w()`: if unseen-in-buffer ≥ `al = 10`, skip; else fetch another batch.
- Count-only probe for gating:
  `fetch('/api/puzzles/batch?course='+encodeURIComponent(e)+'&countOnly=1')` →
  `{total}`.

### 3.2 Source: their own puzzle table, gated at ≥100 per course

```js
function x(){return e.getPuzzleSource()===`db`&&!!e.getCourseKey()}
…
Rn=v(()=>A(Ln)===null
  ? (it()?ot():G.baseCourseSlug&&(Oe[G.baseCourseSlug]?.hasPuzzles??!1))?`db`:null
  : A(Ln)>=100?`db`:null)
```

- Mode is available only when the course's puzzle `total >= 100` (or the course is
  flagged `hasPuzzles` for user courses). The london SSR payload shows
  `hasPuzzles:true, puzzleCount:5000`.
- **No theme/ECO/rating-band params in the request** — puzzles are pre-attributed to
  openings server-side; the client filters only by `course` + current `elo` +
  `exclude`. No lichess puzzle API and no lichess theme tags appear in the client.
- Rating band selection is **client-side** in the picker (below), not server-side.

### 3.3 Puzzle picker — ±50 expanding Elo window

`G(puzzles, targetElo, playedSet)` (EnTHfCXG.js, exported as `n`, used as `bt`),
verbatim:

```js
function G(e,t,n){
  let r=50,i=null,
      a=Math.max(Math.abs(t-e[0].Rating),Math.abs(t-e[e.length-1].Rating))+50;
  for(;i===null&&r<=a;){
    let a=t-r,o=t+r,
        s=e.findIndex(e=>e.Rating>=a),c=-1;
    if(s!==-1){for(let t=e.length-1;t>=s;t--)if(e[t].Rating<=o){c=t;break}}
    else{console.warn(`No puzzle found >= ${a} with delta ${r}. Expanding range.`);r+=50;continue}
    if(c<s){console.warn(`No puzzle found <= ${o} in the valid range [${s}, end] with delta ${r}. Expanding range.`);r+=50;continue}
    let l=e.slice(s,c+1).filter(e=>!n.has(e.id));
    l.length>0?i=l[Math.floor(Math.random()*l.length)]:r+=50}
  return i}
```

**Elo targeting window: start ±50 around the user's puzzle Elo, expand by +50 until at
least one unplayed candidate exists; pick uniformly at random among them.**

### 3.4 Session flow

- **Setup** `te(puzzle)` (verbatim core):

```js
let r=wt(t);                    // start PGN via FEN-in-PGN lookup; "" warns `Could not setup puzzle because the start PGN was empty.`
let a=t.Moves.split(` `),o=a[0]?Me(a[0]):null;   // first move = opponent's setup move
…
let d=new Vn;d.loadPgn(r);for(let e of a)d.move(e);
e.setTargetLine(d.pgn()),p.add(t.id),y(),i(u,t,!0),
e.getChessController()?.goToPgn(r),
l=setTimeout(()=>{…e.getChessController()?.move(o),i(s,!1)},150)   // auto-play first move after 150 ms
```

  Race-safe via a generation counter (`c++`, `ee(n)` guard), `cancelPendingSetup`
  clears the 150 ms timer.
- **Next puzzle** `k()`: `g.startNewPuzzle()` (clears mistake-recovery state), pick via
  `G`; if buffer empty → await refill; if everything played → **clear the played list
  entirely** and retry: `` console.warn(`All puzzles played in this session. Resetting played list and selecting a new puzzle.`) `` → `b()`.
  After a solve, the next puzzle auto-loads after **600 ms**
  (`fa()`: `A(K)==V.Puzzle&&A(za)&&setTimeout(()=>{Xn.setupNextPuzzle()},600)`).
- **Rating events** (`da()` completion handler, `141.M7C_DN8G.js @ 164252`, verbatim):

```js
else if(A(K)===V.Puzzle){let e=G.puzzlesElo,t=Xn.handleCompletion(r);
  t&&Bn.puzzle.emit({type:t===`win`?`solve`:t===`recovery`?`recover`:`fail`,
                     delta:G.puzzlesElo-e})}
```

  and on a wrong move (`Ea`): `Xn.handleMistake()&&Bn.puzzle.emit({type:'fail',delta:G.puzzlesElo-e})`.
  The HUD component receives `{elo: G.puzzlesElo, event: Bn.puzzle.event}` —
  Elo + animated delta.
- **Mistake handling:** a wrong move records the loss **immediately** (rating store
  below), the move is snapped back (`cr.start(e,t)`, error notification), and the
  player retries. So: first-try solve ⇒ `solve` (full K win); solve-after-mistake ⇒
  `recover` (partial refund); the loss itself already emitted `fail` with the delta.
- **Hints forfeit recovery:** see store `a()` below — if hint count increased since the
  mistake, no refund.
- **Streak:** `onScore: e=>{i(f, e==='win'?A(f)+1:0,!0)}` — win streak counter, reset on
  any non-win. Displayed via the puzzle HUD (hero `puzzlesElo` + streak).
- **Copy** (verbatim): prompts `"Solve the puzzle!"`, `"Loading puzzle..."`,
  mistake: `"You made an incorrect move."` (action `tryAgain`); i18n key
  `trainer_next_puzzle` = `"Next Puzzle"`; praise pool of 20 strings (array `xs`,
  `141.M7C_DN8G.js @ 55817`): `Nicely done!`, `Yes! That's the way!`, `Good solving!`,
  `Perfect! Nice work.`, `Great! You found the solution!`, `You got it! Well done.`,
  `Bingo! You got it.`, `Very good!`, `You spotted the solution. Excellent!`,
  `Correct! Well played.`, `Good work!`, `Fantastic!`, `Great stuff!`,
  `Yes, indeed! You got it!`, `Very well solved!`, `Smart play!`,
  `That's right! Well played!`, `Your eyes are sharp! Good work!`,
  `Excellent play! You solved it!`, `Great play!`.
- Mode card: green gradient `#22c55e→#16a34a` ("green-hued puzzles"), unlocked when
  `hasPuzzles && numCompletedLines>=2` (card-level; the global toast ladder from Task
  12-a unlocks puzzle-arena at 5 completed lines — both gates exist), hero
  `puzzlesElo ?? 800`.

### 3.5 Puzzle Elo — same K formula + loss recovery

The rating store `U` (EnTHfCXG.js, exported `r`, used as `St`) is shared by puzzles and
arena — verbatim, decoded:

```js
function U(e){
  let t=null,           // last scored puzzle id (dedupe guard)
      n=null;           // pending recovery {puzzleId, attemptCount, lossAmount, hintCountAtMistake}
  function r(n,r){      // score(puzzle, result) — once per puzzle id
    let i=e.store.get();if(!i||t===n.id)return!1;t=n.id;
    let a=i.attempts+1;
    return e.store.set({attempts:a,elo:z(i.elo,n.rating,r,a)}),e.onScore?.(r),!0}
  function i(t){        // handleMistake: record the loss + recovery candidate
    let i=e.store.get()?.elo;if(i===void 0||!r(t,`loss`))return!1;
    let a=e.store.get();
    return n={puzzleId:t.id,attemptCount:a.attempts,lossAmount:i-a.elo,
              hintCountAtMistake:e.getHintCount()},!0}
  function a(t){        // handleCompletion recovery path
    let r=e.store.get();if(!r||n?.puzzleId!==t.id)return null;
    let{attemptCount:i,lossAmount:a,hintCountAtMistake:o}=n;
    if(n=null,e.getHintCount()>o)return null;      // hints used since mistake → no recovery
    let s=V(i,a);                                   // round(0.3·K(attempts)) capped at lossAmount
    return s<=0?null:(e.store.set({...r,elo:r.elo+s}),`recovery`)}
  function o(e,t){                                   // handleCompletion(puzzle, solved)
    return r(e,t?`win`:`loss`)?t?`win`:`loss`:a(e)}
  return{handleMistake:i,handleCompletion:o,startNewPuzzle(){t=null,n=null},
         clearMistake(){n=null}}}
var B=.3;
function V(e,t){let n=Math.round(R(e)*B);return Math.max(0,Math.min(n,t))}
```

- **Puzzle Elo default 950** (`141.M7C_DN8G.js`: `D=v(()=>A(s)?.puzzlesElo??950)`;
  card hero displays `??800`).
- Loss recovery = `round(0.3·K(attempts))`, capped at the actual loss, forfeited if any
  hint was used after the mistake. Recovery only applies to the *same* puzzle.
- Progress fields (Task 12-a sync schema, re-confirmed here):
  `{puzzlesElo, puzzleAttempts, playedPuzzleIds(≤300), arenaElo, arenaAttempts}` inside
  the shared progress record (`store.set({attempts, elo})` writes
  `puzzleAttempts`/`puzzlesElo`; `r.puzzleAttempts=n,r.puzzlesElo=t`).

---

## 4. Port spec for ChessX

Stack reminder: chess.js + React, **5.77M lichess-puzzle bank on disk (API-served)**,
**Stockfish WASM client engine**, **localStorage progress**. Ranked by impact/effort.
Everything below is implementable without chessreps' backend.

### P0 — Shared rating module (`src/lib/rating.ts`) — port verbatim

```ts
export const kFactor = (attempts: number) => 20 + 100 * Math.pow(0.95, attempts);
export function applyElo(elo: number, oppRating: number,
                         result: 'win'|'loss'|'draw', attempts: number): number {
  const score = result === 'win' ? 1 : result === 'loss' ? 0 : 0.5;
  const expected = 1 / (1 + 10 ** ((oppRating - elo) / 400));
  return Math.max(100, Math.round(elo + kFactor(attempts) * (score - expected)));
}
```

localStorage shape (single key, e.g. `chessx.ratings`):

```ts
type RatingState = {
  arenaElo: number;        // default 950; display fallback 800
  arenaAttempts: number;   // K input; increment AFTER each scored game
  puzzlesElo: number;      // default 950
  puzzleAttempts: number;
  playedPuzzleIds: string[]; // ring buffer, keep last 300
};
```

Puzzle loss-recovery port (hint-gated, same-puzzle only):
`refund = Math.min(lostAmount, Math.round(0.3 * kFactor(attempts)))` — skip if hints
were used since the mistake. Note for us: our puzzles view has hints; keep the same
honesty rule.

### P1 — Arena opponent generator (`src/lib/arena/opponent.ts`)

- Port the pool math verbatim; ship our own 1000-first-name pool (or their list —
  it's plain names; safer to generate our own to avoid copying content). Map
  `elo_i = round(100 + i/(N-1)*2300)`.
- `pickOpponent(userElo, rng=Math.random)`: Box–Muller with σ=60, clamp 100..2400,
  filter ±200, nearest; return `{name, elo, avatar}`. Avatar: deterministic SVG
  data-URI from the name — DiceBear (`@dicebear/core`, seed=name) is exactly what
  chessreps does; or a 3-line initials avatar for zero deps.
- Player color: the repertoire line's training color.

### P2 — Reply engine (`src/lib/arena/replies.ts`) — the "real players at your level" layer

Chessreps uses a private popularity-weighted DB. Our equivalent: **lichess opening
explorer** (`https://explorer.lichess.ovh/lichess?variant=standard&fen=…&speeds=…&ratings=…`),
cached; fall back to our Stockfish WASM.

Elo→band mapping (their elo is a persona/target value; lichess bands are fixed):

| user/persona Elo | lichess `ratings` |
|---|---|
| <1000 | `1000,1200,1400` |
| 1000–1399 | `1200,1400,1600` |
| 1400–1799 | `1400,1600,1800` |
| 1800–2099 | `1600,1800,2000,2200` |
| ≥2100 | `1800,2000,2200,2500` |

`speeds`: map Elo <1600 → `blitz,rapid`, ≥1600 → `blitz,rapid,classical`.
Pick move by **games-weighted random** among non-`null` moves (their server almost
certainly samples by popularity; client fields `totalGames`/`moveGames` support this).
Response contract to mirror internally:

```ts
type ExplorerReply =
  | {status:'move'; move:string; totalGames:number; moveGames:number}
  | {status:'unavailable'; reason:'no-data'|'fetch_error'|'disabled'; errorMessage?:string};
```

**Fallback chain** (mirrors theirs: prefetched → live → prewarmed eval → live eval →
terminal):

1. In-memory/prefetched cache key `normalizedFen|bandElo` (single-use promises like
   `Hc`, cleared per game).
2. Fresh lichess explorer fetch (8 s timeout, one retry).
3. Local Stockfish WASM reply: `go depth 20 multipv 1`, take `pv` first move; mark
   source `eval_live` and set `opponentPlayedEvalReply`.
4. Terminal positions (checkmate/stalemate via chess.js) short-circuit with
   `{status:'terminal', evaluation}` — never call the engine.
5. Last resort (explorer AND engine unavailable): random legal move — theirs surfaces
   `unavailable` instead; ours prefers graceful play.

**Prefetch** (the UX secret sauce): at game start, prefetch the book-exit FEN; on every
player turn, prefetch all ≤64 resulting FENs (skip positions with >64 legal moves),
rank by games and eval-prewarm the top moves covering 95 % (cap 16) with the WASM
engine — this keeps the 500 ms reply delay honest. Cache TTL: session-only (their
prefetch cache is per-game single-use; no TTL found — UNVERIFIED whether their server
caches longer).

### P3 — Arena game flow (`src/lib/arena/engine.ts` + view)

- Booked phase: play the line's trunk/booked moves with 500 ms delay; when
  `boardMoves.length >= targetLineMoves.length` → free play flag (`freePlay`).
- Player: any legal move (no snap-back in Arena).
- End: chess.js checkmate / terminal-no-reply / 160-half-move cap / resign.
- Scoring: at setup, eval the book-exit FEN (Stockfish depth 20, White-POV cp);
  at end, eval final FEN; `delta = final − bookExit` from the player's side;
  `winner = delta>0 ? player : delta>=-50 ? 'draw' : opponent` — port `Mc` verbatim.
  Elo: `applyElo(arenaElo, opponent.elo, result, arenaAttempts++)`; **draws leave Elo
  unchanged** (their behavior); clamp ≥100.
- Match strip: `{opponent:{name,elo,avatar}, player:{name,elo}, eloChange|null-until-gameOver}`;
  confetti on win; result explanations ("The game ended in checkmate after the
  opening." / mate-distance variants). Next game = **new persona** (no rematch).

### P4 — Puzzles (`src/components/views/` + API)

Our 5.77M lichess bank replaces their per-opening table. Add API route
`GET /api/puzzles/batch?opening=<ecoOrOpeningKey>&elo=<n>&exclude=<ids>&limit=…`
→ `{puzzles:[{id, rating, moves, fen, pgn?}]}`:

- Filter bank by the current repertoire course's ECO set (precompute an
  opening→puzzle-id index from the bank's ECO/Opening fields at build/serve time —
  their `puzzleCount:5000` for one opening shows the density they aim for).
- `elo` param: return a window around it (e.g. ±150 sorted by rating) — the client
  picker narrows.
- `exclude`: honor up to 300 ids; keep total response ≤ ~200 puzzles.
- Gate: show Puzzles tab for a course only when its indexed count ≥ 100 (their rule).

Client session (port verbatim behaviors):

- Picker `pickPuzzle(buffer, elo, playedSet)`: window ±50, expand +50, random among
  unplayed in window; buffer sorted by rating asc; refill when unseen < 10; when all
  seen → clear `playedPuzzleIds` and continue (log honestly).
- Setup: build start PGN from `{pgn, fen}` (walk PGN to FEN — port `W`), apply
  `Moves.split(' ')` in chess.js for validation, auto-play the opponent's first move
  after 150 ms; 600 ms auto-advance to the next puzzle after a solve; race-guard with
  a generation counter.
- Events: `solve` (first-try) / `recover` (mistake then solve, no hint) / `fail`
  (mistake, immediate Elo drop) with `delta` for the animated HUD; win-streak counter
  reset on non-win; praise-pool strings.

### P5 — Move-quality badges (P2 follow-up)

- Port the expected-points model verbatim (constants `178/1200/0.225/2200/500`,
  thresholds `2^-52 / .02 / .05 / .1 / .2`, ladder best→blunder, `greatFind` needs
  multipv 2 with wp gap ≥ 0.1). Our Stockfish WASM already supports multipv.
- In Arena, force-classify everything inside the booked line as `book`; only post-book
  player moves get engine classification; hold the bot reply up to 1500 ms until the
  badge for the player's last move is ready (`annotation_hold_ms`).
- Skip their chess.com book hash-set (data not public in the bundles); our "book"
  class = "position still inside the booked repertoire line" (equivalent semantics in
  our context).

### P6 — Polish checklist (verbatim strings/behaviors to mirror)

- Card copy pattern: hint "Play a ranked game" / detail "Getting ahead in the opening
  wins you elo!" (adapt wording, keep the honesty: Elo moves only on win/loss).
- Unavailable state: dedicated dialog + `Back to practice` CTA when the engine/API is
  down (we get this nearly free with a WASM engine — only the explorer outage needs it).
- Telemetry events to log (PostHog/console in our case): `arena_opponent_reply`
  (source ladder + timings), `arena_game_completed` (outcome, book_exit_score_cp,
  final_score_cp, elo_change, move_count), `arena_move_badge`, `arena_game_error`.
- Board animation 150 ms; bot delay 500 ms; completion reason enum
  `checkmate | terminal-position | eval-reply | game-review-navigation | unknown`.

---

## 5. UNVERIFIED items (honest list)

1. **Server-side reply weighting** of `/api/arena/explorer-reply`: exact popularity
   distribution, rating-band width, source DB (Supabase table vs licensed DB), and any
   server cache TTL. Client only proves the response contract and the per-position
   `totalGames`/`moveGames` fields.
2. **The chess.com opening book hash set** used for `book` classification: the loader
   (`loadChessComBook()`, `book-lookup.server`) and FNV-1a key format are verified, but
   the data blob is not in these chunks.
3. **Where `arenaAttempts`/`puzzleAttempts` are incremented** — not in the client
   (assumed server/sync-side on progress patch).
4. **Exact DiceBear style pack** used for avatars (the chunk embeds one style config,
   280×280 viewBox, mouth/eyes/eyebrows components; style name not labeled).
5. **`hasResigned` UI flow** — state exists on the controller; the resign button lives
   in an imported component not identified among the 152 chunks.
6. **Puzzle Elo HUD rendering** (delta animation) lives in an imported component;
   only the event contract `{elo, event:{type:'solve'|'recover'|'fail', delta}}` is
   verified.
7. chessreps' **operational arena-Elo default**: getter yields 950 when unset
   (`$t`), card hero shows 800 when unset — their own inconsistency; we should pick one
   (950) and use it everywhere.
8. Whether the arena persona's Elo also **filters the explorer band server-side**
   (client sends `elo` explicitly, so yes at request level; the band mapping itself is
   server-side and unknown).

---

## 6. Top verbatim findings (quick reference)

1. `function R(e){return 20+100*.95**e}` — K-factor — EnTHfCXG.js
2. `let o=1/(1+10**((t-e)/400)),s=e+i*(a-o);return Math.round(s)` — Elo update — EnTHfCXG.js
3. `Math.sqrt(-2*Math.log(n))*Math.cos(2*Math.PI*r)` + `a=Math.round(e+i*60)` — persona sampling σ=60 — EnTHfCXG.js (`H`)
4. `a>0?t:a>=-50?null:t===`w`?`b`:`w`` — win/≥−50cp draw/loss from evals — 141.M7C_DN8G.js (`Mc`)
5. `s=t?`explorer_prefetched`:`explorer_live`` … `eval_prewarmed` / `eval_live` — reply-source ladder — 141.M7C_DN8G.js (`z`)
6. `t.playedPuzzleIds=[...p].slice(-300)` and `/api/puzzles/batch?course&elo&exclude` — Puzzles — 141.M7C_DN8G.js (`ol`)
7. `var R=178,z=1200,Ae=.225,B=2200` + `Me()` ladder — expected-points classification — DlzRKsXw2.js
