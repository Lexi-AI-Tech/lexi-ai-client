# Docs Structure Content API

The Lexi client calls this endpoint when the user records voice in a Doc and requests the transcript to be turned into structured rich content (Notion/Confluence/Jira-style).

## Endpoint

**POST** `/api/v1/docs/structure-content`

## Headers

- `Authorization: Bearer <access_token>` (required)
- `Content-Type: application/json`

## Request body

```json
{
  "transcript": "string — raw speech-to-text transcript"
}
```

## Response

**200 OK**

```json
{
  "content": "<TipTap/ProseMirror JSON document as string>"
}
```

Or wrapped in `data`:

```json
{
  "data": {
    "content": "<TipTap JSON string>"
  }
}
```

## TipTap JSON format

The `content` value must be a **string** that parses to a TipTap/ProseMirror document. Use the same schema as the Lexi Docs editor (StarterKit):

- **Document**: `{ "type": "doc", "content": [ ... ] }`
- **Blocks**: `paragraph`, `heading` (level 1–3), `bulletList`/`listItem`, `orderedList`/`listItem`, `blockquote`, `codeBlock`, `horizontalRule`
- **Inline**: `text`, with optional `marks` for `bold`, `italic`, `code`

Example:

```json
{
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "Meeting notes" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "We discussed the roadmap." }] },
    { "type": "bulletList", "content": [
      { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Q1: Launch" }] }] },
      { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Q2: Scale" }] }] }
    ]}
  ]
}
```

The LLM should structure the transcript into clear headings, paragraphs, and lists (like Notion, Confluence, or Jira), and output **only** valid TipTap JSON as above (no markdown or extra text).

## Errors

- **401** — Missing or invalid auth
- **400** — Missing `transcript` or invalid body
- **500** — LLM or processing error
