import { useState, useMemo, useEffect } from "react";
import { db } from "./firebase";
import {
  collection, addDoc, deleteDoc,
  doc, onSnapshot, query, orderBy
} from "firebase/firestore";

const CATEGORIES = [
  { id: "housing", label: "Housing", color: "#6366f1", icon: "🏠" },
  { id: "food", label: "Food & Dining", color: "#f59e0b", icon: "🍽️" },
  { id: "transport", label: "Transport", color: "#10b981", icon: "🚗" },
  { id: "health", label: "Health", color: "#ef4444", icon: "❤️" },
  { id: "entertainment", label: "Entertainment", color: "#8b5cf6", icon: "🎬" },
  { id: "shopping", label: "Shopping", color: "#ec4899", icon: "🛍️" },
  { id: "utilities", label: "Utilities", color: "#14b8a6", icon: "⚡" },
  { id: "savings", label: "Savings", color: "#84cc16", icon: "💰" },
  { id: "other", label: "Other", color: "#94a3b8", icon: "📦" },
];

const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");

function DonutChart({ segments, total, size = 180 }) {
  const r = size * 0.36, cx = size / 2, cy = size / 2;
  const circ = 2 * Math.PI * r;
  let cum = 0;
  const slices = segments.filter(s => s.value > 0).map(s => {
    const frac = total > 0 ? s.value / total : 0;
    const dash = frac * circ, gap = circ - dash;
    const offset = circ - cum * circ;
    cum += frac;
    return { ...s, dash, gap, offset };
  });
  const sw = size * 0.13;
  const ir = r - sw * 0.6;
  return (
    <div style={{ position: "relative", width: size, height: size, margin: "0 auto" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        {total === 0
          ? <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1e293b" strokeWidth={sw} />
          : slices.map(s => (
            <circle key={s.id} cx={cx} cy={cy} r={r} fill="none"
              stroke={s.color} strokeWidth={sw}
              strokeDasharray={`${s.dash} ${s.gap}`}
              strokeDashoffset={s.offset}
              style={{ transition: "stroke-dasharray 0.5s ease, stroke-dashoffset 0.5s ease" }} />
          ))}
        <circle cx={cx} cy={cy} r={ir} fill="#0f172a" />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: size * 0.055, color: "#64748b", letterSpacing: 1.5, textTransform: "uppercase" }}>Total</span>
        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: size * 0.1, color: "#f1f5f9", fontWeight: 700, marginTop: 2 }}>{fmt(total)}</span>
      </div>
    </div>
  );
}

function Bar({ pct, color }) {
  return (
    <div style={{ height: 5, background: "#1e293b", borderRadius: 3, overflow: "hidden", flex: 1 }}>
      <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: color, borderRadius: 3, transition: "width 0.4s ease" }} />
    </div>
  );
}

