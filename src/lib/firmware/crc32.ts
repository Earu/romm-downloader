/** Standard CRC32 (IEEE), dependency-free — used to confirm a downloaded firmware
 *  file matches what RomM stored (RomM exposes each file's crc_hash). */
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of a buffer as 8 lowercase hex chars. */
export function crc32Hex(buf: Buffer): string {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}
