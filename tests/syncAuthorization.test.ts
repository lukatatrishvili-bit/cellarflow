import { describe, expect, it } from 'vitest';
import { authorizeSyncPayload } from '../server/routes/sync';

describe('sync authorization', () => {
  it('allows attachment removal when the role can update the target module', () => {
    const userDb = {
      attachments: [
        { id: 'att-cert', module: 'certification', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Lab Technician', userDb, {}, ['att-cert'])).toBeNull();
  });

  it('blocks attachment removal when the role cannot update the target module', () => {
    const userDb = {
      attachments: [
        { id: 'att-doc', module: 'official_docs', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, {}, ['att-doc'])).toMatch(/cannot update attachments/i);
  });

  it('blocks attachment updates when the stored module is not writable even if the incoming module is', () => {
    const userDb = {
      attachments: [
        { id: 'att-doc', module: 'official_docs', fileName: 'doc.pdf', storage: { kind: 'metadata_only' } },
      ],
    };
    const incoming = {
      attachments: [
        { id: 'att-doc', module: 'certification', fileName: 'doc.pdf', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, incoming, undefined)).toMatch(/official_docs/i);
  });

  it('allows attachment updates when the role can update the stored and incoming modules', () => {
    const userDb = {
      attachments: [
        { id: 'att-cert', module: 'certification', fileName: 'cert.pdf', storage: { kind: 'metadata_only' } },
      ],
    };
    const incoming = {
      attachments: [
        { id: 'att-cert', module: 'certification', fileName: 'cert-updated.pdf', storage: { kind: 'metadata_only' } },
      ],
    };

    expect(authorizeSyncPayload('Lab Technician', userDb, incoming, undefined)).toBeNull();
  });

  it('keeps ordinary record deletion behind delete permission', () => {
    const userDb = {
      tasks: [{ id: 'task-1' }],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, {}, ['task-1'])).toBeNull();
    expect(authorizeSyncPayload('Lab Technician', userDb, {}, ['task-1'])).toMatch(/cannot delete tasks/i);
  });
});
