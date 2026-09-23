---
name: changqi-release
description: Build and deploy the changqi-checkin-h5 project from a verified GitHub branch. Use when asked to build, publish, release, update, or roll back the production image for cq.fsxinhuo.cn, or to verify this project's Actions artifact and Docker deployment.
---

# Changqi Release

Use this skill only from the `changqi-checkin-h5` repository. Keep the release a single immutable artifact: GitHub Actions builds it, the local agent transfers it, and the server only loads and runs it.

## Safety Gates

- Read `AGENTS.md`, `README.md`, `docs/TASKS.md`, and `docs/DEPLOY.md` before changing anything.
- Resolve the exact source branch and commit first. Never build uncommitted local files or use "latest successful" by guesswork.
- Do not build on the 1 GB server, push from the server, reset/clean the worktree, or use a production database for tests.
- Do not print `.env.runtime`, passwords, AppSecret, session secrets, cookies, or user data. Check key presence and lengths only.
- Preserve the current image, `.env.runtime`, Compose file, uploads, database, and Nginx backup before replacement.
- Do not modify other sites, DNS, certificates, menus, message services, or production records.

## Build

1. Check `git status --porcelain=v1 --untracked-files=all`, branch, remote HEAD, PR head, and the requested source SHA.
2. Trigger the existing workflow; do not create a second build system:

   ```powershell
   gh workflow run build-image.yml -R Jonoka/changqi-checkin-h5 --ref <branch>
   gh run watch <run-id> -R Jonoka/changqi-checkin-h5 --exit-status
   ```

3. Verify the completed run has the requested `headSha`, success conclusion, and one non-expired artifact. Read `build-info.json` after download and require:
   - `sourceSha` equals the run head SHA;
   - `runId`, `runAttempt`, `imageTag`, and `platform` match the run;
   - `platform` is `linux/amd64` for this server;
   - the archive SHA-256 equals the sidecar `.sha256` file.

   Download into a fresh directory such as `tmp/release-<run-id>`. If `gh run download` reports an extraction conflict after partial success, inspect the files, remove only that fresh release directory, and retry once.

## Server Preflight

Target server: `root@100.95.32.56` over Tailscale. Project directory: `/opt/changqi-checkin-h5`. The app binds `127.0.0.1:3002`; port 3000 belongs to another Node service. Uploads persist at `/var/lib/changqi/uploads`. The existing MySQL service is reused; never start a production MySQL container.

Before replacement, check without exposing secrets:

```bash
docker version
docker compose version
docker compose --env-file .env.runtime -f compose.yaml ps
docker inspect changqi-checkin-h5-app-1 --format '{{.Config.Image}} {{.State.Status}}'
stat -c '%a' /opt/changqi-checkin-h5/.env.runtime
```

The server Compose file must keep `network_mode: bridge` so containers reach the host MySQL through `172.17.0.1`. The project DB user must allow `172.17.%`, not one fixed container IP. If the DB check fails, stop before changing the running image.

## Transfer and Update

1. Create `/opt/changqi-checkin-h5/releases/<run-id>` and back up `.env.runtime` and the current Compose file under `backups/`.
2. SCP only the selected image archive, checksum, `compose.yaml`, and `build-info.json`.
3. On the server, compare `sha256sum` with the sidecar, then run `docker load -i <archive>`. Inspect architecture, OS, tag, and image ID.
4. Copy the artifact Compose file to the project directory and re-add the server-only `network_mode: bridge` line. Keep the existing `.env.runtime`; change only `APP_IMAGE` to the verified tag.
5. Run the idempotent schema command against the configured project database. Docker Compose v2.27 does not accept `--pull` on `run`, so use:

   ```bash
   docker compose --env-file .env.runtime -f compose.yaml run --rm --no-deps app npm run db:schema
   ```

6. Replace the app without building or pulling:

   ```bash
   docker compose --env-file .env.runtime -f compose.yaml up -d --no-build --pull never app
   ```

Wait for the container to be running and `/health` to report `database: connected`. Keep the old image and environment backup until the checks pass.

## Nginx and Acceptance Checks

Only edit `/www/server/panel/vhost/nginx/cq.fsxinhuo.cn.conf`. Back it up, proxy to `http://127.0.0.1:3002`, pass `Host`, `X-Forwarded-*`, and set a 20 MiB request limit. Run `nginx -t` before `systemctl reload nginx`. Preserve the HTTP-to-HTTPS redirect and existing certificate paths.

Check both locally on the server with `--resolve` and externally from the Windows agent:

- HTTPS `/health` returns database connected;
- `/api/activity` returns the expected activity and five points;
- `/q/p01` returns the participation page;
- an illustration asset returns `200 image/webp`;
- unauthenticated `/api/me` returns JSON `401`;
- an invalid claim code returns JSON `404`;
- `/stats` returns `401` without Basic Auth;
- HTTP returns `301` to HTTPS;
- container restart preserves health and the same image tag.

Do not call upload, claim, or statistics write paths with production visitor data. Real iOS/Android WeChat, photos, claims, and paper QR scans remain separate acceptance layers.

## Rollback

Rollback only on failed health, database, proxy, or image checks:

1. Restore the backed-up `.env.runtime` or set `APP_IMAGE` to the recorded previous tag.
2. Re-run `docker compose ... up -d --no-build --pull never app`.
3. Recheck `/health` and HTTPS. Never delete the database or upload volume.

## Handoff

Update only `docs/TASKS.md` with the actual source SHA, run ID/attempt, artifact name, archive SHA-256, image tag/ID/platform, server path, checks, rollback backup, and remaining WeChat/paper gaps. Keep secrets out of Git and the report.
