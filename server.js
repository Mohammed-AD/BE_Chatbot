require("dotenv").config();

const express = require("express");
const cors    = require("cors");
const fetch   = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json({ limit: "20kb" }));
app.use(express.static("public"));

// ══════════════════════════════════════════════════════════════════
//  🔑  API KEYS — .env file mein likho:
//      API_KEY_1=sk-or-v1-xxxxx
//      API_KEY_2=sk-or-v1-yyyyy
// ══════════════════════════════════════════════════════════════════
const KEY_1 = process.env.API_KEY_1;
const KEY_2 = process.env.API_KEY_2;

if (!KEY_1 && !KEY_2) {
  console.error("❌ Koi API key nahi mili! .env file check karo.");
  process.exit(1);
}

const availableKeys = [KEY_1, KEY_2].filter(Boolean);
console.log(`✅ ${availableKeys.length} API key(s) loaded.`);

// ══════════════════════════════════════════════════════════════════
//  🤖  FREE MODELS — June 2026 verified list from openrouter.ai
//      Sab 100% free hain, koi credit card nahi chahiye
//      Quality score ke hisaab se order kiya hai (best pehle)
// ══════════════════════════════════════════════════════════════════
const MODELS = [
  "google/gemma-4-31b-it:free",            // #1
  "meta-llama/llama-3.3-70b-instruct:free",// #2
  "nvidia/nemotron-3-super-120b-a12b:free",// #3
  "openai/gpt-oss-120b:free",              // #4
  "nousresearch/hermes-3-llama-3.1-405b:free", // #5
  "openrouter/free"                        // Fallback
];

// ══════════════════════════════════════════════════════════════════
//  🧠  SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are a helpful, smart AI assistant.
- Answer clearly and accurately
- For complex questions, explain step by step
- For translations, keep the original meaning exactly
- Be concise unless a detailed answer is needed`;

// ══════════════════════════════════════════════════════════════════
//  🔄  SMART FALLBACK ENGINE
// ══════════════════════════════════════════════════════════════════
async function smartCall(messages) {
  for (const key of availableKeys) {
    for (const model of MODELS) {
      try {
        const shortKey = key.slice(-6);
        const shortModel = model.split("/")[1] || model;
        console.log(`🔄 Trying: ${shortModel} | Key: ...${shortKey}`);

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type":  "application/json",
            "HTTP-Referer":  process.env.SITE_URL || "http://localhost:3000",
            "X-Title":       "My Chatbot",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.7,
            max_tokens:  1500,
          }),
        });

        const data = await res.json();

        if (data.error) {
          console.warn(`  ⚠️  ${data.error.message || JSON.stringify(data.error)}`);
          continue;
        }

        if (!data.choices || data.choices.length === 0) {
          console.warn(`  ⚠️  No response received`);
          continue;
        }

        console.log(`  ✅ Success → ${model}`);
        return {
          reply: data.choices[0].message.content,
          //model: model,
        };

      } catch (err) {
        console.warn(`  ❌ Network error: ${err.message}`);
        continue;
      }
    }
  }

  return null;
}

// ══════════════════════════════════════════════════════════════════
//  📡  POST /chat
// ══════════════════════════════════════════════════════════════════
app.post("/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "Message required hai." });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: "Message bahut lamba hai." });
    }

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history.slice(-10),
      { role: "user",   content: message.trim() },
    ];

    const result = await smartCall(messages);

    if (result) {
      return res.json(result);
    }

    return res.status(503).json({
      error: "Abhi sab models busy hain. 1-2 minute baad try karo.",
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/health", (req, res) => {
  res.json({
    status:       "ok",
    keys_loaded:  availableKeys.length,
    models:       MODELS.length,
    combinations: availableKeys.length * MODELS.length,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server → http://localhost:${PORT}`);
  console.log(`🔑 Keys: ${availableKeys.length} | 🤖 Models: ${MODELS.length}`);
  console.log(`🔄 Total combinations: ${availableKeys.length * MODELS.length}\n`);
});
