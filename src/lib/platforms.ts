/**
 * Canonical list of ROM platforms. The `slug` is the RomM/IGDB fs_slug used for
 * both the library folder name and the RomM platform identifier.
 */
export interface KnownPlatform {
  slug: string;
  name: string;
}

export const KNOWN_PLATFORMS: KnownPlatform[] = [
  // Nintendo handhelds
  { slug: "gb", name: "Game Boy" },
  { slug: "gbc", name: "Game Boy Color" },
  { slug: "gba", name: "Game Boy Advance" },
  { slug: "nds", name: "Nintendo DS" },
  { slug: "3ds", name: "Nintendo 3DS" },
  { slug: "vb", name: "Virtual Boy" },
  // Nintendo consoles
  { slug: "nes", name: "Nintendo Entertainment System" },
  { slug: "snes", name: "Super Nintendo Entertainment System" },
  { slug: "n64", name: "Nintendo 64" },
  { slug: "gc", name: "GameCube" },
  { slug: "wii", name: "Wii" },
  { slug: "wiiu", name: "Wii U" },
  { slug: "switch", name: "Nintendo Switch" },
  { slug: "fds", name: "Famicom Disk System" },
  { slug: "sfc", name: "Super Famicom" },
  // Sony handhelds
  { slug: "psp", name: "PlayStation Portable" },
  { slug: "psvita", name: "PlayStation Vita" },
  // Sony consoles
  { slug: "ps", name: "PlayStation" },
  { slug: "ps2", name: "PlayStation 2" },
  { slug: "ps3", name: "PlayStation 3" },
  { slug: "ps4", name: "PlayStation 4" },
  { slug: "ps5", name: "PlayStation 5" },
  // Sega handhelds
  { slug: "game-gear", name: "Game Gear" },
  // Sega consoles
  { slug: "sega-master-system", name: "Sega Master System" },
  { slug: "genesis-slash-megadrive", name: "Sega Genesis / Mega Drive" },
  { slug: "sega-cd", name: "Sega CD / Mega-CD" },
  { slug: "32x", name: "Sega 32X" },
  { slug: "saturn", name: "Sega Saturn" },
  { slug: "dreamcast", name: "Dreamcast" },
  { slug: "sg1000", name: "Sega SG-1000" },
  // Microsoft
  { slug: "xbox", name: "Xbox" },
  { slug: "xbox360", name: "Xbox 360" },
  // Atari
  { slug: "atari-2600", name: "Atari 2600" },
  { slug: "atari-5200", name: "Atari 5200" },
  { slug: "atari-7800", name: "Atari 7800" },
  { slug: "atari-lynx", name: "Atari Lynx" },
  { slug: "atari-jaguar", name: "Atari Jaguar" },
  { slug: "atari-st", name: "Atari ST" },
  // NEC
  { slug: "turbografx-16--1", name: "TurboGrafx-16 / PC Engine" },
  { slug: "turbografx-cd", name: "TurboGrafx-CD / PC Engine CD" },
  { slug: "supergrafx", name: "PC Engine SuperGrafx" },
  { slug: "pc-fx", name: "PC-FX" },
  // SNK
  { slug: "neo-geo-aes", name: "Neo Geo AES" },
  { slug: "neo-geo-cd", name: "Neo Geo CD" },
  { slug: "neo-geo-pocket-color", name: "Neo Geo Pocket Color" },
  { slug: "neo-geo-pocket", name: "Neo Geo Pocket" },
  // Computers
  { slug: "msx", name: "MSX" },
  { slug: "msx2", name: "MSX2" },
  { slug: "dos", name: "DOS" },
  { slug: "windows", name: "Windows" },
  { slug: "amiga", name: "Amiga" },
  { slug: "c64", name: "Commodore 64" },
  { slug: "vic-20", name: "Commodore VIC-20" },
  { slug: "zxs", name: "ZX Spectrum" },
  { slug: "apple-ii", name: "Apple II" },
  { slug: "apple-iigs", name: "Apple IIGS" },
  { slug: "mac", name: "Apple Macintosh" },
  { slug: "fm-towns", name: "Fujitsu FM Towns" },
  // Other
  { slug: "arcade", name: "Arcade (MAME)" },
  { slug: "3do", name: "3DO Interactive Multiplayer" },
  { slug: "cdi", name: "Philips CD-i" },
  { slug: "colecovision", name: "ColecoVision" },
  { slug: "intellivision", name: "Intellivision" },
  { slug: "odyssey-2", name: "Magnavox Odyssey 2" },
  { slug: "vectrex", name: "Vectrex" },
  { slug: "wonderswan", name: "WonderSwan" },
  { slug: "wonderswan-color", name: "WonderSwan Color" },
];

/** Map from slug → KnownPlatform for O(1) lookup. */
export const PLATFORM_BY_SLUG = new Map(KNOWN_PLATFORMS.map((p) => [p.slug, p]));
