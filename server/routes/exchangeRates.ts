import express from 'express';
import { normalizeInvoiceCurrency } from '../../lib/currency';
import { checkWineryScope } from '../middleware/auth';
import { getOfficialExchangeRate } from '../exchangeRates';

const router = express.Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validDate(value: unknown): string | null {
  const date = typeof value === 'string' ? value.trim() : '';
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(date) || Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

router.get('/exchange-rate', checkWineryScope('read'), async (req, res) => {
  const fromCurrency = normalizeInvoiceCurrency(req.query.from);
  const toCurrency = normalizeInvoiceCurrency(req.query.to);
  const date = validDate(req.query.date);
  if (!fromCurrency || !toCurrency || !date) {
    return res.status(400).json({
      error: 'from and to must be GEL, EUR, or USD, and date must be YYYY-MM-DD.',
    });
  }
  if (date > new Date().toISOString().slice(0, 10)) {
    return res.status(400).json({ error: 'Official rates cannot be requested for a future date.' });
  }

  try {
    const quote = await getOfficialExchangeRate(fromCurrency, toCurrency, date);
    return res.status(200).json({ ok: true, quote });
  } catch (error) {
    console.error('[exchange-rates] NBG lookup failed', error);
    return res.status(502).json({
      error: 'The official exchange rate is temporarily unavailable. Enter and confirm a manual rate.',
    });
  }
});

export default router;
