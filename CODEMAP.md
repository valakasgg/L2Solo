# Code map — session 1

Verified against commit `2eeb182b` (upstream `main`, fetched 2026-09-27) on branch `dev`.
This supersedes the "reported file locations" in [HANDOVER.md](HANDOVER.md) §2, several of which were wrong.

Baseline: `npm run check` passes (1601 files), `npm test` passes, Node 22.18.0 (pinned in `.nvmrc`).

---

## 1. Corrections to the handover

| Handover said | Actually |
|---|---|
| `src/GameServer/Bot/BotAI.js` | ✅ correct |
| `src/GameServer/Bot/AI/States/` | ✅ exists |
| `src/GameServer/Bot/Population/*` | ✅ correct (much larger than described — ~90 files) |
| `ExperienceReward.js` (hot path) | ➡️ `src/GameServer/Actor/Generics/ExperienceReward.js` |
| `NpcRewards.js` | ➡️ `src/GameServer/World/Generics/NpcRewards.js` |
| `NpcDied.js` | ➡️ `src/GameServer/Actor/Generics/NpcDied.js` |
| `ProgressionCap.js` | ➡️ `src/GameServer/Progression/ProgressionCap.js` |
| `tests/test_hot_cold_progression_parity.js` | ⚠️ does **not** exist. Tests are an explicit list in `scripts/run-tests.js`, not glob-discovered |
| Node 22.15+ | `package.json` engines says `>=22.5.0` |
| Issue **#117** (SQLite lock) blocking Phase 0.1 | ⚠️ **CLOSED upstream.** Re-verify before doing 0.1 |
| Issue #131, #132 | ✅ still open |

**Not in the handover:** `src/GameServer/ProgressionRates.js` is the single source of all rate
multipliers. It is the natural hook for bot rates and the handover never mentions it.

---

## 2. Reward flow

### The rate profile (shared by everything)

`src/GameServer/ProgressionRates.js` → `profile()` returns
`{ preset, multiplier, exp, sp, adena, drop, spoil, quest* }`, computed as
`General.<x>Rate × PRESETS[progressionPreset].multiplier`.

**It takes no actor argument.** There is no bot/human distinction anywhere in the rate layer today,
which confirms task 1.1 is genuinely new work. This function is where a
`profile(actor)` or `botProfile()` overload belongs.

### Hot path (bots near you, and you)

```
NpcDied.js:209
  └─ Generics.experienceReward(session, actor, exp, sp)
       └─ ExperienceReward.js:19-21
            exp = exp * rates.exp * EffectStats.multiplier(actor, 'expMul')
            sp  = sp  * rates.sp
            └─ ProgressionCap.applyAward(actor.fetchExp(), exp)
```

Hot bots are real server sessions, so they earn through exactly the same call as you do.
**`ExperienceReward.js:19` is hook point #1.**

### Cold path (bots you cannot see)

Solo — `src/GameServer/Bot/Population/BackgroundResolver.js:1213`:

```js
exp: Math.round(overhit.adjustedExp * expMultiplier * rates.exp ...)
sp:  Math.round(rewards.sp * expMultiplier * rates.sp)          // :1215
```

Party — `src/GameServer/Bot/Population/BackgroundPartyResolver.js:67-69`:

```js
memberProgression[i].exp += Math.round(share.exp * expMultiplier * rates.exp * ColdCombatProfile.statMultiplier(...))
memberProgression[i].sp  += Math.round(share.sp  * expMultiplier * rates.sp)
```

**Those two files are hook points #2 and #3.** Note the extra `expMultiplier` term — see §3.

### Other rate consumers (do not break these)

`ClanContributionPolicy.js:35` (clan funding scales by `adena^0.59`), `PetRuntime.js`,
`NpcRewards.js:51-55` (drops), `QuestService.js:388`, `BotEconomyPricing.js:7`,
`MarketListingPolicy.js:29` (behaviour differs on x1/x10 vs x50), and ~8 individual quest files.

⚠️ Changing `profile()` globally would move bot shop prices and clan funding thresholds too.
A bot-specific rate must be applied **at the three reward sites**, not inside `profile()`.

---

## 3. ⚠️ The director already implements the catch-up you rejected

`src/GameServer/Bot/Population/PopulationDirector.js` — `pressureForState(state)`, lines 143-190.

It computes `targetLevel` = **median level of online non-bot players** (refreshed every 30 s), then
for each cold bot:

