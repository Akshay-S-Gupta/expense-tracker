import { useState, useMemo, useEffect } from "react";
import { db } from "./firebase";
import {
  collection, addDoc, deleteDoc, updateDoc,
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
  { id: "uncategorised", label: "To Categorise", color: "#64748b", icon: "❓" },
];

const CLASSIFIABLE_IDS = CATEGORIES.filter(c => c.id !== "uncategorised").map(c => c.id).join(", ");

const fmt = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
const fmtSigned = (n) => (n < 0 ? "-" : "") + fmt(Math.abs(n));

// Single place all AI categorisation goes through. Returns a category id or null.
async function classifyViaApi(description, amount, natureVal) {
  try {
    const res = await fetch("/api/classify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description,
        amount,
        nature: natureVal === "want" ? "Want" : "Need",
        categories: CLASSIFIABLE_IDS
      })
    });
    const data = await res.json();
    const cat = CATEGORIES.find(c => c.id === data.category && c.id !== "uncategorised");
    return cat ? cat.id : null;
  } catch {
    return null;
  }
}

// ---- Bank statement CSV parsing ----
function parseCSV(text) {
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(c => c.trim() !== "")) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some(c => c.trim() !== "")) rows.push(row);
  return rows;
}

const MONTH_ABBR = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

function parseTxnDate(s) {
  s = String(s || "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // yyyy-mm-dd
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/); // dd/mm/yyyy, dd-mm-yy (Indian banks use day first)
  if (m) {
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s,-]+(\d{2,4})/); // 01 Jan 2026, 01-Jan-26
  if (m) {
    const mo = MONTH_ABBR[m[2].toLowerCase()];
    if (!mo) return null;
    const y = m[3].length === 2 ? "20" + m[3] : m[3];
    return `${y}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

function parseAmount(s) {
  const n = parseFloat(String(s || "").replace(/[₹,\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

const DESC_HEADERS = ["narration", "description", "particulars", "details", "remarks"];

function detectColumns(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const hdr = rows[i].map(h => String(h).toLowerCase().trim());
    const dateIdx = hdr.findIndex(h => h.includes("date"));
    if (dateIdx === -1) continue;
    const descIdx = hdr.findIndex(h => DESC_HEADERS.some(k => h.includes(k)));
    const debitIdx = hdr.findIndex(h => h.includes("debit") || h.includes("withdrawal"));
    const creditIdx = hdr.findIndex(h => h.includes("credit") || h.includes("deposit"));
    const amountIdx = hdr.findIndex(h => h.includes("amount"));
    const typeIdx = hdr.findIndex(h => h.replace(/\s/g, "") === "dr/cr" || h.replace(/\s/g, "") === "cr/dr" || h === "type");
    if (descIdx !== -1 && (debitIdx !== -1 || amountIdx !== -1)) {
      return { headerRow: i, dateIdx, descIdx, debitIdx, creditIdx, amountIdx, typeIdx };
    }
  }
  return null;
}

function extractTxns(rows, cols) {
  const out = [];
  for (let i = cols.headerRow + 1; i < rows.length; i++) {
    const r = rows[i];
    const date = parseTxnDate(r[cols.dateIdx]);
    if (!date) continue; // skips preamble/summary rows
    const desc = String(r[cols.descIdx] || "").trim().replace(/\s+/g, " ") || "Bank transaction";
    let amount = 0, type = "debit";
    if (cols.debitIdx !== -1 || cols.creditIdx !== -1) {
      const d = cols.debitIdx !== -1 ? parseAmount(r[cols.debitIdx]) : 0;
      const c = cols.creditIdx !== -1 ? parseAmount(r[cols.creditIdx]) : 0;
      if (d > 0) { amount = d; type = "debit"; }
      else if (c > 0) { amount = c; type = "credit"; }
    } else if (cols.amountIdx !== -1) {
      amount = parseAmount(r[cols.amountIdx]);
      const t = cols.typeIdx !== -1 ? String(r[cols.typeIdx] || "").toLowerCase() : "";
      if (amount < 0) { amount = Math.abs(amount); type = "debit"; }
      else type = t.includes("cr") ? "credit" : "debit";
    }
    if (amount > 0) out.push({ date, desc, amount, type });
  }
  return out;
}

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
function SummaryPanel({ segments, catTotals, total, incomeVal, remaining, savingsRate, needsTotal, wantsTotal, topCat, monthLabel, balance, donutSize }) {
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
        <div style={{ background: balance >= 0 ? "#052e16" : "#2d1515", border: `1px solid ${balance >= 0 ? "#166534" : "#7f1d1d"}`, borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>Current balance</span>
          <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 15, fontWeight: 700, color: balance >= 0 ? "#4ade80" : "#f87171" }}>{fmtSigned(balance)}</span>
        </div>
        {incomeVal > 0 && (
          <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{remaining >= 0 ? "Left this month" : "Overspent this month"}</span>
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
  const [entries, setEntries] = useState([]);
  const [incomes, setIncomes] = useState([]);
  const [showIncomeForm, setShowIncomeForm] = useState(false);
  const [incomeDesc, setIncomeDesc] = useState("");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeError, setIncomeError] = useState("");
  const [incomeSaving, setIncomeSaving] = useState(false);

  useEffect(() => {
    const q = query(collection(db, "entries"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snapshot) => {
      setEntries(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    const qi = query(collection(db, "incomes"), orderBy("createdAt", "desc"));
    const unsubIncomes = onSnapshot(qi, (snapshot) => {
      setIncomes(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return () => { unsub(); unsubIncomes(); };
  }, []);

  const [desc, setDesc] = useState("");
  const [amount, setAmount] = useState("");
  const [nature, setNature] = useState("need");
  const [loading, setLoading] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const [importTxns, setImportTxns] = useState(null);
  const [importSelected, setImportSelected] = useState(new Set());
  const [importError, setImportError] = useState("");
  const [importResult, setImportResult] = useState("");
  const [importing, setImporting] = useState(false);
  const [editPick, setEditPick] = useState(null); // { id, kind, desc, amount, category, nature, origDesc, picked }
  const [editSaving, setEditSaving] = useState(false);
  const [bulkCat, setBulkCat] = useState(null); // { done, total }
  const [aiSuggesting, setAiSuggesting] = useState(false);
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
  const monthIncomes = useMemo(() => incomes.filter(e => e.date.startsWith(month)), [incomes, month]);
  const incomeVal = useMemo(() => monthIncomes.reduce((a, e) => a + e.amount, 0), [monthIncomes]);
  // Rolling balance: everything ever received minus everything ever spent
  const balance = useMemo(
    () => incomes.reduce((a, e) => a + e.amount, 0) - entries.reduce((a, e) => a + e.amount, 0),
    [incomes, entries]
  );
  const remaining = incomeVal - total;
  const savingsRate = incomeVal > 0 ? ((incomeVal - total) / incomeVal) * 100 : null;
  const wantsTotal = useMemo(() => monthEntries.filter(e => e.nature === "want").reduce((a, e) => a + e.amount, 0), [monthEntries]);
  const needsTotal = useMemo(() => monthEntries.filter(e => e.nature === "need").reduce((a, e) => a + e.amount, 0), [monthEntries]);
  const topCat = useMemo(() => {
    if (total === 0) return null;
    const real = CATEGORIES.filter(c => c.id !== "uncategorised");
    const best = real.reduce((b, c) => catTotals[c.id] > catTotals[b.id] ? c : b);
    return catTotals[best.id] > 0 ? best : null;
  }, [catTotals, total]);
  const segments = CATEGORIES.map(c => ({ ...c, value: catTotals[c.id] }));
  const getCat = id => CATEGORIES.find(c => c.id === id) || CATEGORIES.find(c => c.id === "other");
  const monthFeed = useMemo(() => [
    ...monthIncomes.map(e => ({ ...e, kind: "income" })),
    ...monthEntries.map(e => ({ ...e, kind: "expense" })),
  ].sort((a, b) => b.createdAt - a.createdAt), [monthIncomes, monthEntries]);
  const needsCat = useMemo(() => entries.filter(e => e.category === "other" || e.category === "uncategorised").length, [entries]);

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

    const category = (await classifyViaApi(desc.trim(), amount, nature)) || "other";

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
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch {
      setError("Could not save entry. Check your connection.");
    } finally {
      setLoading(false);
    }
  }

  async function deleteEntry(id) {
    await deleteDoc(doc(db, "entries", id));
  }

  async function handleAddIncome() {
    const amt = parseFloat(incomeAmount);
    if (!amt || amt <= 0) { setIncomeError("Enter a valid amount."); return; }
    setIncomeError(""); setIncomeSaving(true);
    try {
      await addDoc(collection(db, "incomes"), {
        desc: incomeDesc.trim() || "Salary",
        amount: amt,
        date: new Date().toISOString().slice(0, 10),
        time: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
        createdAt: Date.now()
      });
      setIncomeDesc(""); setIncomeAmount(""); setShowIncomeForm(false);
    } catch {
      setIncomeError("Could not save income. Check your connection.");
    } finally {
      setIncomeSaving(false);
    }
  }

  async function deleteIncome(id) {
    await deleteDoc(doc(db, "incomes", id));
  }

  function handleFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = "";
    if (!file) return;
    setImportError(""); setImportResult("");
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const rows = parseCSV(String(reader.result));
        const cols = detectColumns(rows);
        if (!cols) { setImportError("Couldn't find transaction columns. Export a CSV statement from your bank and try again."); return; }
        const txns = extractTxns(rows, cols);
        if (txns.length === 0) { setImportError("No transactions found in this file."); return; }
        setImportTxns(txns);
        setImportSelected(new Set(txns.map((t, i) => (t.type === "debit" ? i : -1)).filter(i => i >= 0)));
      } catch {
        setImportError("Couldn't read this file. Make sure it's a CSV export.");
      }
    };
    reader.readAsText(file);
  }

  function toggleTxn(i) {
    setImportSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  async function runImport() {
    setImporting(true);
    try {
      const keyOf = e => `${e.date}|${e.amount}|${String(e.desc || "").toLowerCase()}`;
      const existing = new Set([...entries.map(keyOf), ...incomes.map(keyOf)]);
      let addedExp = 0, addedInc = 0, skipped = 0;
      const ops = [];
      importTxns.forEach((t, i) => {
        if (!importSelected.has(i)) return;
        const k = keyOf(t);
        if (existing.has(k)) { skipped++; return; }
        existing.add(k);
        const createdAt = new Date(t.date).getTime() + i; // sorts into the right spot in history
        if (t.type === "credit") {
          ops.push(addDoc(collection(db, "incomes"), { desc: t.desc, amount: t.amount, date: t.date, time: "", createdAt, source: "import" }));
          addedInc++;
        } else {
          ops.push(addDoc(collection(db, "entries"), { desc: t.desc, amount: t.amount, nature: null, category: "uncategorised", date: t.date, time: "", createdAt, source: "import" }));
          addedExp++;
        }
      });
      await Promise.all(ops);
      setImportResult(`Imported ${addedExp} expense${addedExp === 1 ? "" : "s"}${addedInc ? ` and ${addedInc} income` : ""}${skipped ? `, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}` : ""}.`);
      setImportTxns(null); setImportSelected(new Set());
    } catch {
      setImportError("Import failed partway. Check your connection and re-upload; duplicates will be skipped.");
    } finally {
      setImporting(false);
    }
  }

  function openExpenseEdit(e) {
    setEditPick({
      id: e.id, kind: "expense", desc: e.desc, amount: String(e.amount),
      category: e.category === "uncategorised" ? null : e.category,
      nature: e.nature || null,
      origDesc: e.desc, picked: false
    });
  }

  function openIncomeEdit(e) {
    setEditPick({ id: e.id, kind: "income", desc: e.desc, amount: String(e.amount) });
  }

  const canSaveEdit = !!(editPick && editPick.desc.trim() && parseFloat(editPick.amount) > 0);

  async function saveEdit() {
    if (!canSaveEdit || editSaving) return;
    const amt = parseFloat(editPick.amount);
    const desc = editPick.desc.trim();
    setEditSaving(true);
    try {
      if (editPick.kind === "income") {
        await updateDoc(doc(db, "incomes", editPick.id), { desc, amount: amt });
      } else {
        let category = editPick.category || "uncategorised";
        let nature = editPick.category ? (editPick.nature || "need") : null;
        // Re-run AI categorisation when the description changed and the user
        // didn't manually pick a category in this edit.
        const descChanged = desc !== String(editPick.origDesc || "").trim();
        if (!editPick.picked && descChanged) {
          const suggested = await classifyViaApi(desc, amt, editPick.nature);
          if (suggested) { category = suggested; nature = editPick.nature || "need"; }
        }
        await updateDoc(doc(db, "entries", editPick.id), { desc, amount: amt, category, nature });
      }
      setEditPick(null);
    } finally {
      setEditSaving(false);
    }
  }

  async function aiSuggest() {
    if (!editPick) return;
    setAiSuggesting(true);
    const suggested = await classifyViaApi(editPick.desc, editPick.amount, editPick.nature);
    if (suggested) setEditPick(p => (p ? { ...p, category: suggested, nature: p.nature || "need", picked: true } : p));
    setAiSuggesting(false);
  }

  async function bulkCategorise() {
    const targets = entries.filter(e => e.category === "other" || e.category === "uncategorised");
    if (targets.length === 0 || bulkCat) return;
    setBulkCat({ done: 0, total: targets.length });
    for (const e of targets) {
      const suggested = await classifyViaApi(e.desc, e.amount, e.nature);
      if (suggested && suggested !== e.category) {
        try {
          await updateDoc(doc(db, "entries", e.id), { category: suggested, nature: e.nature || "need" });
        } catch {
          // keep going with the rest
        }
      }
      setBulkCat(b => (b ? { ...b, done: b.done + 1 } : b));
    }
    setBulkCat(null);
  }

  const summaryProps = { segments, catTotals, total, incomeVal, remaining, savingsRate, needsTotal, wantsTotal, topCat, monthLabel, balance };

  const AddForm = (
    <div style={{ display: "grid", gap: 12 }}>
      {/* Balance */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: "14px 16px", border: "1px solid #334155" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>💵</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <label style={{ fontSize: 10, letterSpacing: 1.5, color: "#64748b", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace", display: "block", marginBottom: 3 }}>Current Balance</label>
            <span style={{ color: balance >= 0 ? "#84cc16" : "#f87171", fontFamily: "'JetBrains Mono',monospace", fontSize: 22, fontWeight: 700 }}>{fmtSigned(balance)}</span>
          </div>
          <button onClick={() => { setShowIncomeForm(s => !s); setIncomeError(""); }} style={{
            background: showIncomeForm ? "transparent" : "#166534", border: "1px solid #166534", borderRadius: 8,
            padding: "8px 12px", color: showIncomeForm ? "#94a3b8" : "#fff", fontSize: 13, fontWeight: 600,
            cursor: "pointer", flexShrink: 0, transition: "all 0.2s"
          }}>{showIncomeForm ? "✕ Close" : "+ Income"}</button>
        </div>
        {showIncomeForm && (
          <div style={{ marginTop: 12, borderTop: "1px solid #334155", paddingTop: 12 }}>
            <input placeholder="Source, e.g. July salary, freelance, refund..."
              value={incomeDesc} onChange={e => setIncomeDesc(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleAddIncome()}
              style={{ width: "100%", background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "11px 13px", color: "#e2e8f0", fontSize: 15, outline: "none", marginBottom: 10 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 13px", display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#64748b", fontFamily: "'JetBrains Mono',monospace", fontSize: 16 }}>₹</span>
                <input type="number" placeholder="Amount" value={incomeAmount} onChange={e => setIncomeAmount(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handleAddIncome()}
                  style={{ background: "transparent", border: "none", color: "#84cc16", fontFamily: "'JetBrains Mono',monospace", fontSize: 19, fontWeight: 700, width: "100%", outline: "none" }} />
              </div>
              <button onClick={handleAddIncome} disabled={incomeSaving} style={{
                background: "#166534", border: "none", borderRadius: 8, padding: "0 18px",
                color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer", opacity: incomeSaving ? 0.7 : 1
              }}>{incomeSaving ? "Saving..." : "Add"}</button>
            </div>
            {incomeError && <p style={{ margin: "8px 0 0", color: "#f87171", fontSize: 12 }}>{incomeError}</p>}
          </div>
        )}
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
          width: "100%", background: justSaved ? "#166534" : "#4338ca", border: "none", borderRadius: 8, padding: "12px",
          color: "#fff", fontSize: 15, fontWeight: 600, cursor: "pointer", letterSpacing: 0.3,
          opacity: loading ? 0.7 : 1, transition: "background 0.2s"
        }}>{loading ? "Categorising..." : justSaved ? "Saved ✓" : "+ Add Expense"}</button>
      </div>
    </div>
  );

  const ImportPanel = (
    <div style={{ background: "#1e293b", borderRadius: 14, padding: 16, border: "1px solid #334155" }}>
      <p style={{ margin: "0 0 10px", fontSize: 10, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>Import Bank Statement</p>
      {!importTxns ? (
        <>
          <p style={{ margin: "0 0 12px", fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
            Export a CSV statement from your bank app and upload it here. Debits come in as expenses marked "To Categorise" so you can fill in details later; credits can be imported as income. Duplicates are skipped automatically.
          </p>
          <label style={{ display: "block", background: "#0f172a", border: "1px dashed #334155", borderRadius: 10, padding: "18px 12px", textAlign: "center", color: "#94a3b8", fontSize: 13, cursor: "pointer" }}>
            📄 Choose CSV file
            <input type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: "none" }} />
          </label>
          {importError && <p style={{ margin: "10px 0 0", color: "#f87171", fontSize: 12 }}>{importError}</p>}
          {importResult && <p style={{ margin: "10px 0 0", color: "#4ade80", fontSize: 12 }}>{importResult}</p>}
        </>
      ) : (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8, fontSize: 11, color: "#64748b" }}>
            <span style={{ flex: 1 }}>{importSelected.size} of {importTxns.length} selected</span>
            <button onClick={() => setImportSelected(new Set(importTxns.map((_, i) => i)))} style={{ background: "none", border: "none", color: "#818cf8", fontSize: 11, cursor: "pointer", padding: 0 }}>All</button>
            <button onClick={() => setImportSelected(new Set(importTxns.map((t, i) => (t.type === "debit" ? i : -1)).filter(i => i >= 0)))} style={{ background: "none", border: "none", color: "#818cf8", fontSize: 11, cursor: "pointer", padding: 0 }}>Debits</button>
            <button onClick={() => setImportSelected(new Set())} style={{ background: "none", border: "none", color: "#818cf8", fontSize: 11, cursor: "pointer", padding: 0 }}>None</button>
          </div>
          <div style={{ maxHeight: 300, overflowY: "auto", display: "grid", gap: 4, marginBottom: 10 }}>
            {importTxns.map((t, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 8, background: "#0f172a", borderRadius: 8, padding: "8px 10px", cursor: "pointer", border: "1px solid #1e293b" }}>
                <input type="checkbox" checked={importSelected.has(i)} onChange={() => toggleTxn(i)} />
                <span style={{ fontSize: 10, color: "#475569", fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{t.date}</span>
                <span style={{ flex: 1, fontSize: 12, color: "#cbd5e1", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.desc}</span>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12, fontWeight: 700, flexShrink: 0, color: t.type === "credit" ? "#4ade80" : "#f59e0b" }}>{t.type === "credit" ? "+" : ""}{fmt(t.amount)}</span>
              </label>
            ))}
          </div>
          {importError && <p style={{ margin: "0 0 8px", color: "#f87171", fontSize: 12 }}>{importError}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setImportTxns(null); setImportSelected(new Set()); }} style={{ flex: 1, background: "transparent", border: "1px solid #334155", borderRadius: 8, padding: "10px", color: "#94a3b8", fontSize: 13, cursor: "pointer" }}>Cancel</button>
            <button onClick={runImport} disabled={importing || importSelected.size === 0} style={{ flex: 2, background: "#4338ca", border: "none", borderRadius: 8, padding: "10px", color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: importing || importSelected.size === 0 ? 0.6 : 1 }}>
              {importing ? "Importing..." : `Import ${importSelected.size} selected`}
            </button>
          </div>
        </>
      )}
    </div>
  );

  const FeedPanel = (
    <div>
      {needsCat > 0 && (
        <div style={{ background: "#1e1b4b", border: "1px solid #4338ca", borderRadius: 10, padding: "10px 12px", marginBottom: 12, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#c7d2fe", flex: 1, minWidth: 160 }}>
            {bulkCat
              ? `Categorising ${bulkCat.done} of ${bulkCat.total}...`
              : `${needsCat} expense${needsCat === 1 ? "" : "s"} sitting in "Other" or "To Categorise" (all months)`}
          </span>
          <button onClick={bulkCategorise} disabled={!!bulkCat} style={{
            background: "#4338ca", border: "none", borderRadius: 8, padding: "8px 12px",
            color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
            opacity: bulkCat ? 0.7 : 1
          }}>{bulkCat ? "Working..." : "✨ AI categorise all"}</button>
        </div>
      )}
      <p style={{ margin: "0 0 10px", fontSize: 10, letterSpacing: 2, color: "#475569", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>
        {monthLabel} — {monthFeed.length} {monthFeed.length === 1 ? "entry" : "entries"}
      </p>
      {monthFeed.length === 0
        ? <div style={{ background: "#1e293b", borderRadius: 12, padding: "32px 20px", textAlign: "center", color: "#334155", fontSize: 14 }}>Nothing logged yet.</div>
        : <div style={{ display: "grid", gap: 8 }}>
          {monthFeed.map(e => {
            if (e.kind === "income") {
              return (
                <div key={"inc-" + e.id} className="entry-row"
                  onClick={() => { if (window.matchMedia("(max-width: 640px)").matches) openIncomeEdit(e); }}
                  style={{ background: "#1e293b", borderRadius: 10, padding: "12px 14px", border: "1px solid #16653444", display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 20, flexShrink: 0 }}>💵</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "calc(100% - 60px)" }}>{e.desc}</span>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 20, flexShrink: 0, background: "#052e16", color: "#4ade80" }}>Income</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#475569" }}>{e.date} {e.time}</span>
                    </div>
                  </div>
                  <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: "#4ade80", flexShrink: 0 }}>+{fmt(e.amount)}</span>
                  <button className="edit-btn" onClick={ev => { ev.stopPropagation(); openIncomeEdit(e); }}
                    style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✎</button>
                  <button className="del-btn" onClick={ev => { ev.stopPropagation(); deleteIncome(e.id); }}
                    style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✕</button>
                </div>
              );
            }
            const cat = getCat(e.category);
            const isPending = e.category === "uncategorised";
            return (
              <div key={e.id} className="entry-row"
                onClick={() => { if (window.matchMedia("(max-width: 640px)").matches) openExpenseEdit(e); }}
                style={{ background: "#1e293b", borderRadius: 10, padding: "12px 14px", border: `1px solid ${cat.color}22`, display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{cat.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 14, color: "#e2e8f0", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "calc(100% - 60px)" }}>{e.desc}</span>
                    {e.nature && <span style={{
                      fontSize: 10, padding: "2px 7px", borderRadius: 20, flexShrink: 0,
                      background: e.nature === "need" ? "#052e16" : "#2e1065",
                      color: e.nature === "need" ? "#4ade80" : "#a78bfa"
                    }}>{e.nature === "need" ? "Need" : "Want"}</span>}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {isPending
                      ? <button onClick={ev => { ev.stopPropagation(); openExpenseEdit(e); }} style={{ background: "none", border: "none", padding: 0, fontSize: 11, color: "#f59e0b", cursor: "pointer", textDecoration: "underline dotted" }}>❓ Categorise</button>
                      : <span style={{ fontSize: 11, color: cat.color }}>{cat.label}</span>}
                    <span style={{ fontSize: 11, color: "#475569" }}>{e.date} {e.time}</span>
                  </div>
                </div>
                <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 14, fontWeight: 700, color: "#f8fafc", flexShrink: 0 }}>{fmt(e.amount)}</span>
                <button className="edit-btn" onClick={ev => { ev.stopPropagation(); openExpenseEdit(e); }}
                  style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 14, padding: "2px 4px", lineHeight: 1, flexShrink: 0 }}>✎</button>
                <button className="del-btn" onClick={ev => { ev.stopPropagation(); deleteEntry(e.id); }}
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
        .del-btn,.edit-btn{opacity:0;transition:opacity 0.15s}
        .entry-row:hover .del-btn,.entry-row:hover .edit-btn{opacity:1}
        @media(max-width:640px){
          .del-btn{opacity:1 !important}
          .edit-btn{display:none !important}
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
          {ImportPanel}
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
          {mobileTab === "import" && ImportPanel}
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
            { id: "import", icon: "📥", label: "Import" },
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

      {/* ---- EDIT POPUP (mobile: tap card / desktop: pencil icon) ---- */}
      {editPick && (
        <div onClick={() => setEditPick(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(2,6,23,0.72)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <div onClick={ev => ev.stopPropagation()}
            style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 16, padding: 16, width: "100%", maxWidth: 480, maxHeight: "85vh", overflowY: "auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 10, letterSpacing: 2, color: "#64748b", textTransform: "uppercase", fontFamily: "'JetBrains Mono',monospace" }}>
                {editPick.kind === "income" ? "Edit Income" : "Edit Expense"}
              </p>
              <button onClick={() => setEditPick(null)} style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: 4 }}>✕</button>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <input value={editPick.desc} onChange={ev => setEditPick(p => ({ ...p, desc: ev.target.value }))}
                style={{ flex: 2, minWidth: 140, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "10px 12px", color: "#e2e8f0", fontSize: 14, outline: "none" }} />
              <div style={{ flex: 1, minWidth: 100, background: "#0f172a", border: "1px solid #334155", borderRadius: 8, padding: "9px 12px", display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ color: "#64748b", fontFamily: "'JetBrains Mono',monospace", fontSize: 14 }}>₹</span>
                <input type="number" value={editPick.amount} onChange={ev => setEditPick(p => ({ ...p, amount: ev.target.value }))}
                  style={{ background: "transparent", border: "none", color: editPick.kind === "income" ? "#84cc16" : "#f59e0b", fontFamily: "'JetBrains Mono',monospace", fontSize: 16, fontWeight: 700, width: "100%", outline: "none" }} />
              </div>
            </div>
            {editPick.kind === "expense" && (
              <>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
                  {CATEGORIES.filter(c => c.id !== "uncategorised").map(c => (
                    <button key={c.id} onClick={() => setEditPick(p => ({ ...p, category: c.id, nature: p.nature || "need", picked: true }))} style={{
                      padding: "6px 11px", borderRadius: 20, fontSize: 12, cursor: "pointer",
                      border: `1px solid ${editPick.category === c.id ? c.color : "#334155"}`,
                      background: editPick.category === c.id ? c.color + "33" : "transparent",
                      color: editPick.category === c.id ? "#f1f5f9" : "#94a3b8"
                    }}>{c.icon} {c.label}</button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                  {["need", "want"].map(n => (
                    <button key={n} onClick={() => setEditPick(p => ({ ...p, nature: n }))} style={{
                      padding: "7px 12px", borderRadius: 8, border: "1px solid", cursor: "pointer", fontSize: 12, fontWeight: 600,
                      background: editPick.nature === n ? (n === "need" ? "#10b981" : "#8b5cf6") : "transparent",
                      borderColor: editPick.nature === n ? (n === "need" ? "#10b981" : "#8b5cf6") : "#334155",
                      color: editPick.nature === n ? "#fff" : "#64748b"
                    }}>{n === "need" ? "🧾 Need" : "✨ Want"}</button>
                  ))}
                  <button onClick={aiSuggest} disabled={aiSuggesting} style={{
                    padding: "7px 12px", borderRadius: 8, border: "1px solid #4338ca", background: "transparent",
                    color: "#818cf8", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: aiSuggesting ? 0.6 : 1
                  }}>{aiSuggesting ? "Thinking..." : "✨ AI suggest"}</button>
                </div>
              </>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={() => setEditPick(null)} style={{ padding: "9px 14px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 13, cursor: "pointer" }}>Cancel</button>
              <button onClick={saveEdit} disabled={!canSaveEdit || editSaving} style={{
                padding: "9px 18px", borderRadius: 8, border: "none", background: "#4338ca",
                color: "#fff", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: canSaveEdit && !editSaving ? 1 : 0.5
              }}>{editSaving ? "Categorising..." : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}