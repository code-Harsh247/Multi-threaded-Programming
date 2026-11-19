// All the pixel art. Each sprite is a grid of characters; every character maps
// to a palette colour ('.' is transparent). Sprites are drawn once into small
// offscreen canvases and reused every frame.

export const C = {
  waterDeep: '#3380cc', water: '#3b8bd6', waterLight: '#69b4ee', waterShadow: '#2a5f9f', sparkle: '#e6f7ff',
  sand: '#ecd49c', sandDark: '#cfae6c',
  grass: '#6cc04a', grassDark: '#4f9e3b', grassLight: '#96da69',
  leafOutline: '#1f5f2a', leaf: '#3c9c40', leafLight: '#66c457', leafShade: '#2e7f35',
  trunk: '#7b4b2a', trunkDark: '#57341d',
  wood: '#c48a53', woodLight: '#dca86d', woodDark: '#8d5c33', woodDeep: '#5c3a1f',
  path: '#e4c68e', pathDark: '#c6a468',
  stone: '#c3bfcb', stoneDark: '#8f8a9e', stoneLight: '#e2dfe8',
  rope: '#8a5a2e', cream: '#fff4da', ink: '#3a2a1c',
  flag: '#e84a5f', lampGlow: '#fff3b0', lampGlass: '#f2c94c', iron: '#3d3d4d',
  duck: '#fbfbf6', duckShade: '#d9d6c8', beak: '#ff9f1c', eye: '#222222',
  soil: '#8a5a3a', soilDark: '#6d4529',
  flowers: ['#ff5d73', '#ffd23f', '#ff9ed2', '#b388ff', '#ffffff', '#ff8a3d'],
};

export const SKINS = ['#f6d1b0', '#e9b48a', '#c98b5e', '#9a6440', '#6e4428'];
export const HAIRS = ['#2b1d14', '#5a3a22', '#a5662c', '#e3c16f', '#d9d9d9', '#7a2e2e', '#1d1d2b'];
export const SHIRTS = ['#e84a5f', '#2f80ed', '#ffb703', '#8e44ad', '#16a085', '#ff7f50',
                       '#f4f4f4', '#27ae60', '#e91e63', '#00b8d4'];
export const PANTS = ['#2c3e50', '#34495e', '#5d4037', '#1e3a5f', '#4a4a4a'];
// [hull, hull shade] per boat
export const HULLS = [
  ['#e74c3c', '#a93226'], ['#f1c40f', '#b7950b'], ['#1abc9c', '#11806a'], ['#e67e22', '#a85b17'],
  ['#3498db', '#21618c'], ['#9b59b6', '#6c3483'], ['#ff6f91', '#c2456a'], ['#2ecc71', '#1e8449'],
];

