export function uuidv4() {
  //https://en.wikipedia.org/wiki/Universally_unique_identifier#Version_4_(random)

  //https://stackoverflow.com/questions/105034/create-guid-uuid-in-javascript
  //https://gist.github.com/jed/982883
  //return ([1e7]+-1e3+-4e3+-8e3+-1e11)
  //  .replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

  //well that would be a ridiculously obtuse, though perhaps correct, way to do it

  //let's do it in a more readable way
  //the text representation of a v4 UUID is 16 random bytes as 32 hex digits in five groups 8-4-4-4-12
  //xxxxxxxx-xxxx-Mxxx-Nxxx-xxxxxxxxxxxx
  //M is the UUUID version, here 4, and the most significant bits of N indicate the variant, here 10 in binary
  const rnd = crypto.getRandomValues(new Uint8Array(16));
  let i = 0; //array of random bytes and our index into it
  function b2h(b) {
    const s = b.toString(16);
    return s.length < 2 ? '0' + s : s;
  } //byte -> hex str with padding
  function rndHex(n) {
    return rnd.slice(i, (i += n)).reduce((s, b) => s + b2h(b), '');
  } //next n bytes as hex str
  return (
    `${rndHex(4)}-${rndHex(2)}-` +
    `${b2h((rnd[i++] & 0x0f) | 0x40)}${rndHex(1)}-` + //eslint-disable-line no-bitwise
    `${b2h((rnd[i++] & 0x3f) | 0x80)}${rndHex(1)}-` + //eslint-disable-line no-bitwise
    `${rndHex(6)}`
  );
}

export function getURLParameter(name, def) {
  let val = decodeURI(
    window.location.search.replace(
      new RegExp('^(?:.*[&\\?]' + encodeURI(name).replace(/[.+*]/g, '\\$&') + '(?:\\=([^&]*))?)?.*$', 'i'),
      '$1'
    )
  );
  val = val || def;
  return val;
}

export function objEquals(a, b) {
  return Object.keys(a).every(k => a[k] === b[k]);
}

export function vecEquals(a, b) {
  for (const f of 'xyz') if (parseFloat(a[f]) !== parseFloat(b[f])) return false;
  return true;
}

export function quatEquals(a, b) {
  for (const f of 'xyzw') if (parseFloat(a[f]) !== parseFloat(b[f])) return false;
  return true;
}

// this only works if you run chrome with --enable-precise-memory-info
export function getHeapSize() {
  const wpm = window.performance ? window.performance.memory : null;
  if (!wpm || isNaN(wpm.usedJSHeapSize)) return null;
  const uhs = wpm.usedJSHeapSize / (1024 * 1024);
  let ret = `${Math.round(uhs)}M`;
  if (!isNaN(wpm.jsHeapSizeLimit)) {
    const hsl = wpm.jsHeapSizeLimit / (1024 * 1024);
    ret += `, ${Math.round(100 * (uhs / hsl))}%`;
  }
  return ret;
}

let advisedMemoryInfo = false;
export function printMemory(prefix) {
  let msg = prefix || '';
  const hs = getHeapSize();
  if (hs) {
    if (msg) msg += ', ';
    msg += `memory: ${hs}`;
  } else if (!advisedMemoryInfo) {
    if (msg) msg += ', ';
    msg += '(heap size info not available, run Chrome with --enable-precise-memory-info)';
    advisedMemoryInfo = true;
  }
  console.log(msg);
}

// 235 -> '235'
// 1368 -> '1.4k'
// 2389422 -> '2.4M'
// 2389422355 -> '2.4G'
// 1, 'tri' -> '1 tri'
// 2, 'tri' -> '2 tris'
// 1368, 'tri' -> '1.4k tris'
// 1368, 'tri', 1300 -> '1.4k tris'
// 1368, 'tri', 1400 -> '1.3k tris'
//
// the idea of the optional thresh argument is that the returned rounded value
// should have the same ordinal relationship to thresh as the passed value n
export function fmtKMG(n, label, thresh) {
  n = Math.abs(n);

  let sca = 1,
    dec = 1,
    sfx = '';
  if (n < 1e3) {
    sca = 1;
    dec = 0;
    sfx = '';
  } else if (n < 1e6) {
    sca = 1e-3;
    dec = 1;
    sfx = 'k';
  } else if (n < 1e9) {
    sca = 1e-6;
    dec = 1;
    sfx = 'M';
  } else {
    sca = 1e-9;
    dec = 1;
    sfx = 'G';
  }
  let s = (n * sca).toFixed(dec);

  const roundString = (str, thr) => {
    let nn = (parseFloat(str) * 1) / sca;
    if (Number.isInteger(n) && Number.isInteger(thr)) nn = Math.round(nn);
    if (nn < thr && n >= thr) nn += Math.pow(10, -dec) / sca;
    else if (nn > thr && n <= thr) nn -= Math.pow(10, -dec) / sca;
    if (nn !== n) str = (nn * sca).toFixed(dec);
    return str;
  };

  if (thresh instanceof Array) for (const t of thresh) s = roundString(s, t);
  else if (!isNaN(thresh)) s = roundString(s, thresh);

  s += sfx;
  if (label) s += ` ${label}${n !== 1 ? 's' : ''}`;
  return s;
}

