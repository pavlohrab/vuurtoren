# Audio

The starter words and their example sentences have recorded audio, in a female and a male voice.
The clips are made once with the ElevenLabs API and ship as the `audio-nl` data pack.

## Make the clips

1. Split the work into chunks of about 14,500 characters (about 29,000 with both voices):

   ```sh
   cd server/nlp
   uv run --no-dev python scripts/tts_elevenlabs.py manifest --out-dir ~/Downloads/vuurtoren-audio-jobs
   ```

2. Choose two Netherlands-Dutch voices in the ElevenLabs Voice Library (filter: Dutch, accent
   Netherlands) and copy their voice ids. Test both with: _de kust, het huis, uit, de deur,
   gezellig, Scheveningen, de trein, het geluid. Ik bel je morgen op._

3. Set the key and the voices in your shell (never in a file in the repository):

   ```sh
   export ELEVENLABS_API_KEY=…
   export VOICE_FEMALE=…   # voice id
   export VOICE_MALE=…     # voice id
   ```

4. Speak one chunk in both voices:

   ```sh
   ~/Downloads/vuurtoren-audio-jobs/run.sh 01   # the loop script that sits next to the chunks
   ```

   Do one chunk per allowance of about 29,000 characters, or `run.sh all` on a paid plan. A run
   can stop at any time; the next run skips every clip that exists.

5. Listen to a few clips from each chunk. A bad clip: delete its file and run the chunk again.

The clips land in `~/Downloads/vuurtoren-audio/{female,male}/<id>.mp3`. A clip's id is
`word-` or `sentence-` plus the first 16 hex digits of the SHA-1 of its text, so the app finds a
clip from the text alone.

## Ship them

```sh
cd server/nlp
uv run --no-dev python scripts/build_packs.py --out dist/packs --audio-from ~/Downloads/vuurtoren-audio
```

The app plays a clip when it exists, then the system voice, then nothing. Settings → Reading &
audio chooses the female or the male voice.
