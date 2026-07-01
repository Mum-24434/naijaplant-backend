import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, requireAdmin } from '../middleware/auth';
import { queryAll, queryOne, execute, count } from '../lib/db';

const router = Router();
router.use(authenticate, requireAdmin);

// ── Plants ──────────────────────────────────────────────────────────
router.get('/plants', (req, res) => {
  const plants = queryAll('SELECT * FROM plants ORDER BY name ASC');
  res.json({ plants });
});

router.post('/plants', (req: Request, res: Response): void => {
  try {
    const { name, botanicalName, description, uses, traditionalUses, family, precautions, region, imageUrl, yorubaName, hausaName, igboName, partsUsed, preparationMethods } = req.body;
    if (!name || !botanicalName || !description || !family) { res.status(400).json({ error: 'Required fields missing' }); return; }
    const id = uuidv4();
    execute(`INSERT INTO plants (id,name,botanicalName,description,uses,traditionalUses,family,precautions,region,imageUrl,yorubaName,hausaName,igboName,partsUsed,preparationMethods) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, name, botanicalName, description, JSON.stringify(uses||[]), JSON.stringify(traditionalUses||[]), family, precautions||'', JSON.stringify(region||[]), imageUrl||null, yorubaName||null, hausaName||null, igboName||null, JSON.stringify(partsUsed||[]), JSON.stringify(preparationMethods||[])]);
    const plant = queryOne('SELECT * FROM plants WHERE id = ?', [id]);
    res.status(201).json({ plant });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Failed to create plant' }); }
});

router.put('/plants/:id', (req: Request, res: Response): void => {
  try {
    const { name, botanicalName, description, uses, traditionalUses, family, precautions, region, imageUrl, yorubaName, hausaName, igboName, partsUsed, preparationMethods } = req.body;
    execute(`UPDATE plants SET name=COALESCE(?,name), botanicalName=COALESCE(?,botanicalName), description=COALESCE(?,description), uses=COALESCE(?,uses), traditionalUses=COALESCE(?,traditionalUses), family=COALESCE(?,family), precautions=COALESCE(?,precautions), region=COALESCE(?,region), imageUrl=COALESCE(?,imageUrl), yorubaName=COALESCE(?,yorubaName), hausaName=COALESCE(?,hausaName), igboName=COALESCE(?,igboName), partsUsed=COALESCE(?,partsUsed), preparationMethods=COALESCE(?,preparationMethods), updatedAt=datetime('now') WHERE id=?`,
      [name||null, botanicalName||null, description||null, uses?JSON.stringify(uses):null, traditionalUses?JSON.stringify(traditionalUses):null, family||null, precautions||null, region?JSON.stringify(region):null, imageUrl||null, yorubaName||null, hausaName||null, igboName||null, partsUsed?JSON.stringify(partsUsed):null, preparationMethods?JSON.stringify(preparationMethods):null, req.params.id]);
    res.json({ message: 'Plant updated' });
  } catch (e) { res.status(500).json({ error: 'Failed to update plant' }); }
});

router.delete('/plants/:id', (req, res) => {
  execute('DELETE FROM plants WHERE id = ?', [req.params.id]);
  res.json({ message: 'Plant deleted successfully' });
});

// ── Users ──────────────────────────────────────────────────────────
router.get('/users', (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;
  const users = queryAll<Record<string,unknown>>(`SELECT u.id,u.name,u.email,u.role,u.status,u.createdAt, (SELECT COUNT(*) FROM uploads WHERE userId=u.id) as uploadCount FROM users u ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`, [limit, offset]);
  const total = count('SELECT COUNT(*) as count FROM users');
  res.json({ users: users.map(u => ({ ...u, _count: { uploads: u.uploadCount } })), total, page, totalPages: Math.ceil(total / limit) });
});

router.put('/users/suspend', (req, res) => {
  const { userId, action } = req.body;
  const status = action === 'suspend' ? 'suspended' : 'active';
  execute('UPDATE users SET status=? WHERE id=?', [status, userId]);
  res.json({ message: `User ${status === 'suspended' ? 'suspended' : 'reactivated'}` });
});

router.delete('/users/:id', (req, res) => {
  execute('DELETE FROM users WHERE id = ?', [req.params.id]);
  res.json({ message: 'User deleted' });
});

// ── Uploads ──────────────────────────────────────────────────────────
router.get('/uploads', (req, res) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 20;
  const offset = (page - 1) * limit;
  const uploads = queryAll(`SELECT u.*,us.name as userName,us.email as userEmail FROM uploads u LEFT JOIN users us ON u.userId=us.id ORDER BY u.createdAt DESC LIMIT ? OFFSET ?`, [limit, offset]);
  const total = count('SELECT COUNT(*) as count FROM uploads');
  const mapped = uploads.map((u: Record<string,unknown>) => ({ ...u, user: u.userName ? { name: u.userName, email: u.userEmail } : null }));
  res.json({ uploads: mapped, total, page, totalPages: Math.ceil(total / limit) });
});

// ── Analytics ──────────────────────────────────────────────────────────
router.get('/analytics', (req, res) => {
  const totalUsers = count('SELECT COUNT(*) as count FROM users');
  const activeUsers = count("SELECT COUNT(*) as count FROM users WHERE status='active'");
  const totalUploads = count('SELECT COUNT(*) as count FROM uploads');
  const totalPredictions = count('SELECT COUNT(*) as count FROM uploads WHERE predictedPlant IS NOT NULL');
  const topPlant = queryOne<{ predictedPlant: string; cnt: number }>('SELECT predictedPlant, COUNT(*) as cnt FROM uploads WHERE predictedPlant IS NOT NULL GROUP BY predictedPlant ORDER BY cnt DESC LIMIT 1');
  
  // Weekly uploads (last 7 days)
  const weeklyData = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const c = count(`SELECT COUNT(*) as count FROM uploads WHERE date(createdAt)=?`, [dateStr]);
    weeklyData.push({ date: dateStr, count: c });
  }
  
  res.json({ totalUsers, activeUsers, totalUploads, totalPredictions, mostIdentifiedPlant: topPlant?.predictedPlant || 'N/A', weeklyUploads: weeklyData });
});

export default router;
