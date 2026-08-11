# Sardines

A minimal, shared-timer hide-and-seek app. Everyone joins a room, types their name and
picks a role, then the hiding timer, hint countdown, and hint requests are synced live
for everyone in the room.

## Why a Worker, not Pages

Pages is static-file hosting with no shared state — it can't keep a room's timer and
hint requests in sync across everyone's phones. That needs a small stateful backend.

This app is a single **Cloudflare Worker** that does both jobs at once:

- It serves the static site (`/public`) as free, unlimited static assets.
- It runs a **Durable Object** (`GameRoom`, one instance per room code) that holds the
  room's state and pushes updates to every connected client over WebSockets.

Durable Objects are Workers-only — Pages can't run them. As of 2026 Cloudflare also
recommends Workers-with-static-assets over Pages for new projects generally, and
Durable Objects are available on the free plan, so this is both the only option that
works and the cheapest one. One `wrangler deploy` ships the whole thing.

## Deploy

```bash
npm install -g wrangler   # if you don't have it
cd sardines
wrangler deploy
```

Wrangler prints your `*.workers.dev` URL — that's the whole app, frontend and backend
together. Add a custom domain later in the Cloudflare dashboard if you want.

## How a round works

1. Everyone opens the URL, types the same room code, their name, and picks
   **Hider** or **Seeker**, then joins.
2. The lobby shows who's in and lights up **Start round** once there's at least one
   of each role. Anyone can tap it.
3. Hiders get **2 minutes** — the countdown is identical on every screen because it's
   driven by a single server timestamp, not a local clock.
4. A seeker can tap **Request a hint** at any point. Every hider instantly sees a
   notification banner with a text box. The first hider to type something and send it
   delivers the hint to all seekers.
5. After a hint is sent, that seeker's hint button is disabled for **90 seconds**
   before another request can go out. Max **3 hints** per round.
6. Once the timer hits 0, the label flips to "Seek!" and a **New round** button
   appears — it resets the timer and hints but keeps everyone's name and role, so you
   can play again without rejoining.

## Notes / limitations

- Room codes are just a shared namespace — anyone who knows the code can join, there's
  no password. Fine for a group hanging out together; add auth if you need more.
- The countdown assumes players' phone clocks are reasonably close together (they all
  compute "time left" from the same server start-time). For a casual game in the same
  house/yard this is accurate to well under a second.
- If someone's connection drops, they're removed from the room; refreshing rejoins
  them (they'll need to re-enter name/role).
