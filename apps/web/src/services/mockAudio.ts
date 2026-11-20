/**
 * The demo's audio pack: every word has a clip (a few frames of silent MP3), no sentence has
 * one, so the demo shows both a clip and the system-voice fallback.
 */

/** MPEG-1 Layer III frames, 32 kbps, 44.1 kHz, mono, all zero: a quarter second of silence. */
function silentMp3(frames = 10): Uint8Array<ArrayBuffer> {
  const frame = new Uint8Array(104);
  frame.set([0xff, 0xfb, 0x10, 0xc0]);
  const out = new Uint8Array(frame.length * frames);
  for (let i = 0; i < frames; i++) out.set(frame, i * frame.length);
  return out;
}

export async function mockAudioClip(id: string): Promise<Blob | null> {
  return id.startsWith("word-") ? new Blob([silentMp3()], { type: "audio/mpeg" }) : null;
}
