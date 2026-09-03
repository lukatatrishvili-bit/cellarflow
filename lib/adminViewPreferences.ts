export type AdminUserView = 'all' | 'online' | 'offline' | 'unassigned' | 'disabled' | 'pending';
export type AdminOrgView = 'all' | 'active' | 'suspended' | 'archived' | 'attention';

const KEY = 'vinos_master_admin_views';

export function readAdminViews(): { userView?: AdminUserView; orgView?: AdminOrgView } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    const userViews = ['all', 'online', 'offline', 'unassigned', 'disabled', 'pending'];
    const orgViews = ['all', 'active', 'suspended', 'archived', 'attention'];
    return {
      userView: userViews.includes(saved.userView) ? saved.userView : undefined,
      orgView: orgViews.includes(saved.orgView) ? saved.orgView : undefined,
    };
  } catch { return {}; }
}

export function saveAdminViews(userView: AdminUserView, orgView: AdminOrgView) {
  try { localStorage.setItem(KEY, JSON.stringify({ userView, orgView })); } catch { /* optional preference */ }
}
