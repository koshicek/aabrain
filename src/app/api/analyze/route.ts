import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export async function POST(req: NextRequest) {
  try {
    const { data, teamName, dateRange, language, apiKey: clientKey, model } =
      await req.json();

    const apiKey = process.env.ANTHROPIC_API_KEY || clientKey;
    if (!apiKey) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured. Set it in .env or provide via Settings." },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey });

    const lang = language === "cs" ? "Czech" : "English";

    const prompt = `You are a digital advertising analyst preparing a client report for ${teamName}.

Analyze this AlzaAds campaign performance data for ${dateRange}:

${data}

Provide:
1. Executive summary (2-3 sentences)
2. Key trends (what's improving, what's declining)
3. Top performing campaigns and why
4. Areas of concern
5. Recommended actions for the next period

Write in a professional but accessible tone. Use specific numbers from the data.
Language: ${lang}`;

    const message = await client.messages.create({
      model: model || "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const text =
      message.content[0].type === "text" ? message.content[0].text : "";

    return NextResponse.json({ analysis: text });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Analysis failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
