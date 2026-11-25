# Migration guide

Breaking changes to the Murmurly API, newest first. Each entry says what changed, who it affects and what to send instead.

<!-- api-change-notifier: new entries go below this line -->

## 2026-11-25: Word timings move into the transcript, `diarization` replaces `speaker_labels`, and listing uses a cursor

Changed in #1.

Three changes to the transcripts API.

### `GET /v1/transcripts/{id}/words` is removed

Word-level timestamps now come back on the transcript itself. Request them with `include=words` on `GET /v1/transcripts/{id}`. The words are in the `words` array of the response. Calls to the old endpoint now fail.

```diff
-GET /v1/transcripts/tr_123/words
+GET /v1/transcripts/tr_123?include=words
```

Read `words` from the transcript object instead of from a separate response.

### `speaker_labels` is now `diarization`

`POST /v1/transcripts` no longer accepts `speaker_labels`. Send `diarization` instead. It takes the same boolean value and behaves the same way.

```diff
 {
   "audio_url": "https://cdn.example.com/episode-112.mp3",
-  "speaker_labels": true
+  "diarization": true
 }
```

If you don't send the field, nothing changes.

### Listing transcripts uses a cursor instead of page numbers

`GET /v1/transcripts` no longer accepts `page`. Send `cursor` instead. Omit it for the first page, then pass the `next_cursor` from each response to get the next page. `next_cursor` is `null` on the last page. The `page` and `total` fields are gone from the response.

```diff
-GET /v1/transcripts?page=2&limit=50
+GET /v1/transcripts?cursor=<next_cursor from the previous page>&limit=50
```

If you never sent `page`, you only need to change your code if you read `page` or `total` from the response.


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
