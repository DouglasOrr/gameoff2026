# Pogo 3D

Second prototype in the 2D vs 3D pogo-mechanics pair: the same spring-foot
physics as `../game-pogo-2d`, generalised to 3D with a chase camera.

## Run

```sh
npm install
npm run dev      # vite dev server
npm run sim      # headless physics sanity checks (tsx)
npm run build    # tsc + vite build
```

## Controls

- **WASD** — lean the stick in the rider's heading frame (W = forward, S =
  back, A/D = left/right). The stick eases back to vertical when released;
  hold a direction to keep pushing that way on each bounce.
- **Q / E** — rotate the heading (the chase camera swings around to stay
  behind you).
- **R** — reset.

As in 2D: no power-bounce yet, no damping — the pogo bounces continually at a
constant height, and the rider spawns slightly in the air so it starts
bouncing immediately.

## Model

Identical to the 2D prototype (`src/core/pogo3.ts`): a point-mass rider on a
massless stick; the foot is a spring against a height field, rebounding along
the line of action of the stick with a little friction; lean past ~46° and the
foot slips out. The only difference is geometry:

- the lean is a 2D vector in the rider's heading frame, rotated into world
  space: `worldLean = leanF·forward + leanR·right`
- stick direction (rider → foot): `d = (-worldLean, -cosA)` with
  `cosA = sqrt(1 - |lean|²)`, so the spring push is `(worldLean, cosA)`
- friction opposes the foot's horizontal sliding, measured numerically across
  the substep

Constants match the 2D version (`K`, `C`, `THETA_SLIP`, `MAX_COMPRESS`, ...)
plus `HEADING_SPEED` for Q/E.

## Level

Flat ground plane with box obstacles along the z axis (same heights as the 2D
course). No gaps: in 3D you can also go around a wall, so walls are 400 wide
to read as obstacles. `FINISH_Z = 4500`.

## Graphics

Simple flat-coloured Lambert materials with a directional light, a sphere
rider + cylinder stick + nose marker (so the heading is readable), and the
stick shortens by the spring compression on each bounce. The chase camera is
a smooth third-person follow behind the heading (`render3.ts`).

## Tuning notes

Sanity numbers from `npm run sim`:

- idle bounce (no input): ~14 flight apexes over 10s, first 250px last 251px —
  steady, no decay
- hold W: accelerates along +z each bounce, caps at `SPEED_MAX`
- hold W + Q: curves left, as expected
- peak foot leaning forward ~173px; high flight clears a 300 wall, low flight
  is stopped by it
