import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../middleware/errorHandler';
import { synthesizeSpeech, TtsGender } from '../services/tts.service';

const router = Router();

// One call per successful scan at most (when the kiosk needs to announce a
// dynamic phrase — e.g. a scanned employee's name — that can't be one of the
// two pre-bundled fixed-phrase MP3s) — much lower ceiling than the scan
// endpoints, since this hits an external network service per uncached phrase.
const ttsLimiter = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

const MAX_TEXT_LENGTH = 200;

// POST /api/tts/speak  - public, same reasoning as /attendance/scan: the
// checkin kiosk page is reachable without login by design. Synthesizes Thai
// speech server-side (see tts.service.ts) so the announcement doesn't depend
// on the browser's own (often missing/unreliable for Thai, especially on
// Chrome) speechSynthesis voice list — returns raw MP3 bytes the kiosk plays
// directly through an <audio> element.
router.post('/speak', ttsLimiter, asyncHandler(async (req, res) => {
  const { text, gender } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'กรุณาระบุข้อความ (text)' });
    return;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    res.status(400).json({ error: `ข้อความยาวเกินไป (สูงสุด ${MAX_TEXT_LENGTH} ตัวอักษร)` });
    return;
  }
  const voiceGender: TtsGender = gender === 'male' ? 'male' : 'female';

  try {
    const audio = await synthesizeSpeech(text.trim(), voiceGender);
    res.set('Content-Type', 'audio/mpeg');
    // Same text+gender always produces the same audio — safe to cache
    // client-side too, not just in the server-side in-memory cache.
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(audio);
  } catch (err) {
    console.error('[tts] synthesis failed:', err);
    res.status(502).json({ error: 'สร้างเสียงพูดไม่สำเร็จ (TTS service unavailable)' });
  }
}));

export default router;
