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
- **Roblox-style movement** — WASD + hold **right mouse button** to drag the camera (scroll to zoom); first-person moves where you look; mobile gets a virtual joystick + drag-to-look. Mouse up looks up.
- **Rigged 3D avatars** — animated character (Idle / Walking / Sitting) tinted per delegate, with floating nameplates and a country-colored ground ring.
- **Procedural GA hall** — solid tiered delegate desks with chairs facing the rostrum, restricted top rostrum seats, UN-emblem backdrop, gold dome. Click a seat during Session/Debate to sit; **Stand Up** to leave.
- **Country offices (separate rooms outside the hall)** — each enclosed office has a wall-mounted flag, a desk with a luxury chair, two guest chairs, and signable documents. Walk in or **Visit** another delegate's office.
- **Collision** — desks, walls and the rostrum block movement; the third-person camera pulls in to avoid clipping through walls.
- **Chair controls** — start session, advance the agenda phases, set the topic, open/close votes with tally, approve rostrum seats, grant the floor, and **designate a Chairman** (works in Dashboard-only mode).
- **Voice chat** — proximity-based in the hall, room-based inside offices, and hall-wide when the chair grants you the floor.

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

- No build step — `index.html` + ES modules via importmap. Three.js (`0.185.0`) and Trystero (`0.25.2`, Nostr strategy) are **vendored** as browser ESM bundles under `vendor/`, so the site is fully self-contained with no third-party CDN dependency at runtime.
- `js/net.js` & `js/state.js` hold all networking and authoritative state.
- `js/hall.js`, `js/office.js` build the world; `js/player.js`, `js/avatars.js` handle movement; `js/voice.js` does spatial audio; `js/ui.js` the interface.

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
