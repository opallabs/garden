FROM moby/buildkit:v0.10.5@sha256:ca9d86324a000a0cc6d93ae9d0d5a9df750a194d0d43644c3a71fc6230ceba44 as deps

RUN apk add --no-cache curl

# ECR credential helper
RUN cd /tmp && \
  curl -O https://amazon-ecr-credential-helper-releases.s3.us-east-2.amazonaws.com/0.6.0/linux-amd64/docker-credential-ecr-login && \
  chmod +x docker-credential-ecr-login

# GCR credential helper
RUN curl -fsSL "https://github.com/GoogleCloudPlatform/docker-credential-gcr/releases/download/v2.0.1/docker-credential-gcr_linux_amd64-2.0.1.tar.gz" \
  | tar xz --to-stdout ./docker-credential-gcr \
  > /tmp/docker-credential-gcr && chmod +x /tmp/docker-credential-gcr

FROM moby/buildkit:v0.10.5@sha256:ca9d86324a000a0cc6d93ae9d0d5a9df750a194d0d43644c3a71fc6230ceba44 as buildkit

COPY --from=deps /tmp/docker-credential-ecr-login /usr/local/bin/docker-credential-ecr-login
COPY --from=deps /tmp/docker-credential-gcr /usr/local/bin/docker-credential-gcr

FROM moby/buildkit:v0.10.5-rootless@sha256:3a5eca9b8d5d0e6cdcd0e756d607bf7386cd1b61950daf63afadee79b43ba8bf as buildkit-rootless

COPY --from=deps /tmp/docker-credential-ecr-login /usr/local/bin/docker-credential-ecr-login
COPY --from=deps /tmp/docker-credential-gcr /usr/local/bin/docker-credential-gcr
