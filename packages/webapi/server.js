import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Serve static files from the webapp directory
app.use(express.static("../webapp"));

// Root route handler
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "../webapp" });
});

const client = new ModelClient(
  process.env.AZURE_INFERENCE_SDK_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_INFERENCE_API_KEY)
);

app.post("/chat", async (req, res) => {
  console.log("Received chat request:", req.body);
  const userMessage = req.body.message;
  const messages = [
    { role: "system", content: "You are a helpful assistant" },
    { role: "user", content: userMessage },
  ];
  console.log("Sending messages to Azure:", messages);
  try {
    const response = await client
      .path("/openai/deployments/gpt-4/chat/completions")
      .post({
        body: {
          messages,
          max_tokens: 4096,
          temperature: 1,
          top_p: 1,
        },
      });

    console.log("Azure AI Response:", JSON.stringify(response.body, null, 2));

    if (!response.body || !response.body.choices || !response.body.choices[0]) {
      throw new Error("Unexpected response format from Azure AI");
    }

    res.json({ reply: response.body.choices[0].message.content });
  } catch (err) {
    console.error("Error details:", err);
    res.status(500).json({ error: err.message || "Model call failed" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AI API server running on port ${PORT}`);
});
