// From https://github.com/McSimp/lzfjs/
/**
 * LZF compression/decompression module. Ported from the C
 * implementation of liblzf, specfically lzf_c.c and lzf_d.c
 * @license BSD-2-Clause
 */

'use strict';

/**
 * Decompress a TypedArray (in browser) or Buffer (in node)
 * containing LZF compressed data.
 * @param {(ArrayBuffer|TypedArray|Buffer)} data - the data to be decompressed
 * @returns {(ArrayBuffer|Buffer)} - decompressed data
 */
function decompress(data) {
  var input = new Uint8Array(data);
  var output = [];

  var ip = 0;
  var op = 0;

  do {
    var ctrl = input[ip++];

    if (ctrl < 1 << 5) {
      /* literal run */
      ctrl++;

      if (ip + ctrl > input.length) {
        throw new Error('Invalid input');
      }

      while (ctrl--) {
        output[op++] = input[ip++];
      }
    } else {
      /* back reference */
      var len = ctrl >> 5;
      var ref = op - ((ctrl & 0x1f) << 8) - 1;

      if (ip >= input.length) {
        throw new Error('Invalid input');
      }

      if (len == 7) {
        len += input[ip++];

        if (ip >= input.length) {
          throw new Error('Invalid input');
        }
      }

      ref -= input[ip++];

      if (ref < 0) {
        throw new Error('Invalid input');
      }

      len += 2;

      do {
        output[op++] = output[ref++];
      } while (--len);
    }
  } while (ip < input.length);

  // Return a Buffer if it exists (say in node), otherwise just
  // use a normal Uint8Array.
  if (typeof Buffer !== 'undefined') {
    return new Buffer(output);
  } else {
    var res = new Uint8Array(output.length);
    res.set(output);
    return res.buffer;
  }
}

/**
 * Compress a buffer containing some data
 * @param {(ArrayBuffer|TypedArray|Buffer)} data - the data to be compressed
 * @returns {(ArrayBuffer|Buffer)} - compressed data
 */
function compress(data) {
  var HLOG = 16;
  var HSIZE = 1 << HLOG;
  var LZF_MAX_OFF = 1 << 13;
  var LZF_MAX_REF = (1 << 8) + (1 << 3);
  var LZF_MAX_LIT = 1 << 5;

  function FRST(data, p) {
    return (data[p] << 8) | data[p + 1];
  }

  function NEXT(v, data, p) {
    return (v << 8) | data[p + 2];
  }

  function IDX(h) {
    return ((h * 0x1e35a7bd) >> (32 - HLOG - 8)) & (HSIZE - 1);
  }

  var input = new Uint8Array(data);
  var output = [];
  var htab = new Uint32Array(HSIZE);

  var in_end = input.length,
    ip = 0,
    hval = FRST(input, ip);
  var op = 1,
    lit = 0; /* start run */

  while (ip < in_end - 2) {
    hval = NEXT(hval, data, ip);
    var hslot = IDX(hval);
    var ref = htab[hslot];
    htab[hslot] = ip;

    var off;

    if (
      ref < ip /* the next test will actually take care of this, but this is faster */ &&
      (off = ip - ref - 1) < LZF_MAX_OFF &&
      ref > 0 &&
      input[ref + 2] == input[ip + 2] &&
      input[ref + 1] == input[ip + 1] &&
      input[ref] == input[ip]
    ) {
      /* match found at *ref++ */
      var len = 2;
      var maxlen = in_end - ip - len;
      maxlen = maxlen > LZF_MAX_REF ? LZF_MAX_REF : maxlen;

      output[op - lit - 1] = (lit - 1) & 255; /* stop run */
      if (lit == 0) {
        op -= 1; /* undo run if length is zero */
      }

      do {
        len++;
      } while (len < maxlen && input[ref + len] == input[ip + len]);

      len -= 2; /* len is now #octets - 1 */
      ip++;

      if (len < 7) {
        output[op++] = ((off >> 8) + (len << 5)) & 255;
      } else {
        output[op++] = ((off >> 8) + (7 << 5)) & 255;
        output[op++] = (len - 7) & 255;
      }

      output[op++] = off & 255;

      lit = 0;
      op++; /* start run */

      ip += len + 1;

      if (ip >= in_end - 2) {
        break;
      }

      --ip;
      --ip;
      hval = FRST(input, ip);

      hval = NEXT(hval, input, ip);
      htab[IDX(hval)] = ip++;

      hval = NEXT(hval, input, ip);
      htab[IDX(hval)] = ip++;
    } else {
      lit++;
      output[op++] = input[ip++];

      if (lit == LZF_MAX_LIT) {
        output[op - lit - 1] = (lit - 1) & 255; /* stop run */
        lit = 0;
        op++; /* start run */
      }
    }
  }

  while (ip < in_end) {
    lit++;
    output[op++] = input[ip++];

    if (lit == LZF_MAX_LIT) {
      output[op - lit - 1] = (lit - 1) & 255; /* stop run */
      lit = 0;
      op++; /* start run */
    }
  }

  if (lit != 0) {
    output[op - lit - 1] = (lit - 1) & 255; /* stop run */
  }

  // Return a Buffer if it exists (say in node), otherwise just
  // use a normal Uint8Array.
  if (typeof Buffer !== 'undefined') {
    return new Buffer(output);
  } else {
    var res = new Uint8Array(output.length);
    res.set(output);
    return res.buffer;
  }
}
if (typeof module !== 'undefined') {
  module.exports = {
    decompress: decompress,
    compress: compress,
  };
} else {
  window.LZF = {
    decompress: decompress,
    compress: compress,
  };
}
