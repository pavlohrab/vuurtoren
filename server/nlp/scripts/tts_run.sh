#!/usr/bin/env bash
# Speak one chunk (or all) in both voices. Usage:
#   ./run.sh 03          one chunk, female then male (about 29,000 characters)
#   ./run.sh all         every chunk that is not finished yet
# Needs: ELEVENLABS_API_KEY, VOICE_FEMALE, VOICE_MALE in the environment.
set -euo pipefail
: "${ELEVENLABS_API_KEY:?set ELEVENLABS_API_KEY}" "${VOICE_FEMALE:?set VOICE_FEMALE}" "${VOICE_MALE:?set VOICE_MALE}"
JOBS="${VUURTOREN_AUDIO_JOBS:-$HOME/Downloads/vuurtoren-audio-jobs}"
REPO="${VUURTOREN_REPO:-$HOME/WORK/PhD/015_anylanguage}"
OUT="${VUURTOREN_AUDIO_OUT:-$HOME/Downloads/vuurtoren-audio}"
one() {
  local f="$JOBS/chunk-$1.json"
  (cd "$REPO/server/nlp" && uv run --no-dev python scripts/tts_elevenlabs.py speak --chunk "$f" --gender female --voice "$VOICE_FEMALE" --out "$OUT")
  (cd "$REPO/server/nlp" && uv run --no-dev python scripts/tts_elevenlabs.py speak --chunk "$f" --gender male --voice "$VOICE_MALE" --out "$OUT")
}
if [ "${1:-}" = all ]; then
  for f in "$JOBS"/chunk-*.json; do n=$(basename "$f" .json); one "${n#chunk-}"; done
else
  one "${1:?give a chunk number, e.g. 01, or all}"
fi
