import { Router, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { optionalAuth, AuthRequest } from '../middleware/auth';
import { runMLInference } from '../lib/mlService';
import { queryOne, execute } from '../lib/db';

const router = Router();
const CONFIDENCE_THRESHOLD = 0.80;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '5242880');

const storage = multer.diskStorage({
  destination: (req: AuthRequest, file, cb) => {
    const userId = (req as AuthRequest).user?.userId;
    const dir = userId ? path.join(UPLOAD_DIR, `user_${userId}`) : path.join(UPLOAD_DIR, 'guest');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg','.jpeg','.png','.webp'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only JPG, JPEG, PNG, and WEBP files are allowed'));
  }
});

router.post('/', optionalAuth, upload.single('image'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) { res.status(400).json({ error: 'No image file provided' }); return; }
  try {
    const prediction = await runMLInference(req.file.path);
    if (!prediction) { res.status(503).json({ error: 'ML service unavailable. Please try again.' }); return; }
    const userId = req.user?.userId || null;
    const uploadId = uuidv4();
    execute(`INSERT INTO uploads (id,userId,imagePath,predictedPlant,confidence,isGuest) VALUES (?,?,?,?,?,?)`,
      [uploadId, userId, req.file.path, prediction.confidence >= CONFIDENCE_THRESHOLD ? prediction.plantName : null, prediction.confidence, userId ? 0 : 1]);
    if (userId) execute(`INSERT INTO activity_logs (id,userId,action,details) VALUES (?,?,?,?)`, [uuidv4(), userId, 'PLANT_IDENTIFIED', `Identified: ${prediction.plantName} (${(prediction.confidence*100).toFixed(1)}%)`]);
    if (prediction.confidence < CONFIDENCE_THRESHOLD) {
      res.json({ identified: false, message: 'No matching medicinal plant found in the system.', uploadId }); return;
    }
    const plant = queryOne<Record<string,unknown>>('SELECT * FROM plants WHERE name = ?', [prediction.plantName]);
    if (!plant) { res.json({ identified: false, message: 'Plant identified but data not found.', uploadId }); return; }
    const parsed = { ...plant, uses: JSON.parse(plant.uses as string||'[]'), traditionalUses: JSON.parse(plant.traditionalUses as string||'[]'), region: JSON.parse(plant.region as string||'[]'), partsUsed: JSON.parse(plant.partsUsed as string||'[]'), preparationMethods: JSON.parse(plant.preparationMethods as string||'[]') };
    res.json({ identified: true, uploadId, confidence: prediction.confidence, confidencePercent: parseFloat((prediction.confidence*100).toFixed(1)), plant: parsed, imageUrl: `/uploads/${userId ? `user_${userId}` : 'guest'}/${path.basename(req.file.path)}` });
  } catch (error) {
    console.error('Prediction error:', error);
    if (req.file) try { fs.unlinkSync(req.file.path); } catch {}
    res.status(500).json({ error: 'Prediction failed. Please try again.' });
  }
});

export default router;
