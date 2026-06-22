# 💰 Expense Tracker

A personal expense tracking app built with React, Firebase, and Gemini AI. Log spends on the go from your phone or laptop — data syncs across both devices in real time.

---

## Features

- **Log expenses instantly** — describe what you spent on, enter the amount, mark it as a Need or Want
- **AI auto-categorisation** — Gemini automatically assigns each expense to the right category based on your description
- **9 expense categories** — Housing, Food & Dining, Transport, Health, Entertainment, Shopping, Utilities, Savings, Other
- **Wants vs Needs breakdown** — see how your spending splits between essentials and discretionary
- **Live donut chart** — visual breakdown of spending by category, updates as you add entries
- **Cross-device sync** — add an expense on your phone, see it instantly on your laptop
- **Responsive design** — full mobile UI with bottom tab navigation, full desktop sidebar layout
- **Monthly view** — switch between months to review past spending
- **INR currency** — all amounts in Indian Rupees (₹)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite |
| Database | Firebase Firestore |
| AI Categorisation | Google Gemini 2.0 Flash |
| Hosting | Vercel |
| Version control | Git + GitHub |

---

## Project Structure

```
expense-tracker/
├── api/
│   └── classify.js        # Vercel serverless function — proxies Gemini API
├── src/
│   ├── App.jsx            # Main app component
│   ├── firebase.js        # Firebase initialisation
│   ├── main.jsx           # React entry point
│   └── index.css          # Global styles
├── public/
├── .env                   # Local environment variables (never commit this)
├── .gitignore
├── index.html
├── package.json
└── vite.config.js
```

---

## Local Development

### Prerequisites

- Node.js v18 or higher
- A Firebase project with Firestore enabled
- A Gemini API key from [aistudio.google.com](https://aistudio.google.com)

### 1. Clone the repo

```bash
git clone https://github.com/YOUR_USERNAME/expense-tracker.git
cd expense-tracker
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up environment variables

Create a `.env` file in the project root:

```
VITE_FIREBASE_API_KEY=your_value
VITE_FIREBASE_AUTH_DOMAIN=your_value
VITE_FIREBASE_PROJECT_ID=your_value
VITE_FIREBASE_STORAGE_BUCKET=your_value
VITE_FIREBASE_MESSAGING_SENDER_ID=your_value
VITE_FIREBASE_APP_ID=your_value
VITE_FIREBASE_MEASUREMENT_ID=your_value
VITE_GEMINI_API_KEY=your_value
```

> The Gemini API key is only used via the Vercel proxy in production. Locally, expenses will save correctly but will default to the "Other" category due to browser CORS restrictions.

### 4. Run locally

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Deployment

This app is deployed on Vercel with automatic deploys on every push to `main`.

### Environment variables on Vercel

Add these via the Vercel dashboard or CLI:

```bash
vercel env add GEMINI_API_KEY
vercel env add VITE_FIREBASE_API_KEY
vercel env add VITE_FIREBASE_AUTH_DOMAIN
vercel env add VITE_FIREBASE_PROJECT_ID
vercel env add VITE_FIREBASE_STORAGE_BUCKET
vercel env add VITE_FIREBASE_MESSAGING_SENDER_ID
vercel env add VITE_FIREBASE_APP_ID
vercel env add VITE_FIREBASE_MEASUREMENT_ID
```

> Note: `GEMINI_API_KEY` has no `VITE_` prefix — it is only used server-side in the Vercel function.

### Deploy

```bash
git add .
git commit -m "your message"
git push
```

Vercel picks up the push and deploys automatically in ~60 seconds.

---

## How AI Categorisation Works

When you add an expense, the app calls `/api/classify` — a serverless function running on Vercel. That function sends your expense description, amount, and Need/Want label to the Gemini API and returns the most appropriate category. This keeps your Gemini API key server-side and never exposed to the browser.

If the API call fails for any reason, the expense is saved under "Other" so nothing is lost.

---

## Expense Categories

| Category | Typical items |
|---|---|
| 🏠 Housing | Rent, home loan EMI, maintenance charges |
| 🍽️ Food & Dining | Groceries, kirana store, Swiggy/Zomato, restaurants |
| 🚗 Transport | Metro, bus, petrol, Ola/Uber, vehicle insurance |
| ❤️ Health | Medicines, doctor visits, health insurance |
| 🎬 Entertainment | OTT subscriptions, movies, concerts |
| 🛍️ Shopping | Clothes, gadgets, home goods |
| ⚡ Utilities | Electricity, LPG, water, internet, mobile recharge |
| 💰 Savings | SIP, mutual funds, PPF, emergency fund |
| 📦 Other | Anything that doesn't fit above |

---

## Versioning

This project uses Git tags to track releases:

```bash
# Tag a new version
git tag v1.0.0
git push origin v1.0.0

# View all versions
git tag
```

---

## Firebase Security

Firestore is currently running in **test mode** which allows open read/write access. This is fine for personal use but you should set an expiry rule in the Firebase console under Firestore → Rules if you want to lock it down:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.time < timestamp.date(2026, 12, 31);
    }
  }
}
```

---

## License

Personal use only.