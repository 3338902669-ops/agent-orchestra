---
name: "image_search"
description: "Search the web by text query for image URLs and source pages for feeds, artifacts, and visual references. Does not identify a supplied image or person."
---

# Image Search

## Purpose

Find public images by text query and return their URLs plus source pages. Text-to-image search only — never use it to identify a person from a supplied photograph.

## Tooling

Bundled CLI (Hatch runtime):

```sh
/opt/hatch/bin/image-search "<query>" --max-results 5 [--language <code>]
```

Output is JSON: `{provider, query, request_id, results: [...]}`. Each result carries:

- `media_url` — preferred full-image URL when present.
- `thumbnail_cdn_url` — renderable CDN preview; fallback when `media_url` is absent. Treat as cache, not durable storage.
- `page_url` — source page; keep for provenance/attribution.
- `media_handle`, `candidate_ref` — internal, non-renderable. Never fetch or display.

Only results with `media_url` or `thumbnail_cdn_url` are returned. Pick the best match, not blindly the first.

If the CLI is absent on your runtime, reimplement the same JSON contract against any image-search backend before using this skill.

## Operating Rules

1. This skill returns locators only. It does not download or upload. To keep a durable local copy (e.g. for an artifact or avatar), fetch the chosen URL yourself with the preflight below.
2. Prefer an HTTPS `media_url` with no credentials, query string, or fragment. Use any returned locator byte-for-byte; never rewrite its query string.
3. Preflight like a browser before fetching, one candidate at a time, bounded timeouts:

```sh
curl -fsSLI -A 'Mozilla/5.0' -H 'Accept: image/png,image/jpeg,image/gif,image/webp,image/*;q=0.5' -H 'Referer: <any-https-origin-that-is-not-the-image-host>' '<image-url>'
curl -fsSL --connect-timeout 10 --max-time 60 -A 'Mozilla/5.0' -H 'Accept: image/png,image/jpeg,image/gif,image/webp,image/*;q=0.5' -H 'Referer: <any-https-origin-that-is-not-the-image-host>' -o '<dest-file>' '<image-url>'
```

Accept only a final `2xx` whose content type and file magic are an image. Reject hotlink-blocked, expiring, redirecting, 403/404, non-image, watermarked, or unstable URLs. Prefer PNG/JPEG; WEBP is fine except inside Word documents; convert HEIC to JPEG; avoid AVIF on web pages.

4. For avatars/profile pictures: prefer stock or generated faces over identifiable real people; flag watermarks before handing the file over.
