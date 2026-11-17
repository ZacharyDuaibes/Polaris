import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();
import express from 'express';
import cors from 'cors';
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { seedData } from './seed.js';
import { getDb } from './db.js';
import {
  signUpUser,
  loginUser,
  getCompanies,
  getCompanyById,
  createCompany,
  getProfiles,
  getProfileById,
  getProfileByUsername,
  upsertProfile,
  updateProfile,
  associateProfileCompany,
  clearProfileCompany,
  getNodes,
  getNodeById,
  createNode,
  updateNode,
  getDrones,
  getDroneById,
  updateDrone,
  createDrone,
  deleteDrone,
  getTransactions,
  createTransaction,
  getNetworkMetrics,
} from './store.js';

const app = express();
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
const ELEVENLABS_MODEL = process.env.ELEVENLABS_MODEL || 'eleven_multilingual_v2';
const ELEVENLABS_OUTPUT_FORMAT = process.env.ELEVENLABS_OUTPUT_FORMAT || 'mp3_44100_128';
const MAX_TTS_TEXT_LENGTH = 1200;
const elevenlabs = ELEVENLABS_API_KEY
  ? new ElevenLabsClient({
      apiKey: ELEVENLABS_API_KEY,
    })
  : null;

const corsOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = {
  origin: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['*'],
  exposedHeaders: ['*'],
  credentials: true,
  optionsSuccessStatus: 200,
  preflightContinue: false,
};

app.use((req, res, next) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin === 'null' ? '*' : origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,x-user-role,*');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length,ETag,*');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  next();
});

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'polaris-api' });
});

