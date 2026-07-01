import { Router, Request, Response } from 'express';
import { queryAll, queryOne } from '../lib/db';

const router = Router();

function parsePlant(p: Record<string,unknown>) {
  if (!p) return p;
  return { ...p, uses: JSON.parse(p.uses as string || '[]'), traditionalUses: JSON.parse(p.traditionalUses as string || '[]'), region: JSON.parse(p.region as string || '[]'), partsUsed: JSON.parse(p.partsUsed as string || '[]'), preparationMethods: JSON.parse(p.preparationMethods as string || '[]') };
}

router.get('/', async (req: Request, res: Response): Promise<void> => {
  const plants = queryAll('SELECT id,name,botanicalName,family,imageUrl,yorubaName,hausaName,igboName,description FROM plants ORDER BY name ASC');
  res.json({ plants });
});

router.get('/name/:name', async (req: Request, res: Response): Promise<void> => {
  const plant = queryOne<Record<string,unknown>>('SELECT * FROM plants WHERE name = ?', [decodeURIComponent(req.params.name)]);
  if (!plant) { res.status(404).json({ error: 'Plant not found' }); return; }
  res.json({ plant: parsePlant(plant) });
});

router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const plant = queryOne<Record<string,unknown>>('SELECT * FROM plants WHERE id = ?', [req.params.id]);
  if (!plant) { res.status(404).json({ error: 'Plant not found' }); return; }
  res.json({ plant: parsePlant(plant) });
});

export default router;
