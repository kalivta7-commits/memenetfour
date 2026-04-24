# 🚀 MemeNet — AI-Native Memecoin Intelligence Platform

> Real-time crypto signal engine powered by AI, market data, and social sentiment.

---

## 🧠 What is MemeNet?

**MemeNet** is an AI-powered platform that transforms chaotic memecoin markets into **structured, actionable intelligence**.

It combines:

* 📊 Live market data (CoinGecko + DexScreener)
* 🧠 AI-generated signals (OpenRouter)
* 🌐 Social + narrative analysis (Firecrawl)
* ⚡ Real-time event engine

👉 Result: A **live intelligence layer for crypto traders**

---

## 🔥 Core Features

### 📡 Live Signal Feed

* AI-generated trading signals
* Whale activity detection
* Social momentum tracking
* Market + narrative fusion

---

### 📊 Real-Time Market Data

* Accurate per-token pricing
* 24h change, volume, liquidity
* CoinGecko (primary) + DexScreener (fallback)
* No fake or static data

---

### 🧠 AI Signal Engine

* Generates insights using real market inputs
* No generic content
* Context-aware narratives

Example:

> "Price surged +12.4% with $3.2M volume — strong whale accumulation detected"

---

### 🌍 Explore Hub

* Trending tokens by dominance
* Signal-based ranking
* Category filters (Whale, Social, News)

---

### 🧾 Token Profiles

* Dynamic token pages
* Live signals per token
* Market stats + sentiment

---

### 🤖 Autonomous Data Engine

* Background processing loop
* Event detection (whale, volume spike, news)
* AI enrichment pipeline

---

## 🏗️ Tech Stack

### Frontend

* React + Vite
* TypeScript
* TailwindCSS

### Backend

* Node.js
* Supabase (Database + Realtime)
* Custom Event Engine

### AI + Data

* OpenRouter (Claude / DeepSeek / Gemini)
* Firecrawl (web + narrative extraction)
* CoinGecko API
* DexScreener API

---

## ⚙️ Architecture Overview

```
User → Frontend → API → Event Engine → AI Engine → Supabase → UI
                         ↓
                   External APIs
       (CoinGecko, DexScreener, Firecrawl)
```

---

## 📈 Data Flow

1. User submits token (with links)
2. Backend extracts identifiers
3. Market data fetched (batched)
4. Event engine detects signals
5. AI generates contextual insights
6. Results stored + displayed live

---

## 🧪 Key Innovations

* ⚡ **Real-time AI signals (not static posts)**
* 🔄 **Multi-source market validation**
* 🧠 **Context-aware AI (not generic GPT spam)**
* 📊 **Per-token data isolation (no shared state bugs)**
* 🛡️ **Validation layer (no fake price data)**

---

## 🚀 Getting Started

### 1. Clone repo

```bash
git clone https://github.com/YOUR_USERNAME/memenet.git
cd memenet
```

### 2. Install dependencies

```bash
npm install
```

### 3. Setup environment

Create `.env`:

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
OPENROUTER_API_KEY=
FIRECRAWL_API_KEY=
```

### 4. Run project

```bash
npm run dev
```

---

## ⚠️ Important Notes

* No API keys are exposed in frontend
* All prices are fetched live (no hardcoded values)
* Cached responses used to avoid rate limits
* System designed to **extend — not break**

---

## 🏆 Hackathon Value

MemeNet solves a real problem:

> ❌ Noise-driven memecoin market
> ✅ Signal-driven intelligence layer

It bridges:

* Data → Insight → Action

---

## 🔮 Future Roadmap

* 📱 Mobile app
* 🧠 Personalized AI agents
* 💰 Portfolio tracking
* 📊 Advanced analytics dashboard
* 🔗 On-chain integration

---

## 👨‍💻 Author

Built with focus on **real-world utility, AI integration, and scalable architecture**

---

## ⭐ Support

If you like this project:

* ⭐ Star the repo
* 🧠 Fork & build
* 🚀 Share with others

---

## ⚡ Final Thought

> Meme coins move fast.
> MemeNet makes you faster.

---
