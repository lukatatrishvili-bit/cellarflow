import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

interface Fixture {
  task: { id: string; title: string };
  owner: { identifier: string; passphrase: string };
  reader: { identifier: string; passphrase: string };
}

async function resetFixture(page: Page): Promise<Fixture> {
  const response = await page.request.post('/api/e2e/reset');
  expect(response.ok()).toBe(true);
  return response.json() as Promise<Fixture>;
}

async function signIn(
  page: Page,
  credentials: { identifier: string; passphrase: string },
): Promise<void> {
  const identifier = page.locator('#auth-login-identifier');
  const marketingSignIn = page.getByRole('link', { name: 'Sign in', exact: true }).first();
  await expect(identifier.or(marketingSignIn)).toBeVisible();
  if (!await identifier.isVisible()) {
    await marketingSignIn.click();
    await expect(identifier).toBeVisible();
  }
  await identifier.fill(credentials.identifier);
  await page.locator('#auth-login-passcode').fill(credentials.passphrase);
  await page.getByRole('button', { name: 'Enter workspace' }).click();
  await expect(page.getByRole('button', { name: 'Log Out' })).toBeVisible();
}

test('owner signs in and reaches the operational overview', async ({ page }) => {
  const fixture = await resetFixture(page);
  let backgroundSyncRequests = 0;
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/sync') {
      backgroundSyncRequests += 1;
    }
  });

  // The root path serves the public marketing page rather than bouncing to the
  // login screen; signing in is reached from there.
  await page.goto('/');
  await page.getByRole('link', { name: 'Sign in' }).first().click();
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, fixture.owner);
  await expect(page).toHaveURL(/\/dashboard$/);

  const dashboard = page.getByRole('region', { name: 'Customizable dashboard' });
  await expect(dashboard.getByText('Release Gate Estate', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Today at Release Gate Estate/ })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Module navigation' })).toBeVisible();
  await page.waitForTimeout(750);
  expect(backgroundSyncRequests).toBe(0);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('task deep link survives authentication and focuses the exact task', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto(`/tasks?task=${fixture.task.id}`);
  await expect(page).toHaveURL(/\/login$/);
  await signIn(page, fixture.owner);
  await expect(page).toHaveURL(new RegExp(`/tasks\\?task=${fixture.task.id}$`));

  const task = page.locator(`#task-${fixture.task.id}`);
  await expect(task).toBeVisible();
  await expect(task).toContainText(fixture.task.title);
  await expect(task).toBeFocused();
});

test('authenticated login and logout replace protected history entries', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/welcome');
  // The subject here is the protected route, which must still bounce a signed
  // out visitor to the login screen — unlike the public root path.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);

  await signIn(page, fixture.owner);
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/welcome$/);
  await page.goForward();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto('/login');
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: 'Log Out' }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goBack();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Log Out' })).toHaveCount(0);
});

test('dashboard initialization does not lock module navigation', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/');
  await signIn(page, fixture.owner);
  await expect(page).toHaveURL(/\/dashboard$/);

  const navigation = page.getByRole('navigation', { name: 'Module navigation' });
  const vineyard = navigation.getByRole('button', { name: 'Vineyard' });
  const cellar = navigation.getByRole('button', { name: 'Cellar' });
  const today = navigation.getByRole('button', { name: 'Today' });

  await vineyard.click();
  await expect(vineyard).toHaveAttribute('aria-current', 'page');

  await cellar.click();
  await expect(cellar).toHaveAttribute('aria-current', 'page');

  await today.click();
  await expect(today).toHaveAttribute('aria-current', 'page');
});

test('owner can open the operations control workflows', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/');
  await signIn(page, fixture.owner);

  const navigation = page.getByRole('navigation', { name: 'Module navigation' });
  await navigation.getByRole('button', { name: 'Cellar' }).click();

  await page.getByRole('button', { name: 'Recall', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lot containment cockpit' })).toBeVisible();

  await page.getByRole('button', { name: 'Purchasing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Purchasing and receiving' })).toBeVisible();

  await page.getByRole('button', { name: 'Planner', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Visual production schedule' })).toBeVisible();
});

test('unfinished task draft survives a browser refresh', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto(`/tasks?task=${fixture.task.id}`);
  await signIn(page, fixture.owner);

  await page.getByRole('textbox', { name: 'Task Title *' }).fill('Rack the release-gate lot');
  await page.getByRole('textbox', { name: 'Description / Details' }).fill('Retain this draft through refresh.');
  await page.locator('input[name="dueDate"]').fill('30/07/2026');
  await page.waitForTimeout(650);
  await page.reload();

  await expect(page.getByRole('status').filter({ hasText: 'Your saved task draft was restored.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Task Title *' })).toHaveValue('Rack the release-gate lot');
  await expect(page.getByRole('textbox', { name: 'Description / Details' })).toHaveValue('Retain this draft through refresh.');
  await expect(page.locator('input[name="dueDate"]')).toHaveValue('30/07/2026');
});

test('read-only role can inspect a task without mutation controls', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto(`/tasks?task=${fixture.task.id}`);
  await signIn(page, fixture.reader);

  const task = page.locator(`#task-${fixture.task.id}`);
  await expect(task).toBeVisible();
  await expect(page.getByText('You can browse cellar tasks, but your role cannot create new tasks.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Assign Task Directive' })).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: `${fixture.task.title} cannot be updated by your role` })).toBeDisabled();
  await expect(page.getByRole('button', { name: `Delete ${fixture.task.title}` })).toHaveCount(0);
});
