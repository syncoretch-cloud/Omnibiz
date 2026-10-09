// Role-based permissions (spec §30). Account type decides product capabilities;
// staff role decides admin-portal capabilities. Both are checked server-side on every request.

export const ACCOUNT_PERMISSIONS: Record<string, readonly string[]> = {
  personal: [
    'view', 'search', 'follow', 'save', 'interact', 'message', 'purchase',
    'create_posts', 'apply_jobs', 'manage_cv',
  ],
  customer: ['view', 'search', 'follow', 'save', 'interact', 'message', 'purchase'],
  company: [
    'view', 'search', 'follow', 'save', 'interact', 'message', 'purchase',
    'create_posts', 'create_jobs', 'manage_applications', 'manage_products', 'sell',
    'publish_announcements', 'manage_business_profile', 'view_analytics',
  ],
  wholesaler: [
    'view', 'search', 'follow', 'save', 'interact', 'message', 'purchase',
    'create_posts', 'manage_products', 'sell', 'publish_announcements', 'manage_business_profile', 'view_analytics',
  ],
  retailer: [
    'view', 'search', 'follow', 'save', 'interact', 'message', 'purchase',
    'create_posts', 'manage_products', 'sell', 'publish_announcements', 'manage_business_profile', 'view_analytics',
  ],
};

// Super Admin → Admin → Moderator → Support → Verification Team
export const STAFF_PERMISSIONS: Record<string, readonly string[]> = {
  super_admin: ['*'],
  admin: ['stats', 'users.view', 'users.suspend', 'content', 'reports', 'verification', 'categories', 'broadcast', 'audit'],
  moderator: ['stats', 'users.view', 'users.suspend', 'content', 'reports'],
  support: ['stats', 'users.view', 'reports'],
  verification: ['users.view', 'verification'],
  user: [],
};

export const STAFF_RANK = ['user', 'verification', 'support', 'moderator', 'admin', 'super_admin'];

export function accountCan(accountType: string, perm: string): boolean {
  return ACCOUNT_PERMISSIONS[accountType]?.includes(perm) ?? false;
}

export function staffCan(role: string, perm: string): boolean {
  const perms = STAFF_PERMISSIONS[role] ?? [];
  return perms.includes('*') || perms.includes(perm);
}

export function staffPermissions(role: string): string[] {
  const perms = STAFF_PERMISSIONS[role] ?? [];
  if (perms.includes('*')) return ['*', ...new Set(Object.values(STAFF_PERMISSIONS).flat().filter((p) => p !== '*')), 'staff'];
  return [...perms];
}
