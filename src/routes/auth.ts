import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, queryAll, execute, count } from '../lib/db';
import { signToken } from '../lib/jwt';
import { authenticate, AuthRequest } from '../middleware/auth';

const router = Router();

const registerSchema = z.object({ name: z.string().min(2).max(100), email: z.string().email(), password: z.string().min(8).max(100) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/register', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = registerSchema.parse(req.body);
    const existing = queryOne('SELECT id FROM users WHERE email = ?', [body.email]);
    if (existing) { res.status(409).json({ error: 'An account with this email already exists' }); return; }
    const hashed = await bcrypt.hash(body.password, 12);
    const id = uuidv4();
    execute(`INSERT INTO users (id,name,email,password,role,status) VALUES (?,?,?,?,'user','active')`, [id, body.name, body.email, hashed]);
    execute(`INSERT INTO activity_logs (id,userId,action,details) VALUES (?,?,?,?)`, [uuidv4(), id, 'USER_REGISTERED', `New user: ${body.email}`]);
    const token = signToken({ userId: id, email: body.email, role: 'user' });
    res.status(201).json({ user: { id, name: body.name, email: body.email, role: 'user' }, token });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Validation failed', details: error.errors }); return; }
    console.error(error); res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const body = loginSchema.parse(req.body);
    const user = queryOne<{ id: string; name: string; email: string; password: string; role: string; status: string; createdAt: string }>('SELECT * FROM users WHERE email = ?', [body.email]);
    if (!user) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    if (user.status === 'suspended') { res.status(403).json({ error: 'Your account has been suspended' }); return; }
    const match = await bcrypt.compare(body.password, user.password);
    if (!match) { res.status(401).json({ error: 'Invalid email or password' }); return; }
    execute(`INSERT INTO activity_logs (id,userId,action,details) VALUES (?,?,?,?)`, [uuidv4(), user.id, 'USER_LOGIN', `Login from ${req.ip}`]);
    const token = signToken({ userId: user.id, email: user.email, role: user.role });
    res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt }, token });
  } catch (error) {
    if (error instanceof z.ZodError) { res.status(400).json({ error: 'Validation failed', details: error.errors }); return; }
    res.status(500).json({ error: 'Login failed' });
  }
});

router.post('/logout', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user) execute(`INSERT INTO activity_logs (id,userId,action) VALUES (?,?,?)`, [uuidv4(), req.user.userId, 'USER_LOGOUT']);
  res.json({ message: 'Logged out successfully' });
});

router.get('/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const user = queryOne<Record<string,unknown>>('SELECT id,name,email,role,status,createdAt FROM users WHERE id = ?', [req.user!.userId]);
  if (!user) { res.status(404).json({ error: 'User not found' }); return; }
  res.json({ user });
});

router.get('/history', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const offset = (page - 1) * limit;
  const uploads = queryAll('SELECT * FROM uploads WHERE userId = ? ORDER BY createdAt DESC LIMIT ? OFFSET ?', [req.user!.userId, limit, offset]);
  const total = count('SELECT COUNT(*) as count FROM uploads WHERE userId = ?', [req.user!.userId]);
  res.json({ uploads, total, page, totalPages: Math.ceil(total / limit) });
});

export default router;
