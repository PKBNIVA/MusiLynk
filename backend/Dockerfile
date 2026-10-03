# Build context is the repository root (railway.toml: dockerfilePath = "backend/Dockerfile").
# Ignore rules live in backend/Dockerfile.dockerignore (BuildKit reads <Dockerfile>.dockerignore).
FROM ruby:3.3.6-slim AS base
WORKDIR /rails
ENV RAILS_ENV=production \
    BUNDLE_DEPLOYMENT=1 \
    BUNDLE_FROZEN=1 \
    BUNDLE_PATH=/usr/local/bundle \
    BUNDLE_WITHOUT="development:test"

FROM base AS build
RUN apt-get update -qq && apt-get install --no-install-recommends -y build-essential libpq-dev git && rm -rf /var/lib/apt/lists/*
COPY backend/Gemfile backend/Gemfile.lock ./
# Install the exact Bundler recorded in Gemfile.lock, then exactly the locked gems.
# BUNDLE_DEPLOYMENT/BUNDLE_FROZEN make the build fail if Gemfile and Gemfile.lock disagree.
RUN gem install bundler -v "$(tail -n 1 Gemfile.lock | tr -d ' ')" --no-document \
  && bundle install \
  && rm -rf "${BUNDLE_PATH}"/ruby/*/cache "${BUNDLE_PATH}"/ruby/*/bundler/gems/*/.git
COPY backend/ .

FROM base
# PG_CLIENT_MAJOR must be at least the server's major version (Railway runs postgres-ssl:18):
# pg_dump refuses a newer server. The client tools come from the PostgreSQL project's apt repo
# (the base image only has 15). Used by `bin/rails backup:*` and BackupToR2Job (docs/ops/backups.md).
ARG PG_CLIENT_MAJOR=18
RUN apt-get update -qq && apt-get install --no-install-recommends -y libpq5 curl gosu ca-certificates \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && . /etc/os-release \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update -qq && apt-get install --no-install-recommends -y "postgresql-client-${PG_CLIENT_MAJOR}" \
  && rm -rf /var/lib/apt/lists/*
ENV RAILS_SERVE_STATIC_FILES=false
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /rails /rails
RUN useradd rails --create-home --shell /bin/bash \
  && mkdir -p db log storage tmp/pids \
  && chown -R rails:rails db log storage tmp
EXPOSE 3000
# The volume mounted at storage/ arrives root-owned, so fix ownership as root, then drop to
# the rails user. bin/web runs db:prepare unless SKIP_DB_PREPARE_ON_BOOT=true (migrations
# then run only in Railway's pre-deploy step), then starts Puma. A worker service overrides
# this with its own start command (railway.worker.toml).
CMD ["bash", "-lc", "chown -R rails:rails storage tmp log && exec gosu rails bash -lc 'exec bin/web'"]
