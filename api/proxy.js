// api/proxy.js (Vercel Serverless Function, Node 24, ESM)

import axios from "axios";
import crypto from "crypto";

export default async function handler(req, res) {

  // ----- CORS / PREFLIGHT (HARD STOP) -----
  res.setHeader("Access-Control-Allow-Origin", "https://storybound-app.vercel.app");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // If browser is asking "may I send a POST?"
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // ----- TEMP: ALIVE CHECK -----
  return res.status(200).json({ ok: true });

  // 🔴 Real proxy logic will be added BELOW this later
}
