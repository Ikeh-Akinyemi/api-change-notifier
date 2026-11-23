# Migration guide

Breaking changes to the Murmurly API, newest first. Each entry says what changed, who it affects and what to send instead.

<!-- api-change-notifier: new entries go below this line -->

## 2026-08-12: `language` takes BCP 47 codes only

Changed in #31.

`POST /v1/transcripts` used to accept language names such as `english` in the `language` field. It now accepts BCP 47 codes only, and rejects anything else with a `422`.

If you set `language`, send the code instead of the name:

```diff
 {
   "audio_url": "https://cdn.example.com/episode-112.mp3",
-  "language": "english"
+  "language": "en-US"
 }
```

If you leave `language` out, nothing changes: we still detect the language for you.