// ---- Summary panel (shared between mobile overview and desktop sidebar) ----
function SummaryPanel({ segments, catTotals, total, incomeVal, remaining, savingsRate, needsTotal, wantsTotal, topCat, monthLabel, donutSize }) {
  return (
    <>
      {/* Donut */}
      <div style={{ background: "#1e293b", borderRadius: 16, padding: "20px 16px 16px", marginBottom: 12, border: "1px solid #334155" }}>
        <p style={{ margin: "0 0 14px", fontSize: 10, letterSpacing: 2, color: "#475569", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", textAlign: "center" }}>{monthLabel}</p>
        <DonutChart segments={segments} total={total} size={donutSize} />
        <div style={{ marginTop: 16, display: "grid", gap: 7 }}>
          {CATEGORIES.filter(c => catTotals[c.id] > 0).sort((a, b) => catTotals[b.id] - catTotals[a.id]).map(cat => (
            <div key={cat.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: cat.color, flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cat.label}</span>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "#e2e8f0", fontWeight: 600 }}>{fmt(catTotals[cat.id])}</span>
            </div>
          ))}
          {total === 0 && <p style={{ textAlign: "center", color: "#334155", fontSize: 12, margin: "4px 0 0" }}>Add expenses to see breakdown</p>}
        </div>
      </div>

      {/* Wants vs Needs */}
      {total > 0 && (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 16px", marginBottom: 12, border: "1px solid #334155" }}>
          <p style={{ margin: "0 0 10px", fontSize: 10, letterSpacing: 2, color: "#475569", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Wants vs Needs</p>
          <div style={{ display: "grid", gap: 8 }}>
            {[["Needs", "#10b981", needsTotal], ["Wants", "#8b5cf6", wantsTotal]].map(([lbl, col, val]) => (
              <div key={lbl}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, color: "#94a3b8" }}>{lbl}</span>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, color: col, fontWeight: 600 }}>{fmt(val)}</span>
                </div>
                <Bar pct={total > 0 ? (val / total) * 100 : 0} color={col} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stat pills */}
      <div style={{ display: "grid", gap: 8 }}>
        {incomeVal > 0 && (
          <div style={{ background: remaining >= 0 ? "#052e16" : "#2d1515", border: `1px solid ${remaining >= 0 ? "#166534" : "#7f1d1d"}`, borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{remaining >= 0 ? "Remaining" : "Over budget"}</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, color: remaining >= 0 ? "#4ade80" : "#f87171" }}>{fmt(Math.abs(remaining))}</span>
          </div>
        )}
        {savingsRate !== null && (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Savings rate</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, color: savingsRate >= 20 ? "#4ade80" : savingsRate >= 10 ? "#f59e0b" : "#f87171" }}>{savingsRate.toFixed(1)}%</span>
          </div>
        )}
        {topCat && total > 0 && (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Top expense</span>
            <span style={{ fontSize: 12, color: "#e2e8f0", display: "flex", alignItems: "center", gap: 5 }}>{topCat.icon} {topCat.label}</span>
          </div>
        )}
        <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Month total</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, color: "#f59e0b" }}>{fmt(total)}</span>
        </div>
        {total > 0 && (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Daily avg</span>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 13, fontWeight: 600, color: "#cbd5e1" }}>{fmt(total / 30)}/day</span>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const [income, setIncome] = useState("");
  const [entries, setEntries] = useState([]);

  useEffect(() => {
    const q = query(collection(db, "entries"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setEntries(data);
    });
    return () => unsub();
  }, []); const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [nature, setNature] = useState("need");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mobileTab, setMobileTab] = useState("add"); // "overview" | "add" | "history"
  const [month, setMonth] = useState(() => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
  });

  const monthLabel = new Date(month + "-02").toLocaleString("default", { month: "long", year: "numeric" });

  const monthEntries = useMemo(() => entries.filter(e => e.date.startsWith(month)), [entries, month]);

  const catTotals = useMemo(() => {
    const t = Object.fromEntries(CATEGORIES.map(c => [c.id, 0]));
    monthEntries.forEach(e => { t[e.category] = (t[e.category] || 0) + e.amount; });
    return t;
  }, [monthEntries]);

  const total = useMemo(() => Object.values(catTotals).reduce((a, b) => a + b, 0), [catTotals]);
  const incomeVal = parseFloat(income) || 0;
  const remaining = incomeVal - total;
  const savingsRate = incomeVal > 0 ? ((incomeVal - total) / incomeVal) * 100 : null;
  const wantsTotal = useMemo(() => monthEntries.filter(e => e.nature === "want").reduce((a, e) => a + e.amount, 0), [monthEntries]);
  const needsTotal = useMemo(() => monthEntries.filter(e => e.nature === "need").reduce((a, e) => a + e.amount, 0), [monthEntries]);
  const topCat = useMemo(() => {
    if (total === 0) return null;
    return CATEGORIES.reduce((best, c) => catTotals[c.id] > catTotals[best.id] ? c : best);
  }, [catTotals, total]);
  const segments = CATEGORIES.map(c => ({ ...c, value: catTotals[c.id] }));
  const getCat = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[CATEGORIES.length - 1];

  // async function handleAdd() {
  //   if (!desc.trim() || !amount || parseFloat(amount) <= 0) {
  //     setError("Enter what you spent on and the amount."); return;
  //   }
  //   setError(""); setLoading(true);
  //   try {
  //     const ids = CATEGORIES.map(c => c.id).join(", ");
  //     const prompt = `Classify this expense into exactly one of: ${ids}.\nDescription: "${desc.trim()}"\nAmount: ₹${amount}\nNature: ${nature === "need" ? "Need" : "Want"}\nRespond with ONLY the category id.`;
  //     const res = await fetch("https://api.anthropic.com/v1/messages", {
  //       method: "POST", headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 20, messages: [{ role: "user", content: prompt }] })
  //     });
  //     const data = await res.json();
  //     const raw = data.content?.[0]?.text?.trim().toLowerCase() || "other";
  //     const category = CATEGORIES.find(c => c.id === raw)?.id || "other";
  //     const entry = {
  //       desc: desc.trim(),
  //       amount: parseFloat(amount),
  //       nature,
  //       category,
  //       date: new Date().toISOString().slice(0, 10),
  //       time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  //       createdAt: Date.now()
  //     };
  //     await addDoc(collection(db, "entries"), entry);
  //     setDesc(""); setAmount(""); setNature("need");
  //     setMobileTab("history");
  //   } catch {
  //     const entry = {
  //       desc: desc.trim(),
  //       amount: parseFloat(amount),
  //       nature,
  //       category,
  //       date: new Date().toISOString().slice(0, 10),
  //       time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
  //       createdAt: Date.now()
  //     };
  //     await addDoc(collection(db, "entries"), entry);
  //     setDesc(""); setAmount(""); setNature("need");
  //   } finally { setLoading(false); }
  // }

  async function handleAdd() {
    if (!desc.trim() || !amount || parseFloat(amount) <= 0) {
      setError("Enter what you spent on and the amount."); return;
    }
    setError(""); setLoading(true);

    let category = "other";

    try {
      const ids = CATEGORIES.map(c => c.id).join(", ");
      const prompt = `Classify this expense into exactly one of: ${ids}.\nDescription: "${desc.trim()}"\nAmount: ₹${amount}\nNature: ${nature === "need" ? "Need" : "Want"}\nRespond with ONLY the category id.`;
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 20,
          messages: [{ role: "user", content: prompt }]
        })
      });
      const data = await res.json();
      const raw = data.content?.[0]?.text?.trim().toLowerCase() || "other";
      category = CATEGORIES.find(c => c.id === raw)?.id || "other";
    } catch {
      // CORS in local dev or network error — category stays "other"
    }

    try {
      const entry = {
        desc: desc.trim(),
        amount: parseFloat(amount),
        nature,
        category,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        createdAt: Date.now()
      };
      await addDoc(collection(db, "entries"), entry);
      setDesc(""); setAmount(""); setNature("need");
      setMobileTab("history");
    } catch (e) {
      setError("Could not save entry. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(id) {
    await deleteDoc(doc(db, "entries", id));
  }

  const summaryProps = { segments, catTotals, total, incomeVal, remaining, savingsRate, needsTotal, wantsTotal, topCat, monthLabel };

  const AddForm = (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Income */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 16px", border: "1px solid #334155", display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ fontSize: 20 }}>💵</span>
        <div style={{ flex: 1 }}>
          <label style={{ fontSize: 10, letterSpacing: 1.5, color: "#64748b", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", display: "block", marginBottom: 3 }}>Monthly Income</label>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ color: "#64748b", fontFamily: "'JetBrains Mono',monospace", fontSize: 16 }}>₹</span>
            <input type="number" placeholder="0" value={income} onChange={e => setIncome(e.target.value)}
              style={{ background: "transparent", border: "none", color: "#84cc16", fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700, width: "100%", outline: "none" }} />
          </div>
        </div>
      </div>

      {/* Log spend */}
      <div style={{ background: "#1e293b", borderRadius: 14, padding: "16px", border: "1px solid #334155" }}>
        <p style={{ margin: "0 0 12px", fontSize: 10, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Log a Spend</p>
        <input placeholder="What did you spend on? e.g. Swiggy biryani..."
          value={desc} onChange={e => setDesc(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleAdd()}
          style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "11px 13px", color: "#e2e8f0", fontSize: 15, outline: "none", marginBottom: 10 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 13px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#64748b", fontFamily: "'JetBrains Mono',monospace", fontSize: 16 }}>₹</span>
            <input type="number" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAdd()}
              style={{ background: "transparent", border: "none", color: "#f59e0b", fontFamily: "'JetBrains Mono',monospace", fontSize: 19, fontWeight: 700, width: "100%", outline: "none" }} />
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {["need", "want"].map(n => (
              <button key={n} onClick={() => setNature(n)} style={{
                padding: "8px 12px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 13, fontWeight: 600,
                background: nature === n ? (n === "need" ? "#10b981" : "#8b5cf6") : "transparent",
                borderColor: nature === n ? (n === "need" ? "#10b981" : "#8b5cf6") : "#334155",
                color: nature === n ? "#fff" : "#64748b", transition: "all 0.2s"
              }}>{n === "need" ? "🧾 Need" : "✨ Want"}</button>
            ))}
          </div>
        </div>
        {error && <p style={{ margin: "0 0 8px", color: "#f87171", fontSize: 12 }}>{error}</p>}
        <button onClick={handleAdd} disabled={loading} style={{
          width: "100%", background: "#4338ca", border: "none", borderRadius: 8, padding: "12px",
          color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", letterSpacing: 0.3,
          opacity: loading ? 0.7 : 1, transition: "background 0.2s"
        }}>{loading ? "Categorising..." : "+ Add Expense"}</button>
      </div>
    </div>
  );

  const FeedPanel = (
    <div>
      <p style={{ margin: "0 0 10px", fontSize: 10, letterSpacing: 2, color: "#475569", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>
        {monthLabel} — {monthEntries.length} {monthEntries.length === 1 ? "entry" : "entries"}
      </p>
      {monthEntries.length === 0
        ? <div style={{ background: "#1e293b", borderRadius: 12, padding: "32px 20px", textAlign: "center", color: "#334155", fontSize: 14 }}>No expenses logged yet.</div>
        : <div style={{ display: "grid", gap: 8 }}>
          {monthEntries.map(e => {
            const cat = getCat(e.category);
            return (
              <div key={e.id} className="entry-row"
                style={{ background: "#1e293b", borderRadius: 10, padding: "12px 14px", border: `1px solid ${cat.color}22`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{cat.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "calc(100% - 60px)" }}>{e.desc}</span>
                    <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 20, flexShrink: 0,
                      background: e.nature === "need" ? "#052e16" : "#2e1065",
                      color: e.nature === "need" ? "#4ade80" : "#a78bfa"
                    }}>{e.nature === "need" ? "Need" : "Want"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: cat.color }}>{cat.label}</span>
                    <span style={{ fontSize: 11, color: "#475569" }}>{e.date} {e.time}</span>
                  </div>
                </div>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: "#f8fafc", flexShrink: 0 }}>{fmt(e.amount)}</span>
                <button className="del-btn" onClick={() => deleteEntry(e.id)}
                  style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            );
          })}
        </div>
      }
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "#0f172a", color: "#f1f5f9", fontFamily: "'Inter',system-ui,sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        input[type=number]::-webkit-inner-spin-button{-webkit-appearance:none}
        input::placeholder{color:#334155}
        input[type="month"]::-webkit-calendar-picker-indicator{filter:invert(0.4);cursor:pointer}
        .del-btn{opacity:0;transition:opacity 0.15s}
        .entry-row:hover .del-btn{opacity:1}
        @media(max-width:640px){
          .del-btn{opacity:1 !important}
          .desktop-layout{display:none !important}
          .mobile-layout{display:flex !important}
        }
        @media(min-width:641px){
          .mobile-layout{display:none !important}
          .desktop-layout{display:grid !important}
        }
      `}</style>

      {/* ---- HEADER ---- */}
      <div style={{ padding: "16px 16px 0", maxWidth: 980, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8, paddingBottom: 16, borderBottom: "1px solid #1e293b" }}>
          <div>
            <p style={{ fontSize: 10, letterSpacing: 3, color: "#475569", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", marginBottom: 2 }}>Personal Finance</p>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: "#f8fafc" }}>Expense Tracker</h1>
          </div>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)}
            style={{ background: "#1e293b", border: "1px solid #334155", color: "#94a3b8", borderRadius: 8, padding: "7px 12px", fontSize: 13, fontFamily: "'JetBrains Mono',monospace", outline: "none" }} />
        </div>
      </div>

      {/* ===== DESKTOP layout (641px+) ===== */}
      <div className="desktop-layout" style={{ maxWidth: 980, margin: "0 auto", padding: "20px 16px 40px", gridTemplateColumns: "1fr 300px", gap: 20, alignItems: "start" }}>
        {/* Left: form + feed */}
        <div style={{ display: "grid", gap: 16 }}>
          {AddForm}
          {FeedPanel}
        </div>
        {/* Right: sticky summary */}
        <div style={{ position: "sticky", top: 20 }}>
          <SummaryPanel {...summaryProps} donutSize={180} />
        </div>
      </div>

      {/* ===== MOBILE layout (≤640px) ===== */}
      <div className="mobile-layout" style={{ flexDirection: "column", minHeight: "calc(100vh - 57px)" }}>
        {/* Tab content */}
        <div style={{ flex: 1, padding: "16px 14px 80px", overflowY: "auto" }}>
          {mobileTab === "overview" && <SummaryPanel {...summaryProps} donutSize={220} />}
          {mobileTab === "add" && AddForm}
          {mobileTab === "history" && FeedPanel}
        </div>

        {/* Bottom tab bar */}
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          background: "#0f172a", borderTop: "1px solid #1e293b",
          display: "flex", height: 62, zIndex: 100
        }}>
          {[
            { id: "overview", icon: "📊", label: "Overview" },
            { id: "add", icon: "➕", label: "Add" },
            { id: "history", icon: "🧾", label: "History" },
          ].map(tab => (
            <button key={tab.id} onClick={() => setMobileTab(tab.id)} style={{
              flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: 3, border: "none", cursor: "pointer",
              background: mobileTab === tab.id ? "#1e293b" : "transparent",
              color: mobileTab === tab.id ? "#818cf8" : "#475569",
              fontSize: 10, fontFamily: "'Inter',sans-serif", fontWeight: 600, letterSpacing: 0.5,
              textTransform: "uppercase", transition: "all 0.2s",
              borderTop: mobileTab === tab.id ? "2px solid #6366f1" : "2px solid transparent"
            }}>
              <span style={{ fontSize: 20 }}>{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}