# 🌐 Model United Nations — Browser P2P Simulator

A ≤50-player **Model UN simulator** that runs entirely in the browser. Three.js
recreates a General Assembly–style hall; players join with a **room code**,
move a Roblox-style avatar, pick a **unique country**, and run the full UN
flow — office signing, seating, debate, voting, resolutions — with
**proximity voice chat**.

**No server. No backend. No accounts. No cost.** Multiplayer and voice are pure
peer-to-peer WebRTC via [Trystero](https://github.com/dmotz/trystero) (free
public Nostr relays are used only to exchange connection handshakes). One
player's browser acts as the authoritative **host**.

## Features

- **Room codes** — create a room (the code is also the encryption password) and share it.
- **Two host modes** — *Host as Player* (chair has an avatar) or *Dashboard Only* (control panel, no avatar).
- **Unique country selection** — each UN member state can be held by only one delegate; the host arbitrates.
- **Roblox-style movement** — WASD + hold **right mouse button** to drag the camera (scroll to zoom); **Space to jump** (mobile gets a Roblox-style jump button); first-person moves where you look; mobile gets a virtual joystick + drag-to-look. Mouse up looks up.
- **Rigged 3D avatars** — animated character (Idle / Walking / Sitting) tinted per delegate, with floating nameplates and a country-colored ground ring.
- **Procedural GA hall** — solid tiered delegate desks with chairs facing the rostrum, restricted top rostrum seats, UN-emblem backdrop, gold dome. Click a seat during Session/Debate to sit; **Stand Up** to leave.
- **Country offices (separate rooms outside the hall)** — each enclosed office has a wall-mounted flag, a desk with a luxury chair, two guest chairs, and signable documents. Walk in or **Visit** another delegate's office.
- **Collision** — desks, walls and the rostrum block movement; the third-person camera pulls in to avoid clipping through walls.
- **Real Model UN procedure** — fixed flow the chair drives: Roll Call → Set the Agenda → General Speakers' List → Moderated/Unmoderated Caucus → Draft Resolutions → Amendments → Voting → Adjournment. Delegates mark attendance, raise hands for the speakers' list, sponsor & sign draft resolutions, and vote Yes/No/Abstain.
- **Real country data & treaty effects** — every country carries real-world indicators (population, GDP, GDP/capita, CO₂ emissions, life expectancy, plus an expandable profile: area, density, region, capital, currency, languages…). When a resolution passes, its effects change the indicators of its signatories (or all members), shown as a before→after results panel and live ▲▼ deltas on the My Country card. Includes a sortable **World Standings** leaderboard.
- **Resolutions** — preset library per topic, or the chair authors a **custom resolution** and sets its own indicator effects.
- **Chair controls** — start session, advance the procedure, set the topic, run roll call / speakers' list, set drafts, open/close votes with tally, approve rostrum seats, grant the floor, and **designate a Chairman** (works in Dashboard-only mode).
- **Session orchestration**:
  - **Timetable** — the Chair/Chairman defines local-time blocks (In Session / Office Hours). With **auto-teleport** on, everyone is moved to the Hall or their office at each block's start.
  - **Auto vs manual flow** — the Chair chooses to auto-run the real UN procedure (phases advance on timers) or step it manually.
  - **Session presets with a 1-minute countdown** — before the session the Chair picks the agenda; if not chosen in time the system auto-picks. Presets include topics plus **Elect a Chairman** and **Elect Security Council members** (an ⅔ "important question").
  - **Chairman campaign** — optional election for Chairman at the start.
  - **Points & Motions** — delegates can raise a Point of Order / Personal Privilege / Parliamentary Inquiry / Right of Reply or motion for caucuses/voting (broadcast to the room). "Present & Voting" delegates cannot abstain.
