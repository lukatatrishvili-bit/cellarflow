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

  it('keeps ordinary record deletion behind delete permission', () => {
    const userDb = {
      tasks: [{ id: 'task-1' }],
    };

    expect(authorizeSyncPayload('Winemaker', userDb, {}, ['task-1'])).toBeNull();
    expect(authorizeSyncPayload('Lab Technician', userDb, {}, ['task-1'])).toMatch(/cannot delete tasks/i);
  });
});
