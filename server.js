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
//  🤖  FREE MODELS
// ══════════════════════════════════════════════════════════════════
const MODELS = [
  "google/gemma-4-31b-it:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
  "nousresearch/hermes-3-llama-3.1-405b:free",
  "openrouter/free"
];

// ══════════════════════════════════════════════════════════════════
//  🏥  BASE MEDICAL SYSTEM PROMPT
// ══════════════════════════════════════════════════════════════════
const BASE_SYSTEM_PROMPT = `You are a compassionate, knowledgeable menstrual health assistant.

ROLE:
- Help users understand their menstrual cycle, symptoms, and reproductive health
- Provide clear, evidence-based information in a warm, non-judgmental tone
- Always recommend consulting a doctor for diagnosis or treatment decisions

RULES:
- Never diagnose medical conditions — provide general health information only
- If symptoms sound severe (extreme pain, very heavy bleeding, periods missed 45+ days), always advise seeing a doctor
- Keep answers concise and easy to understand (2-4 paragraphs max)
- Be sensitive — this is a personal health topic`;

// ══════════════════════════════════════════════════════════════════
//  📊  BUILD DYNAMIC SYSTEM PROMPT FROM USER'S CYCLE DATA
//  Flutter app sends { message, context, history } in request body.
//  context = { averageCycleLength, averagePeriodLength,
//              lastPeriodStart, predictedNextPeriod,
//              recentSymptoms, cyclesLogged }
// ══════════════════════════════════════════════════════════════════
function buildSystemPrompt(context) {
  // No context sent → use base prompt only
  if (!context || Object.keys(context).length === 0) {
    return BASE_SYSTEM_PROMPT;
  }

  const lines = [];

  if (context.averageCycleLength) {
    lines.push(`- Average cycle length: ${context.averageCycleLength} days`);
  }
  if (context.averagePeriodLength) {
    lines.push(`- Average period duration: ${context.averagePeriodLength} days`);
  }
  if (context.lastPeriodStart) {
    const d = new Date(context.lastPeriodStart);
    if (!isNaN(d)) {
      const formatted = d.toLocaleDateString("en-IN", {
        day: "numeric", month: "long", year: "numeric"
      });
      lines.push(`- Last period started: ${formatted}`);
    }
  }
  if (context.predictedNextPeriod) {
    const d = new Date(context.predictedNextPeriod);
    if (!isNaN(d)) {
      const formatted = d.toLocaleDateString("en-IN", {
        day: "numeric", month: "long", year: "numeric"
      });
      lines.push(`- Predicted next period: ${formatted}`);
    }
  }
  if (Array.isArray(context.recentSymptoms) && context.recentSymptoms.length > 0) {
    lines.push(`- Recently logged symptoms: ${context.recentSymptoms.join(", ")}`);
  }
  if (context.cyclesLogged) {
    lines.push(`- Cycles logged so far: ${context.cyclesLogged}`);
  }

  if (lines.length === 0) return BASE_SYSTEM_PROMPT;

  return `${BASE_SYSTEM_PROMPT}

USER'S PERSONAL CYCLE DATA (use this to give personalized answers):
${lines.join("\n")}

When relevant, refer to this data naturally — e.g. "Based on your average 28-day cycle..." or "Since your last period started on [date]...". Do NOT dump all the data back verbatim. Only mention what's relevant to the question asked.`;
}

// ══════════════════════════════════════════════════════════════════
//  🔄  SMART FALLBACK ENGINE
// ══════════════════════════════════════════════════════════════════
async function smartCall(messages) {
  for (const key of availableKeys) {
    for (const model of MODELS) {
      try {
        const shortKey   = key.slice(-6);
        const shortModel = model.split("/")[1] || model;
        console.log(`🔄 Trying: ${shortModel} | Key: ...${shortKey}`);

        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type":  "application/json",
            "HTTP-Referer":  process.env.SITE_URL || "http://localhost:3000",
            "X-Title":       "Menstrual Health Chatbot",
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.65,
            max_tokens:  1200,
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
        return { reply: data.choices[0].message.content };

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
//  Accepts: { message: string, context?: object, history?: array }
// ══════════════════════════════════════════════════════════════════
app.post("/chat", async (req, res) => {
  try {
    // ← Added: context (cycle data from Flutter) alongside message & history
    const { message, context = {}, history = [] } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "Message required hai." });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: "Message bahut lamba hai." });
    }

    // Build personalized system prompt with user's cycle data
    const systemPrompt = buildSystemPrompt(context);

    // Log what context we received (helps debug)
    if (Object.keys(context).length > 0) {
      console.log("📊 Cycle context received:", JSON.stringify(context));
    }

    const messages = [
      { role: "system", content: systemPrompt },
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