- **Courtroom-roleplay presentation** (in the spirit of the Roblox Ace Attorney games, adapted to Model UN): type a statement to **speak** — it appears as a speech bubble over your delegate and a typewriter **dialogue box**; a big **"Point of Order!"** splash for objections; the Chair can **bang the gavel** for "Order!"; **present documents** to the whole assembly; and votes resolve with a **"Motion Carried / Failed"** splash. Sound effects are synthesised in the browser (no audio files).
- **Voice chat** — proximity-based in the hall, room-based inside offices, and hall-wide when the chair grants you the floor.
- **Roles & rights** — a built-in **Rules of Procedure** reference (Chair, P5 with veto, non-permanent Council members, member-state rights), role badges on the My Country card, and a **Security Council vote mode** (only Council members vote; 9-of-15 affirmative + P5 veto). The designated **Chairman** can drive the whole procedure even without being the room host (requests are relayed to the authoritative host). The host can **Kick / Ban** delegates.
- **Anti-cheat (host-toggleable, auto-ban)** — because this is a P2P, host-authoritative game, a host-side guard authenticates the **origin** of every authoritative message (a client can't forge phase changes, votes, results, kicks, or chair status), validates **movement** (out-of-bounds clamping, speed/teleport detection, **fly** detection that still allows real jumps, and **noclip/wall-clip** detection against the world colliders), enforces **one country per peer** and **Security-Council vote eligibility**, checks **speaker/chat identity** (no impersonating another country), and **rate-limits** floods. Repeat offenders are **auto-banned**. The host sees blocked attempts live and can turn the whole system on/off.
  - **Cryptographic message authentication** — origin checks rely on the WebRTC transport's per-peer attribution, which stops a normal member from forging host messages but not a library-level identity forger. So on top of that, the host generates an **ECDSA (P-256)** keypair on room creation, ships its **public key in the first snapshot** (trust-on-first-use, like the host id), and **signs every authoritative message**; clients verify the signature (binding action name + payload, so cross-action replay fails too). A member has the room code but not the host's private key, so forged authoritative messages are cryptographically rejected. Falls back to origin-only checks if WebCrypto is unavailable (non-HTTPS).

## Run locally

WebRTC, pointer interactions and the microphone require `https://` **or**
`http://localhost` (they do **not** work from `file://`). Serve the folder:

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Open two browser windows (one normal, one incognito) so they get different
peer IDs: create a room in one, join with the code in the other.

## Deploy on Cloudflare Pages (free, no card)

1. Push this repo to GitHub.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Pick the repo and branch `main`.
4. Build settings: **Framework preset = None**, **Build command = empty**, **Build output directory = `/`**.
5. **Save and Deploy** → you get an `https://<project>.pages.dev` URL with HTTPS.

(GitHub Pages also works: Settings → Pages → Deploy from branch `main` / root.)

## Tech / structure

- No build step to run — `index.html` + ES modules via importmap. Three.js (`0.185.0`) and Trystero (`0.25.2`, Nostr strategy) are **vendored** as browser ESM bundles under `vendor/`, so the site is fully self-contained with no third-party CDN dependency at runtime.
- Country data & flags are pre-generated. To refresh them, run `node tools/build-data.mjs` — it fetches real indicators (OWID, mledoze, samayo) and 193 flag SVGs (lipis/flag-icons) from GitHub and writes `js/country-data.js` + `assets/flags/*.svg` (both committed).
- `js/net.js` & `js/state.js` hold all networking and authoritative state.
- `js/hall.js`, `js/office.js` build the world; `js/player.js`, `js/avatars.js` handle movement; `js/voice.js` does spatial audio; `js/ui.js` the interface.

## Security model (anti-cheat)

The game is **P2P with one authoritative host**. A cheater fully controls their own
browser — they can call any function and craft any message — so every defense lives
on the **receiving** side: the host validates client *requests*, and every node
rejects authoritative *broadcasts* that aren't from the real host. The host can
toggle anti-cheat on/off and repeat offenders are **auto-banned** (6 host-detected
offenses). What it stops, and how:

| Attack (a malicious client tries to…) | Defense |
| --- | --- |
| Forge a phase change / vote result / kick / chair status (broadcast as if from the host) | **Origin auth**: `peerId` is set by the WebRTC transport, not the payload, so forged broadcasts arrive under the cheater's own id and are dropped. **Plus ECDSA signatures**: the host signs every authoritative message; a member has the room code but not the host's private key, so the signature won't verify (binds action+payload, so cross-action replay also fails). |
| Spoof their `peerId` at the library level to *look* like the host | Caught by the **signature** layer — still can't produce the host's signature. |
| Inject a fake snapshot to hijack a new joiner | Only the **first** snapshot is trusted (TOFU); later snapshots must come from the established host id. The host's public key rides in that first snapshot. |
| Speed-hack / teleport across the map | Host checks per-tick distance vs. run speed; sustained over-speed is rejected (occasional big jumps are allowed as legit teleports). |
| **Fly** | Host detects *sustained* airtime and clamps to the ground — real **jumps** (transient) still pass. |
| **Noclip** through walls | Host rejects any position **inside a solid collider**. |
| Grab multiple countries | One country per peer; extra claims rejected. |
| Vote when not on the Security Council (SC vote) | Host enforces Council eligibility. |
| Impersonate another country in speech/chat | Host verifies the claimed ISO belongs to the sender. |
| Flood messages | Per-peer, per-action rate limiting. |

**What it does *not* solve:** voice eavesdropping. In a pure WebRTC mesh, anyone who
receives an audio stream can listen regardless of proximity/zone gating — fixing that
needs a server (SFU), which is out of scope for a zero-cost build.

A Tampermonkey **test cheat** (fly/noclip/forge/flood) is available on request to
exercise each of these defenses with anti-cheat on vs. off.

## Known limits

- Trystero is a full WebRTC **mesh**; 50 players is the stretch ceiling. Position
  data is funneled to the host and re-broadcast in batches to ease this, but test
  stability at 8–15 first. Voice streams are the heaviest part of the mesh.
- If the **host disconnects, the session ends** (v1 does not migrate the host).
- Strict/symmetric NATs may fail to connect on default STUN; a TURN server would
  fix it but is out of scope for a zero-cost build.

## Credits / license

Code is MIT (see `LICENSE`). The hall and offices are generated procedurally
from Three.js primitives. The avatar model `assets/models/character.glb`
("RobotExpressive") is **CC0** by Tomás Laulhé (Quaternius), modified by Don
McCurdy — free for any use, no attribution required.
