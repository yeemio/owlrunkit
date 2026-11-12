# Corresponding source

Source on the default branch is available under the [MIT License](LICENSE).
The published `owlrunkit@0.25.4` npm package carries GPL-3.0-or-later and
maps to [the v0.25.4 source tag](https://github.com/yeemio/owlrunkit/tree/v0.25.4).
The npm package includes the JavaScript runtime, read-only verifier, C source,
and [Linux helper build script](packages/runkit/build-linux-helper.sh).
The distributed helpers statically link musl and include its copyright notice.

## Rebuild the Linux helpers

From the public tag or unpacked npm package, run the build on Linux x86-64
and ARM64 using Alpine 3.22 with `build-base` and `linux-headers`.

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

The authoritative release is identified by the npm registry version, shasum,
integrity, and tarball URL. Local directories, `file:` dependencies, local
tarballs, Git URLs, workspace links, and mutable dist-tags are not accepted as
formal cross-project adoption evidence.
