import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { queryAll, queryOne, execute } from '../lib/db';
import { runMLInference } from '../lib/mlService';

const router = Router();
router.use(authenticate, requireAdmin);

const MODELS_DIR = process.env.MODELS_DIR || path.join(__dirname, '../../models');
const ACTIVE_DIR = path.join(MODELS_DIR, 'active');
const ARCHIVE_DIR = path.join(MODELS_DIR, 'archive');
fs.mkdirSync(ACTIVE_DIR, { recursive: true });
fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

const modelUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, ARCHIVE_DIR),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      cb(null, `${base}_${uuidv4().slice(0,8)}${ext}`);
    }
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.keras','.h5','.tflite','.pt'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only .keras, .h5, .tflite, .pt files allowed'));
  }
});

router.get('/', (req, res) => {
  const models = queryAll('SELECT * FROM model_records ORDER BY uploadedAt DESC');
  res.json({ models });
});

router.get('/active', (req, res) => {
  const model = queryOne("SELECT * FROM model_records WHERE status='active' LIMIT 1");
  res.json({ model });
});

router.post('/upload', modelUpload.single('model'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: 'No model file provided' }); return; }
  try {
    const stats = fs.statSync(req.file.path);
    const id = uuidv4();
    execute(`INSERT INTO model_records (id,filename,version,status,accuracy,numClasses,fileSize,filePath,uploadedBy) VALUES (?,?,?,'archive',?,?,?,?,?)`,
      [id, req.file.filename, req.body.version||`v_${Date.now()}`, req.body.accuracy?parseFloat(req.body.accuracy):null, parseInt(req.body.numClasses||'15'), stats.size, req.file.path, req.user?.userId||null]);
    const model = queryOne('SELECT * FROM model_records WHERE id=?', [id]);
    res.status(201).json({ model, message: 'Model uploaded successfully. Activate it when ready.' });
  } catch (e) { res.status(500).json({ error: 'Failed to upload model' }); }
});

router.put('/:id/activate', async (req: AuthRequest, res: Response): Promise<void> => {
  const model = queryOne<{ id: string; filename: string; filePath: string; status: string }>('SELECT * FROM model_records WHERE id=?', [req.params.id]);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
  try {
    // Archive current active
    const current = queryOne<{ id: string; filePath: string }>(`SELECT id,filePath FROM model_records WHERE status='active' LIMIT 1`);
    if (current) {
      const archivePath = path.join(ARCHIVE_DIR, path.basename(current.filePath));
      if (fs.existsSync(current.filePath) && !current.filePath.includes('/archive/')) {
        try { fs.renameSync(current.filePath, archivePath); } catch {}
      }
      execute(`UPDATE model_records SET status='archive', filePath=? WHERE id=?`, [archivePath, current.id]);
    }
    // Move new model to active
    const activePath = path.join(ACTIVE_DIR, path.basename(model.filePath));
    if (fs.existsSync(model.filePath)) fs.copyFileSync(model.filePath, activePath);
    execute(`UPDATE model_records SET status='active', filePath=? WHERE id=?`, [activePath, req.params.id]);
    // Signal ML service hot-reload
    try {
      const axios = (await import('axios')).default;
      await axios.post(`${process.env.ML_SERVICE_URL||'http://localhost:8000'}/reload`, { model_path: activePath }, { timeout: 5000 });
    } catch {}
    res.json({ message: 'Model activated. New predictions will use this model.' });
  } catch (e) { res.status(500).json({ error: 'Failed to activate model' }); }
});

router.put('/:id/deactivate', (req, res) => {
  execute(`UPDATE model_records SET status='archive' WHERE id=?`, [req.params.id]);
  res.json({ message: 'Model deactivated' });
});

router.delete('/:id', (req, res): void => {
  const model = queryOne<{ id: string; filePath: string; status: string }>('SELECT * FROM model_records WHERE id=?', [req.params.id]);
  if (!model) { res.status(404).json({ error: 'Model not found' }); return; }
  if (model.status === 'active') { res.status(400).json({ error: 'Cannot delete the active model. Deactivate it first.' }); return; }
  try { if (fs.existsSync(model.filePath)) fs.unlinkSync(model.filePath); } catch {}
  execute('DELETE FROM model_records WHERE id=?', [req.params.id]);
  res.json({ message: 'Model deleted' });
});

router.post('/test', multer({ dest: '/tmp/' }).single('image'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: 'No image provided' }); return; }
  try {
    const result = await runMLInference(req.file.path);
    try { fs.unlinkSync(req.file.path); } catch {}
    if (!result) { res.status(503).json({ error: 'ML service unavailable' }); return; }
    res.json({ predictedPlant: result.plantName, confidence: result.confidence, confidencePercent: parseFloat((result.confidence*100).toFixed(1)), allPredictions: result.allPredictions });
  } catch { res.status(500).json({ error: 'Test failed' }); }
});

export default router;
