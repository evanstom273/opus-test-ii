// OpenSimplex2 (2D), plus fBm and ridged multifractal built on it.
//
// The lattice, skew and kernel follow K.jpg's OpenSimplex2 (public domain /
// CC0), using 32-bit integer hashing (as in FastNoiseLite) since JavaScript
// has no fast 64-bit multiply. Output is roughly in [-1, 1].

const PRIME_X = 501125321;
const PRIME_Y = 1136930381;
const SKEW = 0.5 * (Math.sqrt(3) - 1);       // F2
const UNSKEW = (3 - Math.sqrt(3)) / 6;       // G2
const NORMALIZER = 99.83685446303647;

// OpenSimplex2's 24 evenly spread unit gradients, repeated to fill 128 slots.
const GRAD24 = [
  0.38268343236509, 0.923879532511287, 0.923879532511287, 0.38268343236509,
  0.923879532511287, -0.38268343236509, 0.38268343236509, -0.923879532511287,
  -0.38268343236509, -0.923879532511287, -0.923879532511287, -0.38268343236509,
  -0.923879532511287, 0.38268343236509, -0.38268343236509, 0.923879532511287,
  0.130526192220052, 0.99144486137381, 0.608761429008721, 0.793353340291235,
  0.793353340291235, 0.608761429008721, 0.99144486137381, 0.130526192220051,
  0.99144486137381, -0.130526192220051, 0.793353340291235, -0.60876142900872,
  0.608761429008721, -0.793353340291235, 0.130526192220052, -0.99144486137381,
  -0.130526192220052, -0.99144486137381, -0.608761429008721, -0.793353340291235,
  -0.793353340291235, -0.608761429008721, -0.99144486137381, -0.130526192220052,
  -0.99144486137381, 0.130526192220051, -0.793353340291235, 0.608761429008721,
  -0.608761429008721, 0.793353340291235, -0.130526192220052, 0.99144486137381,
];
const GRAD = new Float64Array(256);
for (let i = 0; i < 256; i++) GRAD[i] = GRAD24[i % GRAD24.length];

function gradDot(seed, xPrimed, yPrimed, dx, dy) {
  let hash = seed ^ xPrimed ^ yPrimed;
  hash = Math.imul(hash, 0x27d4eb2d);
  hash ^= hash >> 15;
  hash &= 127 << 1;
  return GRAD[hash] * dx + GRAD[hash | 1] * dy;
}

export function openSimplex2(seed, x, y) {
  // Skew onto the simplex lattice.
  const s = (x + y) * SKEW;
  x += s;
  y += s;
  let i = Math.floor(x), j = Math.floor(y);
  const xi = x - i, yi = y - j;
  const t = (xi + yi) * UNSKEW;
  const x0 = xi - t, y0 = yi - t;
  i = Math.imul(i, PRIME_X);
  j = Math.imul(j, PRIME_Y);

  let n = 0;
  const a = 0.5 - x0 * x0 - y0 * y0;
  if (a > 0) n += a * a * (a * a) * gradDot(seed, i, j, x0, y0);

  const c = 2 * (1 - 2 * UNSKEW) * (1 / UNSKEW - 2) * t + (-2 * (1 - 2 * UNSKEW) * (1 - 2 * UNSKEW) + a);
  if (c > 0) {
    const x2 = x0 + (2 * UNSKEW - 1), y2 = y0 + (2 * UNSKEW - 1);
    n += c * c * (c * c) * gradDot(seed, (i + PRIME_X) | 0, (j + PRIME_Y) | 0, x2, y2);
  }

  if (y0 > x0) {
    const x1 = x0 + UNSKEW, y1 = y0 + (UNSKEW - 1);
    const b = 0.5 - x1 * x1 - y1 * y1;
    if (b > 0) n += b * b * (b * b) * gradDot(seed, i, (j + PRIME_Y) | 0, x1, y1);
  } else {
    const x1 = x0 + (UNSKEW - 1), y1 = y0 + UNSKEW;
    const b = 0.5 - x1 * x1 - y1 * y1;
    if (b > 0) n += b * b * (b * b) * gradDot(seed, (i + PRIME_X) | 0, j, x1, y1);
  }
  return n * NORMALIZER;
}

// Fractional Brownian motion: octaves of noise at doubling frequency and
// halving amplitude. Normalised back to roughly [-1, 1].
export function fbm(seed, x, y, octaves, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * openSimplex2((seed + o * 1013) | 0, x, y);
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}

// Ridged multifractal (after Musgrave): folding each octave with 1 - |n|
// turns zero crossings into sharp crests, and weighting each octave by the
// previous one keeps detail on the ridges and smooth floors in the valleys.
// Returns roughly [0, 1].
export function ridged(seed, x, y, octaves, lacunarity = 2, gain = 0.5) {
  let sum = 0, amp = 1, norm = 0, weight = 1;
  for (let o = 0; o < octaves; o++) {
    let n = 1 - Math.abs(openSimplex2((seed + o * 7919) | 0, x, y));
    n *= n;
    n *= weight;
    weight = Math.min(1, Math.max(0, n * 2));
    sum += n * amp;
    norm += amp;
    amp *= gain;
    x *= lacunarity;
    y *= lacunarity;
  }
  return sum / norm;
}
