import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useState } from "react";

// ---------------------------------------------------------------------------
// Server function: calls the NVIDIA API to compress the user's prompt.
// The API key stays server-side — never exposed to the browser.
// ---------------------------------------------------------------------------

type CrunchInput = { text: string; apiKey: string };
type CrunchResult =
  | { ok: true; compressed: string; originalTokens: number; compressedTokens: number }
  | { ok: false; error: string };

const crunchPrompt = createServerFn({ method: "POST" }).handler(
  async ({ data }: { data: CrunchInput }): Promise<CrunchResult> => {
    const { text, apiKey } = data;

    if (!text.trim()) {
      return { ok: false, error: "Please enter some text to compress." };
    }
    if (!apiKey.trim()) {
      return { ok: false, error: "An NVIDIA API key is required. Get one at build.nvidia.com." };
    }

    const systemPrompt = `You are a prompt compression engine. Your job is to take user-provided text — which may include chat messages, instructions, rambling context, or multiple paragraphs — and compress it into a single, dense, token-efficient prompt.

Rules:
- Preserve ALL meaning, intent, nuance, key details, tone, and personality.
- Remove fluff, filler words, redundancies, pleasantries, and anything that doesn't add semantic value.
- If the input contains multiple messages or turns, distill them into one coherent prompt that captures the full context.
- Output ONLY the compressed prompt. No explanations. No meta-commentary. No markdown fences. No "Here is your compressed prompt" — just the compressed text, raw.`;

    try {
      const response = await fetch(
        "https://integrate.api.nvidia.com/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "nvidia/llama-3.1-nemotron-ultra-8b-instruct",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: text },
            ],
            temperature: 0.2,
            max_tokens: 4096,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        let msg = `API error (${response.status})`;
        try {
          const parsed = JSON.parse(body);
          if (parsed.error?.message) msg = parsed.error.message;
        } catch {}
        return { ok: false, error: msg };
      }

      const json = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const compressed =
        json.choices?.[0]?.message?.content?.trim() ?? "";

      if (!compressed) {
        return { ok: false, error: "The API returned an empty response. Try again." };
      }

      const originalTokens = Math.ceil(text.length / 4);
      const compressedTokens = Math.ceil(compressed.length / 4);

      return { ok: true, compressed, originalTokens, compressedTokens };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "An unexpected error occurred.";
      return { ok: false, error: message };
    }
  }
);

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const [input, setInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CrunchResult | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCrunch = async () => {
    setCopied(false);
    if (!input.trim()) {
      setResult({ ok: false, error: "Please enter some text to compress." });
      return;
    }
    if (!apiKey.trim()) {
      setResult({
        ok: false,
        error: "An NVIDIA API key is required. Get one at build.nvidia.com.",
      });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const res = await crunchPrompt({ data: { text: input, apiKey } });
      setResult(res);
    } catch {
      setResult({ ok: false, error: "An unexpected error occurred." });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result?.ok) return;
    try {
      await navigator.clipboard.writeText(result.compressed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard may not be available
    }
  };

  const savingsPct =
    result?.ok && result.originalTokens > 0
      ? Math.round(
          ((result.originalTokens - result.compressedTokens) /
            result.originalTokens) *
            100
        )
      : 0;

  return (
    <div className="flex min-h-dvh flex-col bg-gray-950 text-gray-100">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-5">
        <div className="mx-auto flex max-w-3xl items-baseline gap-3">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            PromptCrunch
          </h1>
          <span className="text-sm text-gray-500">
            Lossless compression for language
          </span>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col gap-6 px-6 py-8">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          {/* Input section */}
          <section className="flex flex-col gap-3">
            <label
              htmlFor="prompt-input"
              className="text-sm font-medium text-gray-300"
            >
              Paste your prompt(s) here
            </label>
            <textarea
              id="prompt-input"
              rows={10}
              placeholder="Paste one or more chat messages, instructions, or any text you want compressed..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              className="w-full resize-y rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-100 placeholder-gray-500 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            />
          </section>

          {/* API Key section */}
          <section className="flex flex-col gap-3">
            <label
              htmlFor="api-key"
              className="text-sm font-medium text-gray-300"
            >
              NVIDIA API Key
            </label>
            <div className="relative">
              <input
                id="api-key"
                type={showKey ? "text" : "password"}
                placeholder="nvapi-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 pr-12 text-sm text-gray-100 placeholder-gray-500 outline-none transition focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 transition hover:text-gray-300"
                aria-label={showKey ? "Hide API key" : "Show API key"}
              >
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
            <p className="text-xs text-gray-600">
              Your key is only used server-side and never exposed to the browser.
              Get one at{" "}
              <a
                href="https://build.nvidia.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-400 underline hover:text-indigo-300"
              >
                build.nvidia.com
              </a>
              .
            </p>
          </section>

          {/* Crunch button */}
          <button
            type="button"
            onClick={handleCrunch}
            disabled={loading}
            className="flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Spinner />
                Crunching...
              </>
            ) : (
              "Crunch"
            )}
          </button>

          {/* Error display */}
          {result && !result.ok && (
            <div className="rounded-lg border border-red-800 bg-red-950/50 px-4 py-3 text-sm text-red-300">
              {result.error}
            </div>
          )}

          {/* Output section */}
          {result?.ok && (
            <section className="flex flex-col gap-3">
              <label className="text-sm font-medium text-gray-300">
                Compressed Prompt
              </label>
              <div className="rounded-lg border border-gray-700 bg-gray-900 px-4 py-3">
                <pre className="whitespace-pre-wrap text-sm text-gray-100 font-sans">
                  {result.compressed}
                </pre>
              </div>

              {/* Stats row */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
                <span>
                  Original: ~{result.originalTokens.toLocaleString()} tokens
                </span>
                <span className="text-gray-600">→</span>
                <span>
                  Compressed: ~{result.compressedTokens.toLocaleString()} tokens
                </span>
                <span
                  className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${
                    savingsPct > 0
                      ? "bg-green-950 text-green-400"
                      : "bg-gray-800 text-gray-500"
                  }`}
                >
                  {savingsPct > 0 ? `−${savingsPct}%` : "0%"}
                </span>
              </div>

              {/* Copy button */}
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-2 self-start rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-600 hover:text-white"
              >
                {copied ? (
                  <>
                    <CheckIcon />
                    Copied!
                  </>
                ) : (
                  <>
                    <CopyIcon />
                    Copy
                  </>
                )}
              </button>
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-4 text-center text-xs text-gray-600">
        Built with{" "}
        <a
          href="https://cto.new"
          className="underline hover:text-gray-400"
        >
          cto.new
        </a>
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiny inline icons (no extra dependency)
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
