// Shared Gemini classification logic, used by the Vercel function (api/classify.js)
// and the local dev endpoint (vite.config.js).
// Files starting with "_" inside api/ are not deployed as serverless functions by Vercel.

// Tried in order; if a model has been retired or is unavailable, the next one is used.
const MODELS = ["gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash"];

export async function classifyExpense({ description, amount, nature, categories }, apiKey) {
  if (!apiKey) return "other";
  const ids = String(categories || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (ids.length === 0) return "other";

  const prompt = `Classify this expense into exactly one of: ${ids.join(", ")}.\nDescription: "${description}"\nAmount: ₹${amount}\nNature: ${nature}\nRespond with ONLY the category id, nothing else.`;

  for (const model of MODELS) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        }
      );
      if (!response.ok) continue; // model retired or unavailable, try the next one
      const data = await response.json();
      const raw = (data.candidates?.[0]?.content?.parts?.[0]?.text || "").trim().toLowerCase();
      const cleaned = raw.replace(/[^a-z]/g, ""); // strips backticks, quotes, periods, whitespace
      const match = ids.find(c => c === cleaned) || ids.find(c => cleaned.includes(c));
      return match || "other";
    } catch {
      // network or parse error, try the next model
    }
  }
  return "other";
}