function build(rows, colors, flip = false) {
  const h = rows.length;
  const w = rows[0].length;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  for (let y = 0; y < h; y++) {
    if (rows[y].length !== w) throw new Error(`sprite row ${y} is ${rows[y].length} wide, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = rows[y][flip ? w - 1 - x : x];
      if (ch === '.') continue;
      const color = colors[ch];
      if (!color) throw new Error(`no colour for '${ch}'`);
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas;
}

// ---------------------------------------------------------------- people --
// 5x8. H hair, K skin, S shirt, P trousers.
const PERSON_TOP = ['.HHH.', 'HKKKH', '.KKK.', 'SSSSS', 'KSSSK', '.SSS.'];
const PERSON_FRAMES = {
  stand: [...PERSON_TOP, '.P.P.', '.P.P.'],
  walkA: [...PERSON_TOP, '.P.P.', '.P...'],
  walkB: [...PERSON_TOP, '.P.P.', '...P.'],
};

// A visitor's look is picked from their id, so it stays the same all run.
export function lookFor(id) {
  let h = (id * 2654435761) >>> 0;
  const pick = (arr) => { const v = arr[h % arr.length]; h = Math.floor(h / arr.length) ^ (h >>> 7); return v; };
  return { skin: pick(SKINS), hair: pick(HAIRS), shirt: pick(SHIRTS), pants: pick(PANTS) };
}

const personCache = new Map();
export function personSprites(look) {
  const key = `${look.skin}${look.hair}${look.shirt}${look.pants}`;
  let s = personCache.get(key);
  if (!s) {
    const colors = { H: look.hair, K: look.skin, S: look.shirt, P: look.pants };
    s = {
      stand: build(PERSON_FRAMES.stand, colors),
      walkA: build(PERSON_FRAMES.walkA, colors),
      walkB: build(PERSON_FRAMES.walkB, colors),
    };
    personCache.set(key, s);
  }
  return s;
}

// ----------------------------------------------------------------- boats --
// 18x7 rowboat seen from the side, bow on the right.
// R rim, I inside, W seat, B hull, S stripe, D hull shade.
export const BOAT_W = 18;
export const BOAT_H = 7;
const BOAT = [
  '.................R',
  'RIIIIIIWWWIIIIIIRR',
  'RRRRRRRRRRRRRRRRRR',
  'BBBBBBBBBBBBBBBBB.',
  'SSSSSSSSSSSSSSSS..',
  '.BBBBBBBBBBBBBB...',
  '..DDDDDDDDDDDD....',
];

const boatCache = new Map();
export function boatSprites(id) {
  let s = boatCache.get(id);
  if (!s) {
    const [hull, shade] = HULLS[(id - 1) % HULLS.length];
    const colors = { R: C.cream, I: C.woodDark, W: C.woodLight, B: hull, S: C.cream, D: shade };
    s = { right: build(BOAT, colors), left: build(BOAT, colors, true) };
    boatCache.set(id, s);
  }
  return s;
}

// ----------------------------------------------------------------- props --
const TREE = [
  '....ggggg....',
  '..ggGGGGGgg..',
  '.gGGLLGGGGGg.',
  '.gGLLLGGGGGg.',
  'gGGLLGGGGGGGg',
  'gGGGGGGGGGGDg',
  'gGGGGGGGGGDDg',
  '.gGGGGGGGDDg.',
  '.ggGGGGGDDgg.',
  '...gggggggg..',
  '......tT.....',
  '......tT.....',
  '.....ttTT....',
];
const SMALL_TREE = [
  '..ggggg..',
  '.gGGLGGg.',
  'gGGLLGGGg',
  'gGGGGGGDg',
  'gGGGGGDDg',
  '.gGGGDDg.',
  '..ggggg..',
  '....t....',
  '....t....',
];
const BUSH = [
  '..gggg...',
  '.gGLGGg..',
  'gGGGGGGg.',
  'gGGGGDDgg',
  '.ggggggg.',
];
const BENCH = [
  'WWWWWWWWWW',
  'wwwwwwwwww',
  '..........',
  'WWWWWWWWWW',
  'wwwwwwwwww',
  'd.d....d.d',
];
const LAMP = [
  'YYY', 'yYy', '.k.', '.k.', '.k.', '.k.', '.k.', '.k.', '.k.', '.k.', '.k.', 'kkk',
];
const DUCK = [
  '....ww.',
  '....wkY',
  'wwwwww.',
  'wsssww.',
  '.wwww..',
];

const leafColors = { g: C.leafOutline, G: C.leaf, L: C.leafLight, D: C.leafShade, t: C.trunk, T: C.trunkDark };

let props = null;
export function propSprites() {
  if (!props) {
    props = {
      tree: build(TREE, leafColors),
      smallTree: build(SMALL_TREE, leafColors),
      bush: build(BUSH, leafColors),
      bench: build(BENCH, { W: C.woodLight, w: C.woodDark, d: C.woodDeep }),
      lamp: build(LAMP, { Y: C.lampGlow, y: C.lampGlass, k: C.iron }),
      duckRight: build(DUCK, { w: C.duck, s: C.duckShade, k: C.eye, Y: C.beak }),
      duckLeft: build(DUCK, { w: C.duck, s: C.duckShade, k: C.eye, Y: C.beak }, true),
    };
  }
  return props;
}
