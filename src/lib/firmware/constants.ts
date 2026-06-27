import { join } from "node:path";

/** Local cache for downloaded firmware packs (mirrors the Minerva index dir). */
export const FIRMWARE_DIR = process.env.FIRMWARE_DIR ?? join(process.cwd(), "data", "firmware");

/** RetroBIOS — a curated, checksum-verified BIOS/firmware collection with a RomM
 *  release asset laid out as `bios/<romm_fs_slug>/<file>`. */
export const RETROBIOS_RELEASES_API =
  "https://api.github.com/repos/Abdess/retrobios/releases/latest";
/** The release asset we want: the RomM-platform-organised pack. */
export const RETROBIOS_ASSET_RE = /romm.*platform_bios_pack\.zip$/i;

export const RETROBIOS_PACK_PATH = join(FIRMWARE_DIR, "retrobios-romm-pack.zip");
export const RETROBIOS_META_PATH = join(FIRMWARE_DIR, "retrobios.json");

/** PS3 system software (PS3UPDAT.PUP) — sourced from Sony's official update list,
 *  which carries the current version + CDN URL in a stable machine-readable form. */
export const PS3_UPDATELIST_URL =
  "http://fus01.ps3.update.playstation.net/update/ps3/list/us/ps3-updatelist.txt";
export const PS3_PUP_PATH = join(FIRMWARE_DIR, "PS3UPDAT.PUP");
export const PS3_META_PATH = join(FIRMWARE_DIR, "ps3.json");

/** Switch system firmware (NX_Firmware) — per-version GitHub releases of the
 *  firmware, plus the repo's prod.keys (the master keys are identical across all
 *  retail consoles; needed by Ryujinx/Yuzu alongside the firmware). */
export const NX_RELEASES_API = "https://api.github.com/repos/THZoria/NX_Firmware/releases/latest";
export const NX_FIRMWARE_ASSET_RE = /^firmware[._].*\.zip$/i;
export const NX_PRODKEYS_API =
  "https://api.github.com/repos/THZoria/NX_Firmware/contents/prod.keys";
export const SWITCH_DIR = join(FIRMWARE_DIR, "switch");
export const SWITCH_FW_PATH = join(SWITCH_DIR, "firmware.zip");
export const SWITCH_KEYS_PATH = join(SWITCH_DIR, "prod.keys");
export const SWITCH_META_PATH = join(FIRMWARE_DIR, "switch.json");

/** Re-check the upstream release if the cache is older than this. */
export const FIRMWARE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // ~1 month
