# Pogo-stick based game

_Note theme connection: SHIFT = "shift position"; possibly also shift key to power-bounce._

_This is an early draft document, not a complete design._

Aim: Navigate a world on a pogo stick, which you can rotate underneath you to control your speed & direction indirectly.

Mechanics: Classical 3D physics with a pogo stick which gives a rebound force from the ground while in contact - both along the line of action of the stick, and probably a bit of friction too for when the user is giving a "rotate" control while the stick is in contact. Either model friction or simply have a maximum angle after which it slides out & the player falls.

Controls: Rotate-left/rotate-right/power-bounce. Rotation commands rotate the pogo stick at any time, and power-bounce increases the rebound force from the ground, with a larger increase when released while the pogo is in contact.

Challenge: Initially, simply exploring / navigating obstacles. We may add active enemies, maybe even PvE pogo. We'll see.

Graphics: Low-poly toon/cel shaded, aiming for a funny/toy-like look. Fog to help gauge depth. Blob shadow for the pogo rider. HUD if needed (ideally environment would be enough cue).