| Condition | Result |
|---|---|
| `targetLevel - level > 2` | `expMultiplier` up to **1.35**, `directorReason: 'catch_up'` |
| `level - targetLevel > 2` | `expMultiplier` **0.85**, `directorReason: 'ahead_slowdown'` |
| within ±2 | `expMultiplier` 1.0, `'in_band'` |

Defaults in `PopulationConfig.js:193-198`:

```
directorTargetBandRadius     = 2
directorMaxCatchUpMultiplier = 1.35
directorSlowdownMultiplier   = 0.85
newbieAnchorMaxLevel         = 5
newbieAnchorExpMultiplier    = 0.2
newbieAnchorFloorRatio       = 0.12
```

**This actively compresses the bot population toward your group's median level — the exact
opposite of "players at every level, not tracking the humans" in HANDOVER §4.** It is on by
default (`config/default.ini:99`, `directorEnabled = true`).

Two things worth separating before you act:

- The **catch-up / slowdown pressure** is what you rejected.
- The **newbie anchor** (`stats.newbieAnchor`, keeps ~12% of the population at level ≤5 on 0.2×
  XP) actually *implements* your "newbie zones stay alive" goal. Don't throw it out with the rest.

So `directorEnabled = false` is too blunt — it disables both, and also blanks the
`PopulationStatus` line. Suggested Phase 1 task: add a `directorPressureEnabled` flag (or set
`directorMaxCatchUpMultiplier = 1` / `directorSlowdownMultiplier = 1`) so the anchor and
telemetry survive while the level-tracking goes away.

**Also a hot/cold asymmetry:** `pressureForState` is only consumed on the cold path
(`BackgroundResolver.js:1185`, `BackgroundPartyResolver.js:49`, `ColdSimulationCoordinator.js:778`,
`PopulationService.js:2697/3198/3203`). Hot bots never see it. So a bot's XP rate silently changes
when it comes into your view range. Any parity test must cover this.

---

## 4. Level caps

`src/GameServer/Progression/ProgressionCap.js`:

- `validate(config)` — reads `General.maxLevel` (80) and `Progression.contentCap` (78), throws if
  `contentCap > maxLevel`
- `effectiveLevelCap()` = `min(maxLevel, contentCap)` = **78**
- `clampLevel()`, `clampTotalExperience()`, `maximumAllowedExperience()`, `applyAward()`

`applyAward()` returns `{ requested, accepted, discarded }` — it already implements "freeze XP at
the cap" cleanly, so task 1.3 (human-relative cap) can reuse it by passing a lower effective cap
rather than inventing new clamping. This is the cleanest part of the codebase for our purposes.

---

## 5. Single-human assumptions

Good news: no `sessions[0]` / `thePlayer` style globals. Player identity is resolved by
**account-name prefix** — `!String(session.accountId).startsWith('bot_')` — in at least:

```
World/World.js                    Automation.js            DevConsole.js
Shortcuts.js                      Network/Request/Speak.js World/Generics/NpcRewards.js
Clan/ClanInviteService.js         Clan/ClanAllianceService.js
Clan/ClanAllianceRepository.js    Geodata/PlayerTransitionRecovery.js
Social/CombatHelpMemory.js        ClanHall/Doors.js
```

`PopulationDirector.realPlayerLevels()` (lines 64-75) already iterates **all** online human
sessions and takes a median, so the population layer is not hard-wired to one player.

The 0.5 spike should therefore focus on:
1. **Hot-zone union** — `HotActivation` / `activationRadius` is computed around players; confirm it
   unions rather than picks one.
2. **Social memory keying** — `Social/CombatHelpMemory.js` and bot reputation: per-player or global?
3. **Chat routing** — `Speak.js`, and the clan/party LLM conversation history, which README
   describes as a single shared bounded buffer per clan.

⚠️ Note the account-prefix convention: **never create a friend account starting with `bot_`.**

---

## 6. Suggested next steps (revised)

1. ~~#131 login sanitising~~ — **done**, commit `58e68fc4`, test `tests/test_account_name_validation.js`.
2. Re-verify **#117** against current `main` before spending Phase 0.1 effort; it is closed upstream.
3. **#132** player clan creation — still open, and blocks a core friends-server requirement.
4. Write the missing hot/cold parity test harness *before* 1.1. There is no existing
   `test_hot_cold_progression_parity.js` to extend; it has to be built.
5. Decide the director question (§3) — this is an owner decision, not a code decision.
6. Then 1.1/1.2 bot rates at the three hook sites in §2.
