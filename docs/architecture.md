# Code architecture

`math.ts` - standard maths routines, independent of our physics/game
`physics.ts` - core gameplay physics, cannot depend on three.ts
`renderer.ts` - depends on physics
