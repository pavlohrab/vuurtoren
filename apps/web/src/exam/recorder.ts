/**
 * Local voice recording for Spreken practice: MediaRecorder into memory only. The audio is never
 * stored or uploaded; the caller makes an object URL for playback and revokes it.
 */

export function recordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export interface Recording {
  /** Stop and get the audio (also releases the microphone). */
  stop(): Promise<Blob>;
}

/** Ask for the microphone and start recording. Rejects when access is denied. */
export async function startRecording(): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  rec.start();
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          resolve(new Blob(chunks, { type: rec.mimeType || "audio/webm" }));
        };
        if (rec.state !== "inactive") rec.stop();
        else rec.onstop?.(new Event("stop"));
      }),
  };
}
