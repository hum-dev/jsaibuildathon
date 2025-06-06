import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
import { createSseStream } from "@azure/core-sse";

const endpoint = "https://aistudioaiservices611314380055.openai.azure.com";
const modelName = "gpt-4o-mini";

export async function main() {
  const client = new ModelClient(
    endpoint,
    new AzureKeyCredential(process.env.AZURE_INFERENCE_API_KEY || "<API_KEY>")
  );

  try {
    const response = await client
      .path("/openai/deployments/gpt-4o-mini/chat/completions")
      .post({
        body: {
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            {
              role: "user",
              content: "I am going to Paris, what should I see?",
            },
          ],
          max_tokens: 4096,
          temperature: 1,
          top_p: 1,
          model: modelName,
          stream: true,
        },
      })
      .asNodeStream();
    const stream = response.body;
    if (!stream) {
      throw new Error("The response stream is undefined");
    }

    if (response.status !== "200") {
      stream.destroy();
      throw new Error(
        `Failed to get chat completions, http operation failed with ${response.status} code`
      );
    }

    const sseStream = createSseStream(stream);

    for await (const event of sseStream) {
      if (event.data === "[DONE]") {
        return;
      }
      for (const choice of JSON.parse(event.data).choices) {
        process.stdout.write(choice.delta?.content ?? ``);
      }
    }
  } catch (err) {
    console.error("The sample encountered an error:", err);
  }
}

main().catch((err) => {
  console.error("The sample encountered an error:", err);
});
