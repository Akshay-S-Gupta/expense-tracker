export default async function handler(req, res) {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
  
    const { description, amount, nature, categories } = req.body;
  
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: `Classify this expense into exactly one of: ${categories}.\nDescription: "${description}"\nAmount: ₹${amount}\nNature: ${nature}\nRespond with ONLY the category id, nothing else.`
              }]
            }]
          })
        }
      );
  
      const data = await response.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() || "other";
      const category = categories.split(", ").find(c => c === raw) || "other";
      res.status(200).json({ category });
    } catch (e) {
      res.status(200).json({ category: "other" });
    }
  }