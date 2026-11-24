#!/usr/bin/env bash
# Build the server images here and load them on another Docker host, without a registry.
# For testing before images are published (Dockge then finds them on that host).
#
#   deploy/push-images.sh truenas_admin@home            build, copy, load
#   deploy/push-images.sh truenas_admin@home --no-build  copy and load what was built before
#
# Needs Docker here (your user in the "docker" group, or run it with sudo) and ssh to the host.
# The host asks for its sudo password once, while loading.
set -euo pipefail

HOST=${1:?usage: deploy/push-images.sh user@host [--no-build]}
OWNER=${VUURTOREN_IMAGE_OWNER:-pavlohrab}
TAG=${VUURTOREN_TAG:-latest}
IMAGES=(
  "ghcr.io/$OWNER/vuurtoren-web:$TAG"
  "ghcr.io/$OWNER/vuurtoren-api:$TAG"
  "ghcr.io/$OWNER/vuurtoren-nlp:$TAG"
)
cd "$(dirname "$0")/.."

if [[ ${2:-} != --no-build ]]; then
  echo "Building ${IMAGES[*]}"
  # The server's own settings (sign-in) are required to run the stack, not to build it: a
  # placeholder keeps compose from refusing to build without a .env here.
  VUURTOREN_IMAGE_OWNER=$OWNER VUURTOREN_TAG=$TAG VUURTOREN_USER=${VUURTOREN_USER:-build} \
    docker compose -f deploy/compose.yml build web api nlp
fi
for image in "${IMAGES[@]}"; do
  docker image inspect "$image" >/dev/null 2>&1 || {
    echo "Missing $image: build it first (run without --no-build)." >&2
    exit 1
  }
done

FILE=vuurtoren-images-$TAG.tar.gz
echo "Saving the images to /tmp/$FILE"
docker save "${IMAGES[@]}" | gzip >"/tmp/$FILE"
echo "Copying to $HOST ($(du -h "/tmp/$FILE" | cut -f1))"
scp "/tmp/$FILE" "$HOST:$FILE"
echo "Loading on $HOST (it asks for the sudo password)"
ssh -t "$HOST" "sudo docker load -i $FILE && rm $FILE"
rm "/tmp/$FILE"
echo "Done. In Dockge: Restart the vuurtoren stack (not Update)."
