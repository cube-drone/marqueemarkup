// The default plugin set: everything obvious that needs no network at all.
// Media kinds by extension, YouTube and Spotify by URL shape (their embed
// URLs are derivable, no fetch required). All decline below level=full -
// the plain-link floor is the right "title" for a player.

import { escapeAttr } from "./escape.ts";
import type { TurbolinkPlugin } from "./index.ts";

function extension(target: string): string {
  const path = target.split(/[?#]/, 1)[0]!;
  return path.includes(".") ? path.slice(path.lastIndexOf(".") + 1).toLowerCase() : "";
}

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg"]);
const AUDIO_EXT = new Set(["mp3", "ogg", "wav", "flac", "m4a"]);
const VIDEO_EXT = new Set(["mp4", "webm"]);

// Shared style chunks: plugins that emit the same classes reference the
// same constant, and turbolinkStyles() dedupes by content.

const frameCss = `.mq-turbolink-frame {
  display: block;
  border: 0;
  width: 100%;
  max-width: 32rem;
  border-radius: 0.375rem;
}
.mq-frame-video { aspect-ratio: 16 / 9; }`;

const mediaCss = `.mq-turbolink-image {
  display: block;
  max-width: 20rem;
  max-height: 20rem;
  border-radius: 0.375rem;
}
.mq-turbolink-audio,
.mq-turbolink-video {
  display: block;
  width: 100%;
  max-width: 32rem;
}
.mq-turbolink-video { border-radius: 0.375rem; }`;

export const imagePlugin: TurbolinkPlugin = {
  name: "image",
  css: mediaCss,
  match: (t) => IMAGE_EXT.has(extension(t)),
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    const href = escapeAttr(target);
    return `<a class="mq-turbolink-media" href="${href}"><img class="mq-turbolink-image" src="${href}" alt="" loading="lazy"></a>`;
  },
};

export const audioPlugin: TurbolinkPlugin = {
  name: "audio",
  css: mediaCss,
  match: (t) => AUDIO_EXT.has(extension(t)),
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    return `<audio class="mq-turbolink-audio" controls src="${escapeAttr(target)}"></audio>`;
  },
};

export const videoPlugin: TurbolinkPlugin = {
  name: "video",
  css: mediaCss,
  match: (t) => VIDEO_EXT.has(extension(t)),
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    return `<video class="mq-turbolink-video" controls src="${escapeAttr(target)}"></video>`;
  },
};

const YOUTUBE = /(?:youtube\.com\/watch\?(?:[^#\s]*&)?v=|youtu\.be\/)([A-Za-z0-9_-]{5,20})/;

export const youtubePlugin: TurbolinkPlugin = {
  name: "youtube",
  css: frameCss,
  match: (t) => YOUTUBE.test(t),
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    const id = YOUTUBE.exec(target)![1]!;
    // nocookie domain: the least-tracking spelling of a playable embed.
    // referrerpolicy: since late 2025 YouTube refuses embeds (error 153)
    // unless the page identifies itself via Referer - this attribute keeps
    // stricter site-wide policies from stripping it. Pages with no origin
    // at all (file://) can't satisfy YouTube regardless; serve over http.
    return `<iframe class="mq-turbolink-frame mq-frame-video" src="https://www.youtube-nocookie.com/embed/${escapeAttr(id)}" title="YouTube video" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
  },
};

const SPOTIFY = /open\.spotify\.com\/(track|album|playlist|episode|show)\/([A-Za-z0-9]+)/;

export const spotifyPlugin: TurbolinkPlugin = {
  name: "spotify",
  css: frameCss,
  match: (t) => SPOTIFY.test(t),
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    const m = SPOTIFY.exec(target)!;
    const height = m[1] === "track" || m[1] === "episode" ? 152 : 352;
    return `<iframe class="mq-turbolink-frame" src="https://open.spotify.com/embed/${m[1]}/${escapeAttr(m[2]!)}" height="${height}" title="Spotify player" loading="lazy"></iframe>`;
  },
};

const GMAPS_COORDS =
  /google\.[a-z.]+\/maps\/\S*@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z/;

/** Matches a Google Maps link that carries coordinates - and renders the
 * same spot as an OpenStreetMap embed. Google retired its keyless embed
 * endpoint, and this is cozier anyway: authors paste the link they have,
 * readers get the map that doesn't track them. Links without coordinates
 * decline to the plain-link floor. */
export const mapsPlugin: TurbolinkPlugin = {
  name: "maps",
  css: frameCss,
  match: (t) => GMAPS_COORDS.test(t),
  render(target, { level }) {
    if (level !== "full") {
      return null;
    }
    const m = GMAPS_COORDS.exec(target)!;
    const lat = Number(m[1]);
    const lon = Number(m[2]);
    const zoom = Math.min(Math.max(Number(m[3]), 1), 19);
    const dLon = 360 / 2 ** zoom;
    const dLat = dLon * 0.4;
    const bbox = [lon - dLon, lat - dLat, lon + dLon, lat + dLat]
      .map((n) => n.toFixed(5))
      .join("%2C");
    const marker = `${lat.toFixed(5)}%2C${lon.toFixed(5)}`;
    return `<iframe class="mq-turbolink-frame mq-frame-map" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&amp;layer=mapnik&amp;marker=${marker}" height="320" title="Map" loading="lazy"></iframe>`;
  },
};

/** The fetchless defaults - safe to hand to any static build. OpenGraph
 * (which fetches) is exported separately and opted into deliberately. */
export const defaultPlugins: TurbolinkPlugin[] = [
  youtubePlugin,
  spotifyPlugin,
  mapsPlugin,
  imagePlugin,
  audioPlugin,
  videoPlugin,
];
