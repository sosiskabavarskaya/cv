# syntax=docker/dockerfile:1
# The upstream prebuilt community images are no longer publicly downloadable.
# Build the same release used by this workspace from its immutable source commit.
FROM golang:1.24.7-alpine AS build
WORKDIR /src
ADD --checksum=sha256:8819e3e7817e46b7b3798f8f200ead208562e571563c2e040352378031abe9f2 \
    https://codeload.github.com/minio/minio/tar.gz/07c3a429bfed433e49018cb0f78a52145d4bedeb /tmp/minio.tar.gz
RUN tar -xzf /tmp/minio.tar.gz --strip-components=1 -C /src
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOMAXPROCS=2 go build -p 2 -trimpath -o /out/minio .

FROM alpine:3.22.1
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -g 10001 minio \
    && adduser -D -H -u 10001 -G minio minio \
    && mkdir /data \
    && chown minio:minio /data
COPY --from=build /out/minio /usr/local/bin/minio
COPY --from=build /src/LICENSE /usr/share/licenses/minio/LICENSE
USER minio:minio
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--console-address", ":9001"]
