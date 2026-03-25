/**
 * Example: Lexi server route for POST /api/v1/docs/structure-content
 *
 * Add this route to your Lexi AI server (e.g. Express/Node). It uses an LLM to convert
 * a voice transcript into TipTap/ProseMirror JSON (Notion/Confluence/Jira-style structure).
 *
 * Prerequisites:
 * - Auth middleware that sets req.user from JWT
 * - An LLM client (OpenAI, Anthropic, or Groq) — example uses OpenAI
 *
 * Install: npm install openai
 * Set: process.env.OPENAI_API_KEY
 */

const { OpenAI } = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a document structuring assistant. Given a raw voice transcript, output a single valid TipTap/ProseMirror JSON document that structures the content for a rich text editor (like Notion, Confluence, or Jira).

Rules:
- Output ONLY valid JSON. No markdown code fences, no explanation.
- Use this exact schema: doc with content array of block nodes.
- Allowed block types: paragraph, heading (level 1–3), bulletList (with listItem > paragraph), orderedList (with listItem > paragraph), blockquote, codeBlock, horizontalRule.
- Text lives in paragraph (or inside listItem, blockquote, etc.) as content: [{ "type": "text", "text": "..." }].
- Use headings to separate sections, lists for bullets/numbers, blockquote for quotes, codeBlock for code.
- Preserve meaning and order; fix obvious speech errors and punctuation.`;

async function structureDocContent(req, res) {
  try {
    const { transcript } = req.body;
    if (!transcript || typeof transcript !== "string") {
      return res.status(400).json({ error: "Missing or invalid transcript" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: transcript.trim() },
      ],
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content?.trim();
    if (!raw) {
      return res.status(500).json({ error: "Empty LLM response" });
    }

    // Strip optional markdown code block
    let jsonStr = raw;
    const codeBlock = /^```(?:json)?\s*([\s\S]*?)```$/;
    const m = raw.match(codeBlock);
    if (m) jsonStr = m[1].trim();

    // Validate it parses and has doc shape
    const parsed = JSON.parse(jsonStr);
    if (parsed.type !== "doc" || !Array.isArray(parsed.content)) {
      return res
        .status(500)
        .json({ error: "LLM did not return a valid TipTap doc" });
    }

    return res.json({ content: JSON.stringify(parsed) });
  } catch (err) {
    console.error("structure-doc-content error:", err);
    return res
      .status(500)
      .json({ error: err.message || "Failed to structure content" });
  }
}

// Express example registration (add auth middleware as you use elsewhere):
// app.post('/api/v1/docs/structure-content', authMiddleware, structureDocContent);

module.exports = { structureDocContent, SYSTEM_PROMPT };
