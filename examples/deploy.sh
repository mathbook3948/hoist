#!/bin/sh
set -eu
# Copy this OUTSIDE the application's code and artifact directories before registration.
# The panel calls: /bin/sh /absolute/trusted-script.sh /absolute/random-artifact.bin VERSION
artifact=$1
version=$2
# An intentionally inert template. Fill in extraction/restart steps after review.
# Never use eval, sh -c, or unquoted $artifact / $version; validate archive entry paths.
printf 'Received artifact %s (version %s)\n' "$artifact" "$version"
printf 'Template only: no files extracted or services changed\n'