app.post('/api/auth/signup', async (req, res, next) => {
  try {
    const authResult = await signUpUser(req.body ?? {});
    res.status(201).json(authResult);
  } catch (error) {
    if (error.message === 'Username already exists' || error.message === 'Username and password are required') {
      res.status(400).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const authResult = await loginUser(req.body ?? {});
    res.json(authResult);
  } catch (error) {
    if (error.message === 'Invalid username or password' || error.message === 'Username and password are required') {
      res.status(401).json({ error: error.message });
      return;
    }
    next(error);
  }
});

app.get('/api/companies', async (_req, res, next) => {
  try {
    const companies = await getCompanies();
    res.json(companies);
  } catch (error) {
    next(error);
  }
});

app.post('/api/companies', async (req, res, next) => {
  try {
    const company = await createCompany(req.body?.name ?? '');
    res.json(company);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to create company.' });
  }
});

app.get('/api/companies/:id', async (req, res, next) => {
  try {
    const company = await getCompanyById(req.params.id);
    res.json(company);
  } catch (error) {
    next(error);
  }
});

app.get('/api/profiles', async (_req, res, next) => {
  try {
    const profiles = await getProfiles();
    res.json(profiles);
  } catch (error) {
    next(error);
  }
});

app.get('/api/profiles/:id', async (req, res, next) => {
  try {
    const profile = await getProfileById(req.params.id);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

app.get('/api/profiles/by-username/:username', async (req, res, next) => {
  try {
    const profile = await getProfileByUsername(req.params.username);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

app.post('/api/profiles', async (req, res, next) => {
  try {
    const profile = await upsertProfile(req.body);
    res.json(profile);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/profiles/:id', async (req, res, next) => {
  try {
    await updateProfile(req.params.id, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/profiles/:id/company', async (req, res, next) => {
  try {
    const profile = await associateProfileCompany(req.params.id, req.body?.company_id);
    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to associate company.' });
  }
});

app.delete('/api/profiles/:id/company', async (req, res, next) => {
  try {
    const profile = await clearProfileCompany(req.params.id);
    res.json(profile);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Failed to leave company.' });
  }
});

app.get('/api/nodes', async (_req, res, next) => {
  try {
    const nodes = await getNodes();
    res.json(nodes);
  } catch (error) {
    next(error);
  }
});

app.get('/api/nodes/:id', async (req, res, next) => {
  try {
    const node = await getNodeById(req.params.id);
    res.json(node);
  } catch (error) {
    next(error);
  }
});

app.post('/api/nodes', async (req, res, next) => {
  try {
    const userRole = req.headers['x-user-role'];
    if (userRole !== 'admin') {
      res.status(403).json({ error: 'Only admins can create nodes.' });
      return;
    }
    const node = await createNode(req.body);
    res.json(node);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/nodes/:id', async (req, res, next) => {
  try {
    await updateNode(req.params.id, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/drones', async (_req, res, next) => {
  try {
    const drones = await getDrones();
    res.json(drones);
  } catch (error) {
    next(error);
  }
});

app.get('/api/drones/:id', async (req, res, next) => {
  try {
    const drone = await getDroneById(req.params.id);
    res.json(drone);
  } catch (error) {
    next(error);
  }
});

app.patch('/api/drones/:id', async (req, res, next) => {
  try {
    await updateDrone(req.params.id, req.body);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post('/api/drones', async (req, res, next) => {
  try {
    const tierPricing = {
      starter: 0.5,
      pro: 1.25,
      enterprise: 2.5,
    };

    const userRole = req.headers['x-user-role'];
    if (userRole === 'admin') {
      res.status(403).json({ error: 'Admins cannot register drones.' });
      return;
    }
    const { tier = 'starter', ...payload } = req.body ?? {};
    if (!payload?.company_id) {
      res.status(400).json({ error: 'Company association is required to register drones.' });
      return;
    }
    const drone = await createDrone(payload);

    const amountSol = tierPricing[tier] ?? tierPricing.starter;
    if (drone.company_id) {
      await createTransaction({
        drone_id: drone.id,
        node_id: null,
        company_id: drone.company_id,
        amount_sol: amountSol,
      });
    }

    res.json({ drone, tier, amount_sol: amountSol });
  } catch (error) {
    next(error);
  }
});

app.delete('/api/drones/:id', async (req, res, next) => {
  try {
    const removed = await deleteDrone(req.params.id);
    res.json({ ok: removed });
  } catch (error) {
    next(error);
  }
});

app.get('/api/transactions', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit) || 50;
    const companyId =
      typeof req.query.company_id === 'string' && req.query.company_id.trim().length > 0
        ? req.query.company_id.trim()
        : null;
    const transactions = await getTransactions(limit, companyId);
    res.json(transactions);
  } catch (error) {
    next(error);
  }
});

app.post('/api/transactions', async (req, res, next) => {
  try {
    const tx = await createTransaction(req.body);
    res.json(tx);
  } catch (error) {
    next(error);
  }
});

app.get('/api/metrics', async (req, res, next) => {
  try {
    const companyId =
      typeof req.query.company_id === 'string' && req.query.company_id.trim().length > 0
        ? req.query.company_id.trim()
        : null;
    const metrics = await getNetworkMetrics(companyId);
    res.json(metrics);
  } catch (error) {
    next(error);
  }
});

app.post('/api/ai-analytics', async (req, res, next) => {
  try {
    const { networkData, companyContext } = req.body ?? {};
    const companyId = companyContext?.id ?? companyContext?.company_id ?? null;
    const company = companyId ? await getCompanyById(companyId) : null;

    const fallback = {
      summary: networkData
        ? `Network health looks stable with ${networkData.total_drones} active drones and ${networkData.total_nodes} nodes.`
        : 'Network health summary is unavailable.',
      recommendations: [
        {
          title: 'Infrastructure Expansion',
          description: `Add capacity near ${networkData?.most_congested_node ?? 'the busiest node'} to reduce queue times.`,
          impact: 'Improves peak throughput by 8-15%',
          priority: 'high',
        },
        {
          title: 'Efficiency Insights',
          description: 'Batch deliveries during lower congestion periods and pre-charge high-usage routes.',
          impact: 'Cuts average delay by 5-10%',
          priority: 'medium',
        },
        {
          title: 'Congestion Prediction',
          description: 'Expect congestion spikes during top delivery windows; pre-allocate nodes to absorb surges.',
          impact: 'Reduces congestion risk by ~10%',
          priority: 'low',
        },
      ],
    };

    if (!networkData) {
      res.json(fallback);
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.json(fallback);
      return;
    }

    const model = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    const responseSchema = {
      type: 'object',
      properties: {
        summary: { type: 'string' },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              impact: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'medium', 'low'] },
            },
            required: ['title', 'description', 'impact', 'priority'],
          },
        },
      },
      required: ['summary', 'recommendations'],
    };

    const prompt = [
      'You are an operations analyst for a drone infrastructure network.',
      company?.name ? `The user belongs to ${company.name}.` : '',
      'Return JSON that matches the provided schema.',
      'Include at least 3 recommendations covering infrastructure expansion, efficiency, and congestion.',
      '',
      'Network data:',
      JSON.stringify(networkData ?? {}, null, 2),
    ]
      .filter(Boolean)
      .join('\n');

    const geminiResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: responseSchema,
        },
      }),
    });

    if (!geminiResponse.ok) {
      res.json(fallback);
      return;
    }

    const payload = await geminiResponse.json();
    const text = payload?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!text) {
      res.json(fallback);
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      res.json(fallback);
      return;
    }

    if (!parsed?.summary || !Array.isArray(parsed?.recommendations)) {
      res.json(fallback);
      return;
    }

    res.json(parsed);
  } catch (error) {
    next(error);
  }
});

app.post('/api/text-to-speech', async (req, res, next) => {
  try {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';

    if (!text) {
      res.status(400).json({
        audioBase64: null,
        message: 'Text is required to generate audio.',
      });
      return;
    }

    if (text.length > MAX_TTS_TEXT_LENGTH) {
      res.status(400).json({
        audioBase64: null,
        message: `Voice explanations are limited to ${MAX_TTS_TEXT_LENGTH} characters to control API usage.`,
      });
      return;
    }

    if (!elevenlabs) {
      res.json({
        audioBase64: null,
        message: 'ELEVENLABS_API_KEY not configured yet. Add it to enable voice playback.',
      });
      return;
    }

    const audioStream = await elevenlabs.textToSpeech.convert(ELEVENLABS_VOICE_ID, {
      text,
      modelId: ELEVENLABS_MODEL,
      outputFormat: ELEVENLABS_OUTPUT_FORMAT,
    });

    const reader = audioStream.getReader();
    const chunks = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(Buffer.from(value));
      }
    }

    const audioBase64 = Buffer.concat(chunks).toString('base64');

    res.json({
      audioBase64,
      message: 'Voice explanation generated.',
    });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error('API error:', error);
  res.status(500).json({ error: error.message || 'Internal server error' });
});

const seedDatabase = async () => {
  const db = await getDb();
  if (!db) {
    console.warn('No MongoDB URI configured; skipping database seeding.');
    return;
  }

  try {
    const companyCount = await db.collection('companies').countDocuments();
    if (companyCount === 0) {
      await db.collection('companies').insertMany(seedData.companies);
      console.log('Seeded companies');
    }

    const profileCount = await db.collection('profiles').countDocuments();
    if (profileCount === 0) {
      await db.collection('profiles').insertMany(seedData.profiles);
      console.log('Seeded profiles');
    }

    const nodeCount = await db.collection('nodes').countDocuments();
    if (nodeCount === 0) {
      await db.collection('nodes').insertMany(seedData.nodes);
      console.log('Seeded nodes');
    }

    const droneCount = await db.collection('drones').countDocuments();
    if (droneCount === 0) {
      await db.collection('drones').insertMany(seedData.drones);
      console.log('Seeded drones');
    }

    const transactionCount = await db.collection('transactions').countDocuments();
    if (transactionCount === 0) {
      await db.collection('transactions').insertMany(seedData.transactions);
      console.log('Seeded transactions');
    }
  } catch (error) {
    console.error('Database seed failed:', error);
  }
};

const startServer = async () => {
  await seedDatabase();
  const port = Number(process.env.PORT) || 5050;
  app.listen(port, () => {
    console.log(`Polaris API running on http://localhost:${port}`);
  });
};

startServer();
