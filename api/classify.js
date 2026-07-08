import { classifyExpense } from "./_classify-core.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  const category = await classifyExpense(req.body || {}, process.env.GEMINI_API_KEY);
  res.status(200).json({ category });
}
