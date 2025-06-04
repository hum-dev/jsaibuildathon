import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import dotenv from "dotenv";

dotenv.config();

const endpoint = process.env.AZURE_INFERENCE_SDK_ENDPOINT.replace(
  "/openai/deployments/gpt-4o-mini/chat/completions?api-version=2024-08-01-preview",
  ""
);

const client = new ModelClient(
  endpoint,
  new AzureKeyCredential(process.env.AZURE_INFERENCE_API_KEY)
);

var messages = [
  { role: "system", content: "You are a helpful assistant" },
  { role: "user", content: "What are 3 things to see in Seattle?" },
];

try {
  var response = await client
    .path("/openai/deployments/gpt-4o-mini/chat/completions")
    .post({
      body: {
        messages: messages,
        max_tokens: 4096,
        temperature: 1,
        top_p: 1,
        model: "gpt-4o-mini",
      },
    });

  if (response.status === 404) {
    console.error("Error: Resource not found. Please check your endpoint URL.");
  } else if (!response.status.toString().startsWith("2")) {
    console.error("Error:", response.body);
  } else {
    console.log(response.body.choices[0].message.content);
  }
} catch (error) {
  console.error("Error occurred:", error.message);
}
