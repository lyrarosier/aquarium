# aquarium game (p3) 
# group id: 4150

interactive aquarium management game built with three.js. runs fully in browser. player grows fish, manages space, earns coins, decorates tank. supports live visual swapping between prototype primitives and full 3d models without resetting state.

## controls

* shop button opens floating buy and sell panel
* feed button toggles feeding mode. click water to drop flakes
* clicking empty water does nothing unless feed mode active
* drag decor after it lands to reposition on sand
* bottom-left toggle switches prototype mode and full mode

## gameplay loop

* game starts with coins
* buying egg spawns egg in water
* egg sinks, settles into sand, incubates over time
* egg hatches into baby fish
* fish swims, grows smoothly over time
* once adult, fish appears in sell tab
* selling fish removes instance from tank and grants coins
* feeding creates flakes that fall and attract fish

## fish behaviour

* all fish constrained inside aquarium walls
* hard ceiling clamp prevents fish touching water surface
* sand line acts as lower movement boundary
* per-type swim logic

  * common fish uses simple left-right patrol
  * schooling fish shares leader target with soft flocking
  * tropical fish prefers mid-water band
  * reef fish swims slower and closer to decor
  * ornamental fish swims gently with reduced speed
  * deep sea creature stays near sand line
  * mythical fish moves slower and feels heavier
* fish always rendered in front of sand layer

## decor behaviour

* decor purchased from shop
* decor spawns in water and falls naturally
* decor lands slightly embedded in sand
* decor draggable only after landing
* decor constrained to sand region
* prototype decor uses blob shapes matched to shop thumbnails
* full mode decor loads glb models

## visual modes

* prototype mode uses flat primitives and blob visuals
* full mode uses imported glb models
* eggs, fish, decor all support live mode switching
* toggling mode preserves position, velocity, growth, and state
* shop thumbnails rebuild automatically on mode change

## technical notes

* orthographic camera sized to world bounds
* aquarium frame defines innerLeft, innerRight, innerTop, innerBottom
* per-object bounds sync on resize
* growth handled via eased interpolation
* no lights required. uses meshbasicmaterial for consistency
* render order forces fish and decor in front of sand

## libraries

* three.js via import maps
* gltfloader for model loading

## asset attribution

### fish

* turtle.glb
  "ridley turtle (Lepidochelys olivacea)" by lucas B.
  [https://skfb.ly/pyvWD](https://skfb.ly/pyvWD)
  licensed under creative commons attribution-sharealike 4.0
  [http://creativecommons.org/licenses/by-sa/4.0/](http://creativecommons.org/licenses/by-sa/4.0/)

* shark.glb
  "PS1/Low Poly Great White Shark" by Jellypack
  [https://skfb.ly/oRVPQ](https://skfb.ly/oRVPQ)
  licensed under creative commons attribution-noncommercial 4.0
  [http://creativecommons.org/licenses/by-nc/4.0/](http://creativecommons.org/licenses/by-nc/4.0/)

* sailfish.glb
  "Sail-fishy" by Lary
  [https://skfb.ly/6UI9R](https://skfb.ly/6UI9R)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* koi.glb
  "animated low-poly koi fish" by FlanCasero
  [https://skfb.ly/oDDro](https://skfb.ly/oDDro)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* anglerfish.glb
  "Angler Fish - Inktober Day 3" by lesliestowe
  [https://skfb.ly/6XIyG](https://skfb.ly/6XIyG)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* fish2.glb, nemo.glb, octo.glb, bass.glb, dory.glb, carp.glb
  models by rkuhl
  [https://www.cgtrader.com/designers/rkuhl?utm_source=credit](https://www.cgtrader.com/designers/rkuhl?utm_source=credit)

### decor

* rock.glb
  "Stone with moss" by pirx7
  [https://skfb.ly/otLrR](https://skfb.ly/otLrR)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* shell.glb
  "Sea shell" by blenderboom
  [https://skfb.ly/6RVQL](https://skfb.ly/6RVQL)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* log.glb
  "Log" by boordom
  [https://skfb.ly/MxrP](https://skfb.ly/MxrP)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* seaweed.glb
  "Seaweed (M)" by Yiğit Uslu
  [https://skfb.ly/ospVE](https://skfb.ly/ospVE)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* coral.glb
  "Coral" by Yiğit Uslu
  [https://skfb.ly/osxoA](https://skfb.ly/osxoA)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)

* sandcastle.glb
  "Big Sand Castle - Low Poly" by Styro
  [https://skfb.ly/ouZSP](https://skfb.ly/ouZSP)
  licensed under creative commons attribution 4.0
  [http://creativecommons.org/licenses/by/4.0/](http://creativecommons.org/licenses/by/4.0/)
