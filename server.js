require("dotenv").config();

const express = require("express");
const cors = require("cors"); 
const fetch = require("node-fetch");

const app = express();
app.use(cors());
app.use(express.json());

const API_KEY = process.env.API_KEY;

app.post("/chat", async (req, res) => {
  try {
    const userMessage = req.body.message;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "chatbot-app"
      },
      body: JSON.stringify({
        model: "qwen/qwen3.6-plus:free",
        messages: [
          { role: "user", content: userMessage }
        ]
      })
    });

    const data = await response.json();

    console.log("API RESPONSE:", data); // 🔥 ADD THIS

    if (!data.choices) {
      console.log("FULL ERROR:", data);
      return res.json({ error: data }); // 🔥 show real error
    }

    if (data.choices && data.choices.length > 0) {
  res.json({
    reply: data.choices[0].message.content
  });
} else {
  console.log("API ERROR:", data);
  res.json({
    reply: "Error from AI"
  });
}

  } catch (error) {
    console.log("ERROR:", error); // 🔥 ADD THIS
    res.status(500).json({ error: "Error occurred" });
  }
});
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});