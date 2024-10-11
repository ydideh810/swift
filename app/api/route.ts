import { headers } from "next/headers";
import { z } from "zod";
import { zfd } from "zod-form-data";
import { unstable_after as after } from "next/server";

// Gladia API URL and Arli AI Endpoint
const GLADIA_URL = "https://api.gladia.io/v2/upload";
const ARLIAI_URL = "https://api.arliai.com/v1/chat/completions";

// Schema validation
const schema = zfd.formData({
	input: z.union([zfd.text(), zfd.file()]),
	message: zfd.repeatableOfType(
		zfd.json(
			z.object({
				role: z.enum(["user", "assistant"]),
				content: z.string(),
			})
		)
	),
});

export async function POST(request: Request) {
	console.time("transcribe " + request.headers.get("x-vercel-id") || "local");

	const { data, success } = schema.safeParse(await request.formData());
	if (!success) return new Response("Invalid request", { status: 400 });

	const transcript = await getTranscript(data.input);
	if (!transcript) return new Response("Invalid audio", { status: 400 });

	console.timeEnd(
		"transcribe " + request.headers.get("x-vercel-id") || "local"
	);
	console.time(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	// Replace Llama3 with Arli AI for conversation response
	const completion = await fetch(ARLIAI_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.ARLI_AI_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			model: "Meta-Llama-3.1-8B-Instruct",
			prompt: transcript,
			messages: [
				{
					role: "system",
					content: `- You are NIDAAM, an advanced AI assistant. Be helpful and concise.`,
				},
				...data.message,
				{
					role: "user",
					content: transcript,
				},
			],
		}),
	});
	const result = await completion.json();
	const response = result.response;

	console.timeEnd(
		"text completion " + request.headers.get("x-vercel-id") || "local"
	);

	console.time(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	// Cartesia Sonic TTS remains the same
	const voice = await fetch("https://api.cartesia.ai/tts/bytes", {
		method: "POST",
		headers: {
			"Cartesia-Version": "2024-06-30",
			"Content-Type": "application/json",
			"X-API-Key": process.env.CARTESIA_API_KEY!,
		},
		body: JSON.stringify({
			model_id: "sonic-english",
			transcript: response,
			voice: {
				mode: "id",
				id: "79a125e8-cd45-4c13-8a67-188112f4dd22",
			},
			output_format: {
				container: "raw",
				encoding: "pcm_f32le",
				sample_rate: 24000,
			},
		}),
	});

	console.timeEnd(
		"cartesia request " + request.headers.get("x-vercel-id") || "local"
	);

	if (!voice.ok) {
		console.error(await voice.text());
		return new Response("Voice synthesis failed", { status: 500 });
	}

	console.time("stream " + request.headers.get("x-vercel-id") || "local");
	after(() => {
		console.timeEnd(
			"stream " + request.headers.get("x-vercel-id") || "local"
		);
	});

	return new Response(voice.body, {
		headers: {
			"X-Transcript": encodeURIComponent(transcript),
			"X-Response": encodeURIComponent(response),
		},
	});
}

// Replaced Whisper with Gladia for transcription
async function getTranscript(input: string | File) {
	if (typeof input === "string") return input;

	try {
		const formData = new FormData();
		formData.append("audio", input);

		const response = await fetch(GLADIA_URL, {
			method: "POST",
			headers: {
				x-gladia-key: `Bearer ${process.env.GLADIA_API_KEY}`,
			},
			body: formData,
		});

		const result = await response.json();
		return result.text.trim() || null;
	} catch {
		return null;
	}
}

// Location and time remain unchanged
function location() {
	const headersList = headers();

	const country = headersList.get("x-vercel-ip-country");
	const region = headersList.get("x-vercel-ip-country-region");
	const city = headersList.get("x-vercel-ip-city");

	if (!country || !region || !city) return "unknown";

	return `${city}, ${region}, ${country}`;
}

function time() {
	return new Date().toLocaleString("en-US", {
		timeZone: headers().get("x-vercel-ip-timezone") || undefined,
	});
}
