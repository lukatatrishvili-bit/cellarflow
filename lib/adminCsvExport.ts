function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildAdminCsv(headers: string[], rows: unknown[][]): string {
  return `\uFEFF${[headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')}`;
}

export function downloadAdminCsv(filename: string, headers: string[], rows: unknown[][]): void {
  const csv = buildAdminCsv(headers, rows);
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export type AdminExportUser = {
  username: string;
  fullName: string;
  email: string;
  role: string;
  accountEnabled: boolean;
  approvalStatus?: string;
  isOnline: boolean;
  lastSeenAt: string | null;
  activeOrganizationId: string | null;
  organizations: Array<{ name: string; role: string }>;
};

export type AdminExportOrganization = {
  name: string;
  id: string;
  status: string;
  health: { level: string; issues: string[] };
  membersCount: number;
  ownersCount: number;
  onlineMembersCount: number;
  pendingInvitationsCount: number;
  lastActivity: string | null;
  internalTags: string[];
  dataSize: number;
};

export function exportAdminUsers(users: AdminExportUser[]): void {
  downloadAdminCsv(`vinos-users-${new Date().toISOString().slice(0, 10)}.csv`, [
    'Username', 'Full name', 'Email', 'Platform role', 'Status', 'Online', 'Last seen', 'Active organization', 'Memberships',
  ], users.map(user => [
    user.username, user.fullName, user.email, user.role,
    user.accountEnabled === false ? 'disabled' : user.approvalStatus || 'approved',
    user.isOnline ? 'yes' : 'no', user.lastSeenAt || '', user.activeOrganizationId || '',
    user.organizations.map(org => `${org.name} (${org.role})`).join('; '),
  ]));
}

export function exportAdminOrganizations(organizations: AdminExportOrganization[]): void {
  downloadAdminCsv(`vinos-organizations-${new Date().toISOString().slice(0, 10)}.csv`, [
    'Organization', 'ID', 'Status', 'Health', 'Health issues', 'Members', 'Owners', 'Online members', 'Pending invitations', 'Last activity', 'Tags', 'Data bytes',
  ], organizations.map(org => [
    org.name, org.id, org.status, org.health.level, org.health.issues.join('; '), org.membersCount,
    org.ownersCount, org.onlineMembersCount, org.pendingInvitationsCount, org.lastActivity || '',
    org.internalTags.join('; '), org.dataSize,
  ]));
}
