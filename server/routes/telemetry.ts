import express from 'express';
import { parseCookies } from '../middleware/auth';
import { verifySessionToken } from '../auth';
import { getUserData, createEmptyUserData } from '../db';

const router = express.Router();

interface TelemetryReading {
  lotId: string;
  tankId: string;
  timestamp: string;
  density: number; // Specific Gravity (SG)
  temperature: number; // °C
  ph: number;
  dissolvedOxygen: number; // mg/L
  dailySlope: number; // SG drop per day
  status: 'active' | 'slow' | 'stuck' | 'finished';
}

let simulatedTelemetry: Record<string, Record<string, TelemetryReading>> = {};

function initTelemetry(username: string, userDb: any) {
  const fermentingLots = userDb.lots.filter((l: any) => l.stage === 'fermenting');
  if (!simulatedTelemetry[username]) {
    simulatedTelemetry[username] = {};
  }
  const userSimulated = simulatedTelemetry[username];
  const newTelemetry: Record<string, TelemetryReading> = {};
  
  for (const lot of fermentingLots) {
    const vessel = userDb.vessels.find((v: any) => v.assignedLotId === lot.id);
    if (!vessel) continue;
    
    if (userSimulated[lot.id]) {
      newTelemetry[lot.id] = userSimulated[lot.id];
      newTelemetry[lot.id].tankId = vessel.id;
    } else {
      const isStuck = lot.name.toLowerCase().includes('stuck') || lot.id.toLowerCase().includes('stuck');
      newTelemetry[lot.id] = {
        lotId: lot.id,
        tankId: vessel.id,
        timestamp: new Date().toISOString(),
        density: isStuck ? 1.024 : 1.012,
        temperature: isStuck ? 15.5 : 21.8,
        ph: 3.5,
        dissolvedOxygen: isStuck ? 0.04 : 0.35,
        dailySlope: isStuck ? 0.0008 : 0.012,
        status: isStuck ? 'stuck' : 'active'
      };
    }
  }
  simulatedTelemetry[username] = newTelemetry;
}

// GET /api/telemetry/active
router.get('/active', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies['maranios_session'];
  const session = verifySessionToken(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userDb = await getUserData(session.username) || createEmptyUserData();

  initTelemetry(session.username, userDb);

  const userSimulated = simulatedTelemetry[session.username] || {};
  Object.keys(userSimulated).forEach((lotId) => {
    const t = userSimulated[lotId];
    t.timestamp = new Date().toISOString();
    
    if (t.status === 'stuck') {
      t.density = parseFloat((t.density - 0.00005 + (Math.random() - 0.5) * 0.0001).toFixed(4));
      t.temperature = parseFloat((15.5 + (Math.random() - 0.5) * 0.3).toFixed(1));
      t.dailySlope = 0.0008;
    } else if (t.status === 'active') {
      t.density = parseFloat((t.density - 0.0012 + (Math.random() - 0.5) * 0.0002).toFixed(4));
      t.temperature = parseFloat((21.8 + (Math.random() - 0.5) * 0.5).toFixed(1));
      t.dailySlope = 0.012;
      if (t.density <= 0.992) {
        t.density = 0.992;
        t.status = 'finished';
        t.dailySlope = 0;
      }
    }
  });

  res.json(Object.values(userSimulated));
});

export default router;