//this is a little helper to use with fetch() that parses json and also converts !res.ok into an exception, e.g.
//
// fetch(venueURL, { credentials: 'same-origin' })
//   .then(ps.parseJSON('venue'))
//   .then(venue => { ... })
//   .catch(err => { console.log(err.message); })
export function parseJSON(what) {
  return res => {
    if (!res.ok) throw new Error(`error fetching${what ? ' ' + what : ''}: ${res.status} (${res.statusText})`);
    try {
      return res.json();
    } catch (err) {
      throw new Error(`error parsing ${what ? what + ' as ' : ''}JSON`);
    }
  };
}

export function isSet(v) {
  return v !== undefined && v !== null;
} //deal with fields that can be e.g. 0 or false
export function isNum(v) {
  return isSet(v) && !isNaN(v);
}
export function parseBool(v) {
  return v === 'true' || v === true;
}

/**
 * https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/round#Decimal_rounding
 * Decimal adjustment of a number.
 *
 * @param {String}  type  The type of adjustment.
 * @param {Number}  value The number.
 * @param {Integer} exp   The exponent (the 10 logarithm of the adjustment base).
 * @returns {Number} The adjusted value.
 */
export function decimalAdjust(type, value, exp) {
  // If the exp is undefined or zero...
  if (typeof exp === 'undefined' || +exp === 0) {
    return Math[type](value);
  }
  value = +value;
  exp = +exp;
  // If the value is not a number or the exp is not an integer...
  if (isNaN(value) || !(typeof exp === 'number' && exp % 1 === 0)) {
    return NaN;
  }
  // If the value is negative...
  if (value < 0) {
    return -decimalAdjust(type, -value, exp);
  }
  // Shift
  value = value.toString().split('e');
  value = Math[type](+(value[0] + 'e' + (value[1] ? +value[1] - exp : -exp)));
  // Shift back
  value = value.toString().split('e');
  return +(value[0] + 'e' + (value[1] ? +value[1] + exp : exp));
}

export function round10(value, exp) {
  return decimalAdjust('round', value, exp);
}
export function floor10(value, exp) {
  return decimalAdjust('floor', value, exp);
}
export function ceil10(value, exp) {
  return decimalAdjust('ceil', value, exp);
}

export function roundVec(v, exp) {
  for (const f of 'xyz') v[f] = round10(v[f], exp);
  return v;
}

export function toDeg(r) {
  return (r * 180) / Math.PI;
}

export function toRad(r) {
  return (r * Math.PI) / 180;
}

export function xyzToQuat(roll, pitch, yaw) {
  //https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles#Source_Code
  roll = toRad(roll);
  pitch = toRad(pitch);
  yaw = toRad(yaw);
  const t0 = Math.cos(-yaw * 0.5);
  const t1 = Math.sin(-yaw * 0.5);
  const t2 = Math.cos(-roll * 0.5);
  const t3 = Math.sin(-roll * 0.5);
  const t4 = Math.cos(-pitch * 0.5);
  const t5 = Math.sin(-pitch * 0.5);
  return {
    w: t0 * t2 * t4 + t1 * t3 * t5,
    x: t0 * t3 * t4 - t1 * t2 * t5,
    y: t0 * t2 * t5 + t1 * t3 * t4,
    z: t1 * t2 * t4 - t0 * t3 * t5,
  };
}

