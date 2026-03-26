/**
 * Modern Med Spa — ShopFlow Proxy Server
 *
 * ENV VARS (set in Railway):
 *   ANTHROPIC_API_KEY  — your Anthropic key (required)
 *   SUPABASE_URL       — https://pxbbmymmgszbxrfyktzk.supabase.co
 *   SUPABASE_KEY       — your sb_publishable key
 *   CLIENT_ID          — UUID from Supabase after seeding (replace below)
 *
 * ENDPOINTS:
 *   GET  /             — health check
 *   GET  /config       — returns live services + deals from Supabase (cached 5 min)
 *   POST /api/chat     — proxies messages to Anthropic API
 */

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 8080;

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: [
    'https://modernmedspautah.com',
    'https://www.modernmedspautah.com',
    /\.modernmedspautah\.com$/,
    'https://shopflow-admin.calvinndavis12.workers.dev',
    /\.gocannaflow\.com$/,
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:8080',
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '20kb' }));

// ── Supabase config ───────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://pxbbmymmgszbxrfyktzk.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_8x-ZkoE7MuIIbpEpa8CHWQ_g1yNU02U';
const CLIENT_ID    = process.env.CLIENT_ID    || 'PASTE_MMS_UUID_HERE';
const CACHE_TTL    = 5 * 60 * 1000;

let configCache = { data: null, fetchedAt: 0 };

const supaHeaders = {
  'apikey':        SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type':  'application/json',
};

async function fetchFromSupabase(table, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${params}`;
  const res = await fetch(url, { headers: supaHeaders });
  if (!res.ok) throw new Error(`Supabase ${table} returned ${res.status}: ${await res.text()}`);
  return res.json();
}

// ── /config endpoint ──────────────────────────────────────────────────────────
app.get('/config', async (req, res) => {
  if (configCache.data && Date.now() - configCache.fetchedAt < CACHE_TTL) {
    return res.json({ ...configCache.data, cached: true });
  }

  try {
    const clientParam = `client_id=eq.${CLIENT_ID}`;

    const [rawServices, rawDeals] = await Promise.all([
      fetchFromSupabase('products', `${clientParam}&order=name`),
      fetchFromSupabase('deals',    `${clientParam}&active=eq.true&order=created_at`),
    ]);

    const services = rawServices.map(r => ({
      id:          r.handle || r.id,
      name:        r.name,
      category:    r.collection,
      description: r.description,
      concerns:    r.scent_profile ? r.scent_profile.split(',').map(s => s.trim()) : [],
      downtime:    r.notes_top   || 'Varies',
      results:     r.notes_heart || 'Varies',
      duration:    r.notes_base  || 'Varies',
      tags:        r.tags ? r.tags.split(',').map(t => t.trim()) : [],
      isBestseller: !!r.is_bestseller,
      rating:      r.rating ? parseFloat(r.rating) : null,
      bookUrl:     '/book',
    }));

    const deals = rawDeals.map(r => ({
      id:          r.deal_id || r.id,
      name:        r.name,
      description: r.description,
      cta:         r.cta,
      url:         r.shop_url,
      active:      r.active,
    }));

    const payload = { services, deals, fetchedAt: new Date().toISOString() };
    configCache = { data: payload, fetchedAt: Date.now() };

    console.log(`[MMS] Config loaded — ${services.length} services, ${deals.length} active deals`);
    res.json(payload);

  } catch (err) {
    console.error('[MMS] Config fetch error:', err.message);
    if (configCache.data) return res.json({ ...configCache.data, stale: true });
    res.status(502).json({ error: 'Could not load config from Supabase', detail: err.message });
  }
});

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => res.json({
  status: 'Modern Med Spa proxy running ✦',
  bot: 'Grace',
  source: 'Supabase',
  clientId: CLIENT_ID,
}));

// ── /api/chat ─────────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

  const { system, messages, max_tokens, model } = req.body;
  if (!messages?.length) return res.status(400).json({ error: 'messages required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      model      || 'claude-haiku-4-5-20251001',
        max_tokens: max_tokens || 700,
        system:     system     || '',
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[MMS] Anthropic error:', response.status, err);
      return res.status(response.status).json({ error: 'Upstream error', detail: err });
    }

    res.json(await response.json());

  } catch (err) {
    console.error('[MMS] Proxy error:', err);
    res.status(502).json({ error: 'Proxy error', detail: err.message });
  }
});

app.listen(PORT, () => console.log(`✦ Modern Med Spa proxy listening on port ${PORT}`));
