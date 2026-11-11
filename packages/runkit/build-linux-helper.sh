#!/bin/sh
set -eu

case "$(uname -s)/$(uname -m)" in
    Linux/x86_64) arch=x64 ;;
    Linux/aarch64) arch=arm64 ;;
    *) echo "Build the peer helper on Linux x86_64 or aarch64." >&2; exit 1 ;;
esac

if [ "$#" -ne 1 ] || [ ! -d "$1" ]; then
    echo "Usage: sh build-linux-helper.sh <existing output directory>" >&2
    exit 1
fi

source_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../../scripts/runkit-contract" && pwd)
"${CC:-cc}" -std=c11 -O2 -Wall -Wextra -Werror -static -s \
    "$source_dir/peer-linux.c" -o "$1/peer-linux-$arch"
