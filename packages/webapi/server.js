import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = path.resolve(__dirname, "../..");
const pdfPath = path.join(
  projectRoot,
  "data/humtech-company-12-sample-handbook_final.pdf"
);

const client = new ModelClient(
  process.env.AZURE_INFERENCE_SDK_ENDPOINT,
  new AzureKeyCredential(process.env.AZURE_INFERENCE_API_KEY),
  {
    apiVersion: "2023-12-01-preview",
  }
);

let pdfText = null;
let pdfChunks = [];
const CHUNK_SIZE = 800;

async function loadPDF() {
  if (pdfText) return pdfText;

  if (!fs.existsSync(pdfPath)) return "PDF not found.";

  const dataBuffer = fs.readFileSync(pdfPath);
  const data = await pdfParse(dataBuffer);
  pdfText = data.text;
  let currentChunk = "";
  const words = pdfText.split(/\s+/);

  for (const word of words) {
    if ((currentChunk + " " + word).length <= CHUNK_SIZE) {
      currentChunk += (currentChunk ? " " : "") + word;
    } else {
      pdfChunks.push(currentChunk);
      currentChunk = word;
    }
  }
  if (currentChunk) pdfChunks.push(currentChunk);
  return pdfText;
}

function retrieveRelevantContent(query) {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/) // Converts query to relevant search terms
    .filter((term) => term.length > 3)
    .map((term) => term.replace(/[.,?!;:()"']/g, ""));

  if (queryTerms.length === 0) return [];
  const scoredChunks = pdfChunks.map((chunk) => {
    const chunkLower = chunk.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const regex = new RegExp(term, "gi");
      const matches = chunkLower.match(regex);
      if (matches) score += matches.length;
    }
    return { chunk, score };
  });
  return scoredChunks
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => item.chunk);
}

app.post("/chat", async (req, res) => {
  console.log("Received request body:", req.body);
  const userMessage = req.body.message;
  const useRAG = req.body.useRAG === undefined ? true : req.body.useRAG;
  let messages = [];
  let sources = [];
  if (useRAG) {
    console.log("Loading PDF...");
    await loadPDF();
    console.log("Retrieving relevant content for query:", userMessage);
    sources = retrieveRelevantContent(userMessage);
    console.log("Found sources:", sources);
    if (sources.length > 0) {
      messages.push({
        role: "system",
        content: `You are a helpful assistant answering questions about the company based on its employee handbook.
        Use ONLY the following information from the handbook to answer the user's question.
        If you can't find relevant information in the provided context, say so clearly.
        --- EMPLOYEE HANDBOOK EXCERPTS ---
        ${sources.join("\n\n")}
        --- END OF EXCERPTS ---`,
      });
    } else {
      messages.push({
        role: "system",
        content:
          "You are a helpful assistant. No relevant information was found in the employee handbook for this question.",
      });
    }
  } else {
    messages.push({
      role: "system",
      content: "You are a helpful assistant.",
    });
  }
  messages.push({ role: "user", content: userMessage });
  try {
    // Validate environment variables
    if (
      !process.env.AZURE_INFERENCE_SDK_ENDPOINT ||
      !process.env.AZURE_INFERENCE_API_KEY ||
      !process.env.AZURE_DEPLOYMENT_NAME
    ) {
      throw new Error(
        "Missing required Azure OpenAI configuration. Please check your .env file."
      );
    }

    console.log("Sending request to Azure OpenAI with messages:", messages);
    console.log("Using endpoint:", process.env.AZURE_INFERENCE_SDK_ENDPOINT);
    console.log(
      "API key starts with:",
      process.env.AZURE_INFERENCE_API_KEY?.substring(0, 5)
    );
    console.log("Making request to Azure OpenAI...");
    const deploymentName = process.env.AZURE_DEPLOYMENT_NAME;
    console.log("Deployment name:", deploymentName);
    const apiPath = `/chat/completions`;
    console.log("API path:", apiPath);
    const requestBody = {
      model: deploymentName,
      messages: messages,
      temperature: 0.7,
      max_tokens: 4000,
      n: 1,
    };
    console.log("Request body:", JSON.stringify(requestBody, null, 2));

    const response = await client.path(apiPath).post({
      body: requestBody,
    });
    console.log("Received response from Azure OpenAI:", response.body);
    if (isUnexpected(response)) {
      console.error(
        "Unexpected response:",
        JSON.stringify(response.body, null, 2)
      );
      throw {
        status: response.status,
        statusText: response.statusText,
        body: response.body,
        headers: response.headers,
      };
    }
    if (!response.body?.choices?.[0]?.message?.content) {
      console.error(
        "Invalid response format:",
        JSON.stringify(response.body, null, 2)
      );
      throw new Error("Invalid response format from Azure OpenAI");
    }
    res.json({
      reply: response.body.choices[0].message.content,
      sources: useRAG ? sources : [],
    });
  } catch (err) {
    console.error("Error encountered:", err);
    console.error("Error stack:", err.stack);
    console.error("Status code:", err.status);
    console.error("Headers:", err.headers);
    console.error("Response body:", err.body);

    // Try to extract the most meaningful error message
    let errorMessage = "Unknown error occurred";
    let errorCode = "UNKNOWN_ERROR";
    let errorDetails = null;

    if (err.body?.error) {
      // Azure OpenAI specific error format
      errorMessage = err.body.error.message || errorMessage;
      errorCode = err.body.error.code || errorCode;
      errorDetails = err.body.error;
    } else if (err.status) {
      // HTTP error
      errorMessage = `HTTP ${err.status}: ${
        err.statusText || "Unknown HTTP error"
      }`;
      errorCode = `HTTP_${err.status}`;
      errorDetails = {
        status: err.status,
        statusText: err.statusText,
        headers: err.headers,
        body: err.body,
      };
    } else if (err.message) {
      // Generic error
      errorMessage = err.message;
      errorCode = "SERVER_ERROR";
      errorDetails = err;
    }

    console.error(`${errorCode}: ${errorMessage}`);
    if (errorDetails) {
      console.error("Details:", JSON.stringify(errorDetails, null, 2));
    }

    res.status(500).json({
      error: "Model call failed",
      message: errorMessage,
      code: errorCode,
      details: errorDetails,
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`AI API server running on port ${PORT}`);
});
