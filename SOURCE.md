# Corresponding source

OwlRunKit is distributed under GPL-3.0-or-later. The corresponding public
source for this release is [OwlRunKit v0.25.2](https://github.com/yeemio/owlrunkit/tree/v0.25.2).
It includes the JavaScript runtime, C source and build script for the Linux
helpers, package metadata, public contracts, and bundled integration resources.

## Rebuild the Linux helpers

Check out the public tag, then run these commands from its root. The helper
build uses the Alpine 3.22 image and the compiler and Linux headers from its
package repository. Build on each architecture or use a Docker environment
that supports both build platforms.

```sh
mkdir -p .build
for platform in linux/arm64 linux/amd64; do
  docker run --rm --platform "$platform" \
    -v "$PWD:/source:ro" -v "$PWD/.build:/out" \
    alpine:3.22@sha256:49340b346798875b5592e5d420241f2f9cfba5f47e62ebb1446a1b34734e898f \
    sh -ec 'apk add --no-cache build-base linux-headers; sh /source/packages/runkit/build-linux-helper.sh /out'
done
(cd .build && sha256sum -c ../LINUX-HELPERS.sha256)
```

The npm tarball contains both helper executables alongside their C source and
the musl copyright notice. Its official registry version, shasum, integrity,
and tarball URL identify the published package.
