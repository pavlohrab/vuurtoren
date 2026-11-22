# Audio

The starter words, their example sentences and the bundled stories have recorded audio, in a
female and a male voice. The clips ship as the `audio-nl` data pack (about 230 MB).

## The voices

Both voices are Google Cloud Text-to-Speech, Chirp 3 HD, Netherlands Dutch:

| Voice  | Google voice             |
| ------ | ------------------------ |
| female | `nl-NL-Chirp3-HD-Aoede`  |
| male   | `nl-NL-Chirp3-HD-Charon` |

Settings → Reading → Voice chooses which one plays.

## What is in the pack

```
audio-nl/
  female/  word-<id>.mp3  sentence-<id>.mp3  paragraph-<id>.mp3
  male/    (the same clips in the male voice)
  stories.json   per story: its sentence clips and paragraph clips, in order
```

A clip's id is its kind (`word`, `sentence`, `paragraph`) plus the first 16 hex digits of the
SHA-1 of its exact text. The app finds a clip from the text alone:

- a word: the word with its article for nouns ("het huis");
- a sentence: the card's example sentence, or a story sentence as the reader shows it;
- a paragraph: a story paragraph, for narration.

| Clips                       | Per voice |
| --------------------------- | --------: |
| starter words and sentences |     9,714 |
| story sentences             |     2,083 |
| story paragraphs            |       361 |

The app plays the clip when the pack has it, else the system's Dutch voice, else nothing.

## Where the pack lives

- **Desktop app:** the built-in language server downloads it with the other packs on the first
  start and reads it from its data folder
  (`~/.local/share/app.vuurtoren.desktop/nlp-data/audio-nl` on Linux). The offline installer
  bundles every pack `packs.json` lists, audio included, so its release (`packs-<version>` on
  GitHub, where CI fetches the archives) must hold `audio-nl-<version>.tar.gz`. A local build
  bundles what its `--packs` folder holds.
- **Server:** the language server downloads it with the other packs, or reads it from
  `$VUURTOREN_AUDIO_DIR`.
- **Phone:** it asks your server for each clip; without a server it uses the system voice.

## Make the clips again

Use a Google Cloud project with billing enabled and the Google Cloud CLI
([install](https://docs.cloud.google.com/sdk/docs/install-sdk)):

```sh
gcloud auth login
gcloud services enable texttospeech.googleapis.com --project YOUR_PROJECT_ID
gcloud auth application-default login
gcloud auth application-default set-quota-project YOUR_PROJECT_ID
```

To compare voices first, make the same 12 words and sentences and two story excerpts in twelve
Dutch voices:

```sh
python server/nlp/scripts/tts_google.py audition \
  --project YOUR_PROJECT_ID --out ~/Downloads/vuurtoren-chirp-audition
```

Then make the stories and the starter words with the chosen pair. A run can stop at any time;
the same command with the same folders skips every clip that exists.

```sh
python server/nlp/scripts/tts_google.py stories \
  --project YOUR_PROJECT_ID --voice Aoede Charon --out ~/Downloads/vuurtoren-chirp-dual/stories &&
python server/nlp/scripts/tts_google.py starter \
  --project YOUR_PROJECT_ID --voice Aoede Charon --out ~/Downloads/vuurtoren-chirp-dual/starter
```

That is 24,316 clips and about 773,000 characters; at the default pace it takes about two and a
quarter hours. `--dry-run` counts what is left without making requests.

## Build the pack

Put the clips of both runs in one folder (`female/`, `male/` and `stories.json`), then build:

```sh
P=~/Downloads/vuurtoren-audio-pack
mkdir -p $P/female $P/male
for v in female male; do
  cp -l ~/Downloads/vuurtoren-chirp-dual/{starter,stories}/$v/*.mp3 $P/$v/
done
cp ~/Downloads/vuurtoren-chirp-dual/stories/stories.json $P/
cd server/nlp
uv run --no-dev python scripts/build_packs.py --out dist/packs --audio-from $P
```

This writes `dist/packs/audio-nl-<version>.tar.gz` and its entry in `packs.json`. Publish the
archive with the other packs.
