import { describe, expect, it } from 'vitest';
import { validateInvoiceAnalysisRequest } from '../server/invoiceAnalyzer';

describe('invoice analyzer upload validation', () => {
  it('accepts pasted invoice text without a file', () => {
    expect(validateInvoiceAnalysisRequest({ invoiceText: 'Invoice INV-1\nYeast 2 kg' }))
      .toMatchObject({ invoiceText: 'Invoice INV-1\nYeast 2 kg' });
  });

  it('accepts a PDF only when content and declared type agree', () => {
    const dataUrl = `data:application/pdf;base64,${Buffer.from('%PDF-1.7\ninvoice').toString('base64')}`;
    expect(validateInvoiceAnalysisRequest({
      file: { fileName: 'invoice.pdf', mimeType: 'application/pdf', dataUrl },
    }).file).toMatchObject({ fileName: 'invoice.pdf', mimeType: 'application/pdf' });
  });

  it('rejects mismatched or unsupported invoice content', () => {
    const dataUrl = `data:application/pdf;base64,${Buffer.from('not a PDF').toString('base64')}`;
    expect(() => validateInvoiceAnalysisRequest({
      file: { fileName: 'invoice.pdf', mimeType: 'application/pdf', dataUrl },
    })).toThrow('does not match its file type');
  });

  it('requires either a file or meaningful invoice text', () => {
    expect(() => validateInvoiceAnalysisRequest({ invoiceText: '   ' }))
      .toThrow('Attach an invoice');
  });
});

