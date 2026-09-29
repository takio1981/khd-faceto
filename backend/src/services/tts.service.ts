import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// Server-side Thai text-to-speech for the checkin kiosk's voice
// announcements. Exists specifically because a browser's own speechSynthesis
// voice list is unreliable for Thai — Chrome in particular often has no
// usable local Thai voice at all, so a client-side announcement can end up
// silent (this hits the "อ่านชื่อผู้สแกน" name-reading feature hardest, since
// a name is dynamic and can't be pre-bundled like the two fixed phrases).
// Generating the audio here instead removes that dependency entirely: any
// browser just plays back an MP3 byte stream. Uses Microsoft Edge's free
// neural "Read Aloud" service (no API key, no cost) via the msedge-tts
// package — the same voices already used to pre-generate the bundled fixed
// phrases in frontend-ng/public/audio/tts/.

export type TtsGender = 'male' | 'female';

const VOICE_BY_GENDER: Record<TtsGender, string> = {
  female: 'th-TH-PremwadeeNeural',
  male: 'th-TH-NiwatNeural',
};

// The free service occasionally drops the connection mid-synthesis
// ("Stream closed before turn.end received") — observed intermittently
// during testing, unrelated to the input text. A couple of retries clears it
// almost every time.
const MAX_ATTEMPTS = 3;

// Keyed by `${gender}::${text}` — bounded in practice by the number of
// distinct employee names plus the couple of fixed phrases that reach this
// path (only when the bundled MP3s are turned off), so an unbounded Map is
// fine for a single office's headcount. Resets on server restart, same
// trade-off already accepted for the unknown-face alert debounce map.
const cache = new Map<string, Buffer>();
const MAX_CACHE_ENTRIES = 500;

function cacheKey(text: string, gender: TtsGender): string {
  return `${gender}::${text}`;
}

async function synthesizeOnce(text: string, voice: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(text);
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    audioStream.on('data', (chunk: Buffer) => chunks.push(chunk));
    audioStream.on('end', () => resolve());
    audioStream.on('error', reject);
  });
  return Buffer.concat(chunks);
}

export async function synthesizeSpeech(text: string, gender: TtsGender): Promise<Buffer> {
  const key = cacheKey(text, gender);
  const cached = cache.get(key);
  if (cached) return cached;

  const voice = VOICE_BY_GENDER[gender];
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const buffer = await synthesizeOnce(text, voice);
      if (cache.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(key, buffer);
      return buffer;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastErr;
}
