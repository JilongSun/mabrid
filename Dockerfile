# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS frontend-build
WORKDIR /build/frontend
RUN npm install --global pnpm@11.9.0
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim-bookworm AS backend-build
COPY --from=ghcr.io/astral-sh/uv:0.11.25 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never
WORKDIR /build/backend
COPY backend/ ./
RUN uv sync --locked --no-dev --no-editable --package mabrid-server

FROM python:3.12-slim-bookworm AS runtime
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MABRID_FRONTEND_DIST=/app/frontend
RUN groupadd --gid 10001 mabrid \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin mabrid \
    && mkdir -p /etc/mabrid /var/lib/mabrid \
    && chown mabrid:mabrid /var/lib/mabrid
WORKDIR /app
COPY --from=backend-build /opt/venv /opt/venv
COPY --from=frontend-build /build/frontend/dist /app/frontend
COPY LICENSE /app/LICENSE
USER 10001:10001
EXPOSE 8765
VOLUME ["/var/lib/mabrid"]
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8765/ready', timeout=3).close()"]
ENTRYPOINT ["mabrid"]
CMD ["--config", "/etc/mabrid/mabrid.yaml", "--api-host", "0.0.0.0", "--api-port", "8765"]