// it would be nice if quatToXyz(xyzToQuat(x, y, z)) = x, y, z in all cases
// unfortunately this seems impossible to attain because
// (a) in gimbal lock situations there is a continuous infinity of equivalent outputs from quatToXyz()
// (b) there is always a discrete infinity of equivalent outputs from quatToXyz() by adding multiples of +/-360
//     (and even if we define a canonical output range, we can't restrict the input range of xyzToQuat())
export function quatToXyz(w, x, y, z) {
  let roll = 0,
    pitch = 0,
    yaw = 0;

  //https://en.wikipedia.org/wiki/Conversion_between_quaternions_and_Euler_angles#Source_Code_2

  let sinp = -2 * (z * x - w * y);
  sinp = Math.min(Math.max(sinp, -1), 1);
  pitch = Math.asin(sinp); //theta

  const eps = 1e-10;

  //sin(a+b) = sin(a)cos(b)+cos(a)sin(b)
  //sin(a-b) = sin(a)cos(b)-cos(a)sin(b)
  //cos(a+b) = cos(a)cos(b)-sin(a)sin(b)
  //cos(a-b) = cos(a)cos(b)+sin(a)sin(b)

  if (sinp > 1 - eps) {
    //gimbal lock: pitch = 90 singularity
    pitch = 0.5 * Math.PI;
    roll = 0; //the constraint here is on the difference roll-yaw, so pick roll = 0 and compute yaw
    yaw = -Math.atan2(2 * (x * y - w * z), 1 - 2 * (x * x + z * z)); //roll-yaw = atan2(...) => yaw = -atan2(...)
  } else if (sinp < -(1 - eps)) {
    //gimbal lock: pitch = -90 singularity
    pitch = -0.5 * Math.PI;
    roll = 0; //the constraint here is on the sum roll+yaw, so pick roll = 0 and compute yaw
    yaw = Math.atan2(-2 * (y * z - w * x), 1 - 2 * (x * x + z * z)); //roll+yaw = atan2(...) => yaw = atan2(...)
  } else {
    //normal non-gimbal lock case
    roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)); //phi
    yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); //psi
  }

  if (Math.abs(roll - Math.PI) < 1e-6) roll = -Math.PI;
  if (Math.abs(pitch - Math.PI) < 1e-6) pitch = -Math.PI;
  if (Math.abs(yaw - Math.PI) < 1e-6) yaw = -Math.PI;

  const eps2 = 0.003;
  if (Math.PI - Math.abs(pitch) < eps2 && Math.PI - Math.abs(roll) < eps2 && Math.PI - Math.abs(yaw) < eps2) {
    roll = pitch = yaw = 0;
  }

  if (Math.abs(pitch + 0.5 * Math.PI) < eps2 && Math.abs(roll + yaw) < eps2) {
    roll = yaw = 0;
  }

  if (Math.abs(pitch - 0.5 * Math.PI) < eps2 && Math.abs(roll - yaw) < eps2) {
    roll = yaw = 0;
  }

  if (Math.abs(roll + Math.PI) < eps2 && Math.abs(yaw + Math.PI) < eps2) {
    roll = yaw = 0;
    if (Math.abs(pitch) < eps2) {
      pitch = -Math.PI;
    } else if (pitch > 0) {
      pitch = Math.PI - pitch;
    } else {
      pitch = -Math.PI - pitch;
    }
  }

  return { x: -toDeg(roll), y: -toDeg(pitch), z: -toDeg(yaw) };
}

export function safeQuatToXyz(q) {
  if (q === undefined) return { x: 0, y: 0, z: 0 };
  return quatToXyz(q.w, q.x, q.y, q.z);
}

