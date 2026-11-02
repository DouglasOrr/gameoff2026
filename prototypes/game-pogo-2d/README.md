# Pogo 2D

Prototype evaluating 2D pogo-stick mechanics (first of a 2D vs 3D pair).
Model, controls, and physics constants all live in `src/core/pogo.ts`; the
level is a hand-placed height field in `src/core/level.ts`.

## Run

```sh
npm install
npm run dev      # vite dev server
npm run sim      # headless physics sanity checks (tsx)
npm run build    # tsc + vite build
```

## Controls

- **← / →** (or A/D) — lean the stick. Lean *while the foot is in contact* to
  push off in that direction; let go in the air. Lean past ~46° while on the
  ground and the foot slips out and the bounce collapses.
- **R** — reset.

There is no power-bounce yet (removed for this iteration) and no damping — the
pogo bounces continually at a constant height on its own; the rider spawns
slightly in the air so it starts bouncing immediately.

## Model

A point-mass rider on a massless stick of length `L`. The foot is a spring
against the ground surface (a heightmap of the blocks), giving a rebound along
the line of action of the stick plus Coulomb friction, per `docs/design.md`.
`groundHeight` collapses the blocks into a height field, so the *foot* must
clear a wall top — the rider has to rise one stick length above it.

The spring stiffness `K` is soft enough that the compression is visible, and
the renderer shortens the stick by the compression (slightly exaggerated) so
the pogo reads as squashing on each bounce.

Key knobs (`Pogo` in `pogo.ts`): `K` spring stiffness, `C` damping (0 = no
decay), `FRICTION` foot grip (low = lean accelerates each bounce), `THETA_SLIP`
grip angle, `MAX_COMPRESS` squash cap, `SPEED_MAX` speed clamp, `SPAWN_DROP`
initial bounce height.

## Scaling

The camera shows a vertical span of `VIEW_H` world units (`render.ts`). It was
720; it's now 1440 so the pogo is smaller on screen (roughly the "zoomed out to
50%" look). The canvas fills the window and `resize()` handles it explicitly.

## Tuning notes

Sanity numbers from `npm run sim`:

- idle bounce (no input): ~14 flight apexes over 10s, first 250px last 251px —
  steady, no decay
- constant small lean accelerates each bounce (e.g. 15°: 0 → 339 → 802 px/s;
  46° cruises ~890 px/s); steeper lean = faster
- peak foot: idle bounce ~140px; leaned carry ~451px (walls need the foot
  above their top)
- carry (lean on contact only): builds speed without falling through gaps
- high flight clears a wall; low flight is stopped by it
