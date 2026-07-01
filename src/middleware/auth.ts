import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../lib/jwt';
import { queryOne } from '../lib/db';

export interface AuthRequest extends Request {
  user?: { userId: string; email: string; role: string };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) { res.status(401).json({ error: 'Authentication required' }); return; }
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    const user = queryOne<{ id: string; email: string; role: string; status: string }>('SELECT id,email,role,status FROM users WHERE id=?', [payload.userId]);
    if (!user || user.status === 'suspended') { res.status(401).json({ error: 'Account is inactive or suspended' }); return; }
    req.user = { userId: user.id, email: user.email, role: user.role };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export const optionalAuth = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const payload = verifyToken(token);
      req.user = payload;
    }
  } catch {}
  next();
};

export const requireAdmin = (req: AuthRequest, res: Response, next: NextFunction): void => {
  if (!req.user || req.user.role !== 'admin') { res.status(403).json({ error: 'Admin access required' }); return; }
  next();
};
