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
//  🏥  MEDICAL (menstrual health) SYSTEM PROMPT
//  ⚠️ This is the ORIGINAL prompt your medical/period-tracker app
//  already depends on. Its behavior is UNCHANGED — kept as the
//  default so that project keeps working with zero changes needed.
// ══════════════════════════════════════════════════════════════════
const MEDICAL_SYSTEM_PROMPT = `You are a compassionate, knowledgeable menstrual health assistant.

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
//  🌐  GENERAL-PURPOSE SYSTEM PROMPT (translation / general Q&A)
//  Used by this translation app (and any other non-medical caller)
//  by explicitly sending mode: "general" in the request body.
// ══════════════════════════════════════════════════════════════════
const GENERAL_SYSTEM_PROMPT = `You are a helpful, friendly general-purpose AI assistant.

ROLE:
- Answer questions, translate text between languages, explain concepts clearly, help draft writing, and assist with everyday tasks
- Be accurate, concise, and easy to understand
- If the user asks for a translation, return ONLY the translation (plus a short note on tone/register if genuinely useful) — don't over-explain unless asked

RULES:
- Do not assume the user is asking about health, medical, or menstrual topics unless they explicitly bring it up
- If a request is ambiguous, ask one short clarifying question instead of guessing
- Keep answers focused and free of unnecessary filler`;

// Backward-compatible default: no `mode` sent → medical prompt, exactly
// like before. This is what keeps the existing medical project working
// untouched.
const SYSTEM_PROMPTS = {
  medical: MEDICAL_SYSTEM_PROMPT,
  general: GENERAL_SYSTEM_PROMPT,
};

// ══════════════════════════════════════════════════════════════════
//  📊  BUILD DYNAMIC SYSTEM PROMPT FROM USER'S CYCLE DATA
//  Flutter app sends { message, context, history, mode? } in request body.
//  context = { averageCycleLength, averagePeriodLength,
//              lastPeriodStart, predictedNextPeriod,
//              recentSymptoms, cyclesLogged }
//  mode = "medical" (default, unchanged) | "general"
//  Cycle `context` is only ever applied on top of the medical prompt —
//  a "general" mode caller never gets medical framing injected.
// ══════════════════════════════════════════════════════════════════
function buildSystemPrompt(mode, context) {
  const basePrompt = SYSTEM_PROMPTS[mode] || SYSTEM_PROMPTS.medical;

  // General mode never gets cycle-data injection — it's not relevant.
  if (mode === "general") {
    return basePrompt;
  }

  // No context sent → use base medical prompt only
  if (!context || Object.keys(context).length === 0) {
    return basePrompt;
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

  if (lines.length === 0) return basePrompt;

  return `${basePrompt}

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
//  Accepts: { message: string, context?: object, history?: array, mode?: "medical" | "general" }
//  `mode` is OPTIONAL and defaults to "medical" — so the existing
//  medical project (which never sends `mode`) behaves exactly as
//  before. New/other projects (like this translation app) should
//  explicitly send mode: "general" to get non-medical answers.
// ══════════════════════════════════════════════════════════════════
app.post("/chat", async (req, res) => {
  try {
    const { message, context = {}, history = [], mode = "medical" } = req.body;

    if (!message || typeof message !== "string" || message.trim() === "") {
      return res.status(400).json({ error: "Message required hai." });
    }
    if (message.length > 5000) {
      return res.status(400).json({ error: "Message bahut lamba hai." });
    }
    if (!Array.isArray(history)) {
      return res.status(400).json({ error: "History array honi chahiye." });
    }

    const safeMode = SYSTEM_PROMPTS[mode] ? mode : "medical";

    // Build system prompt for the requesting project (medical vs general)
    const systemPrompt = buildSystemPrompt(safeMode, context);

    // Log what context/mode we received (helps debug across projects)
    console.log(`💬 mode=${safeMode}${Object.keys(context).length ? " | context: " + JSON.stringify(context) : ""}`);

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
    modes:        Object.keys(SYSTEM_PROMPTS),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Server → http://localhost:${PORT}`);
  console.log(`🔑 Keys: ${availableKeys.length} | 🤖 Models: ${MODELS.length}`);
  console.log(`🔄 Total combinations: ${availableKeys.length * MODELS.length}\n`);
});