// testXYZ() tests all integer combinations of roll, pitch, yaw from -180 to 180 (total 47045881 tests)
// testXYZ(3, 5, 7) tests roll=3, pitch=5, yaw=7
// testXYZ(3, NaN, 7) tests roll=3, pitch=-180,...,180, yaw=7
// testXYZ(NaN, NaN, 7) tests roll=-180,...,180, pitch=-180,...,180, yaw=7
// testXYZ({ min: -5, max: 5 }, NaN, 7) tests roll=-5,...,5, pitch=-180,...,180, yaw=7
// etc
export function testXYZ(roll, pitch, yaw) {
  // eslint-disable-line no-unused-vars
  const eps = 0.05;

  const diff = (w0, x0, y0, z0, w1, x1, y1, z1) =>
    (Math.abs(w1 - w0) > eps || Math.abs(x1 - x0) > eps || Math.abs(y1 - y0) > eps || Math.abs(z1 - z0) > eps) &&
    (Math.abs(w1 + w0) > eps || Math.abs(x1 + x0) > eps || Math.abs(y1 + y0) > eps || Math.abs(z1 + z0) > eps);

  const range = t => {
    if (!isNaN(t)) return [t];
    if (t instanceof Array) return t;
    const ret = [];
    const min = t && !isNaN(t.min) ? t.min : -180;
    const max = t && !isNaN(t.max) ? t.max : 180;
    for (let i = min; i <= max; i++) ret.push(i);
    return ret;
  };
  const rr = range(roll);
  const rp = range(pitch);
  const ry = range(yaw);
  const nt = rr.length * rp.length * ry.length;
  const logAll = nt < 100;
  let np = 0;
  let nf = 0;
  const test = (r0, p0, y0) => {
    const { w: qw0, x: qx0, y: qy0, z: qz0 } = xyzToQuat(r0, p0, y0);
    const { x: r1, y: p1, z: y1 } = quatToXyz(qw0, qx0, qy0, qz0);
    const { w: qw1, x: qx1, y: qy1, z: qz1 } = xyzToQuat(r1, p1, y1);
    const log = msg => {
      if (msg) console.log(msg);
      const rnd = v => Math.round10(v, -3);
      console.log(`rpy: ${rnd(r0)}, ${rnd(p0)}, ${rnd(y0)} -> ${rnd(qw0)}, ${rnd(qx0)}, ${rnd(qy0)}, ${rnd(qz0)}`);
      console.log(`-> ${rnd(r1)}, ${rnd(p1)}, ${rnd(y1)} -> ${rnd(qw1)}, ${rnd(qx1)}, ${rnd(qy1)}, ${rnd(qz1)}`);
    };
    // compare the quats because it's easier to handle the multiple representations problem
    // i.e. q0 = q1 and q0 = -q1 are both OK
    if (diff(qw0, qx0, qy0, qz0, qw1, qx1, qy1, qz1)) {
      log('test failed');
      ++nf;
      return false;
    }
    //if (Math.abs(r1-r0) > eps || Math.abs(p1-p0) > eps || Math.abs(y1-y0) > eps)
    //  { log('rpy differ'); ++nf; return false; }
    ++np;
    if (logAll) log();
    return true;
  };

  console.log(`running ${nt} tests...`);
  try {
    for (const r of rr)
      for (const p of rp) for (const y of ry) if (!test(r, p, y) || nf >= 100) throw new Error('done');
  } catch (e) {
    if (e !== 'done') console.log(e);
  }

  console.log(`passed ${np} tests, failed ${nf}`);
}

/*
 * Flattens a tree like this:
 *
 * {
 *     root: {
 *         val: 'a',
 *         children: [
 *             {
 *                 id: 1, val: 'b', children: [
 *                     { id: 2, val: 'c', children: [] },
 *                 ],
 *             },
 *             { id: 3, val: 'd', children: [] },
 *         ],
 *     },
 * }
 *
 * Into this:
 *
 * {
 *     "1": { id: 1, val: "b", children: [2] },
 *     "2": { id: 2, val: "c", children: [] },
 *     "3": { id: 3, val: "d", children: [] },
 *     "root": { id: "root", val: "a", children: [1, 3 ] }
 * }
 */
export function flattenNodes(model) {
  const ids = Object.keys(model);
  let flatModel = {};

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    flatModel[id] = {
      id: model[id].id,
      name: model[id].name,
      children: model[id].children.map(child => child.id),
      parent: model[id].cached.parent ? model[id].cached.parent.id : null,
      type: model[id].type,
      cached: {
        depth: model[id].cached.depth,
        visibleInTree: model[id].cached.visibleInTree,
        enabledTrianglesInTree: model[id].cached.enabledTrianglesInTree,
        trianglesInTree: model[id].cached.trianglesInTree,
        enabled: model[id].cached.enabled,
        enabledInTree: model[id].cached.enabledInTree,
        indexInSiblings: model[id].cached.indexInSiblings,
      },
    };
  }

  return flatModel;
}

//return if user has exactly one node selected
export function validateNodeSelection(nodeId, model) {
  if (!nodeId || !model) return false;
  const node = nodeId.map(n => parseInt(n));
  if (node.length != 1) return false;
  return true;
}
