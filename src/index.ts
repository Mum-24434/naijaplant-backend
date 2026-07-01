import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import dotenv from 'dotenv';
import { rateLimit } from 'express-rate-limit';
import { getDb } from './lib/db';

dotenv.config();

import authRoutes from './routes/auth';
import plantRoutes from './routes/plants';
import predictRoutes from './routes/predict';
import adminRoutes from './routes/admin';
import modelRoutes from './routes/models';

const app = express();
const PORT = process.env.PORT || 5000;

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? ['https://naijaplant.ai'] : ['http://localhost:3000'],
  credentials: true
}));

const limiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
const predictLimiter = rateLimit({ windowMs: 60*1000, max: 10 });

app.use('/api/', limiter);
app.use('/api/predict', predictLimiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
app.use('/plant-images', express.static(path.join(__dirname, '../plant-images')));

app.use('/api/auth', authRoutes);
app.use('/api/plants', plantRoutes);
app.use('/api/predict', predictRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/models', modelRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
app.use('*', (req, res) => res.status(404).json({ error: 'Route not found' }));
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

// Init DB then start server
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`🌿 NaijaPlant AI Backend running on port ${PORT}`);
    console.log(`🔗 API: http://localhost:${PORT}/api`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

export default app;
