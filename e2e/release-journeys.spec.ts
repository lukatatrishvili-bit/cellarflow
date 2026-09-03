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

test('winemaker can work with lots and vessels from one focused cellar workspace', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/');
  await signIn(page, fixture.owner);

  const navigation = page.getByRole('navigation', { name: 'Module navigation' });
  await navigation.getByRole('button', { name: 'Cellar' }).click();
  await page.getByRole('button', { name: 'Cellar workspace', exact: true }).click();

  const workspace = page.getByTestId('cellar-workspace');
  await expect(workspace.getByRole('heading', { name: 'Wine and vessels' })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'By lot', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace).toContainText('Quick actions');
  await expect(workspace).not.toContainText('Stock now');
  await expect(workspace).not.toContainText('Lot cost');

  await workspace.getByRole('button', { name: 'By vessel', exact: true }).click();
  await expect(workspace.getByText('Vessel register', { exact: true })).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'By vessel', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.getByRole('img', { name: '0% full' }).first()).toBeVisible();
  await expect(workspace.getByRole('button', { name: 'Receive transfer', exact: true })).toBeVisible();
  await expect(workspace).not.toContainText('Thermal Intelligence Loop');

  await workspace.getByRole('button', { name: 'Cellar plan', exact: true }).click();
  const wineryPlan = page.getByTestId('winery-plan-module');
  await expect(wineryPlan.getByRole('navigation', { name: 'Winery plan navigation' })).toBeVisible();
  await expect(wineryPlan.getByRole('button', { name: 'Top-down', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Both views are the same WebGL room under a different camera, so the stage
  // never unmounts and every control stays put across the switch.
  const stage = wineryPlan.getByTestId('winery-plan-stage');
  await expect(stage).toHaveAttribute('data-plan-view', 'top-down');
  await expect(stage.getByRole('tab', { name: /Main cellar/ })).toHaveAttribute('aria-selected', 'true');
  await expect(stage.getByRole('slider', { name: 'Zoom level' })).toHaveValue('100');
  await expect(stage.getByRole('combobox', { name: 'Find vessel on plan' })).toBeVisible();
  await expect(stage.getByRole('button', { name: 'X-ray', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const planVessel = stage.getByRole('button', { name: 'Q-01 · 0% full', exact: true });
  await expect(planVessel).toBeAttached();

  await wineryPlan.getByRole('button', { name: '3D', exact: true }).click();
  await expect(stage).toHaveAttribute('data-plan-view', '3d');
  await expect(stage.getByRole('slider', { name: 'Zoom level' })).toBeVisible();
  await expect(planVessel).toBeAttached();
  await wineryPlan.getByRole('button', { name: 'Top-down', exact: true }).click();
  await expect(stage).toHaveAttribute('data-plan-view', 'top-down');

  await stage.getByRole('button', { name: 'Edit layout', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'Done', exact: true })).toBeVisible();
  await expect(stage.getByRole('checkbox', { name: 'Snap to grid' })).toBeChecked();
  await stage.getByRole('combobox', { name: 'Find vessel on plan' }).selectOption('Q-01');
  const easting = stage.getByRole('spinbutton', { name: 'X, m' });
  const startingEasting = await easting.inputValue();
  await easting.fill(String(Number(startingEasting) + 3));
  await easting.blur();
  await stage.getByRole('button', { name: 'Save layout', exact: true }).click();
  await expect(stage.getByRole('button', { name: 'Edit layout', exact: true })).toBeVisible();
  await expect(stage.getByRole('spinbutton', { name: 'X, m' })).not.toHaveValue(startingEasting);
});

test('owner can open business containment and cellar planning workflows', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/');
  await signIn(page, fixture.owner);

  const navigation = page.getByRole('navigation', { name: 'Module navigation' });
  const workspaceNav = page.getByRole('complementary');
  await navigation.getByRole('button', { name: 'Today' }).click();
  await workspaceNav.getByRole('button', { name: 'Work Queue', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today’s work and approvals' })).toBeVisible();

  await navigation.getByRole('button', { name: 'Stock & Sales' }).click();
  await workspaceNav.getByRole('button', { name: 'Product Recall', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lot containment cockpit' })).toBeVisible();

  await workspaceNav.getByRole('button', { name: 'Purchasing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Purchasing and receiving' })).toBeVisible();

  await navigation.getByRole('button', { name: 'Cellar' }).click();
  await workspaceNav.getByRole('button', { name: 'Production plan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Operational production plan' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Work agenda' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByText('Missing links', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Add work', exact: true }).click();
  const lotPicker = page.getByLabel('Wine lot');
  await lotPicker.selectOption({ index: 1 });
  const vesselPicker = page.getByLabel('Source or destination vessel');
  await vesselPicker.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Add vessel', exact: true }).click();
  await vesselPicker.selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Add vessel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Add to plan', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Add to plan', exact: true }).click();
  await page.getByRole('button', { name: 'Start transfer', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Winery Liquid Movement & Pomace Blending Panel' })).toBeVisible();
  await expect(page.getByText('Step 1: Select Source Vessel')).toBeVisible();
  await expect(page.getByRole('spinbutton').first()).toHaveValue('2500');
});

test('winemaker can turn live cellar evidence into editable production work', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/');
  await signIn(page, fixture.owner);

  const navigation = page.getByRole('navigation', { name: 'Module navigation' });
  await navigation.getByRole('button', { name: 'Cellar' }).click();
  await page.getByRole('button', { name: 'Production plan', exact: true }).click();

  const intelligenceButton = page.getByRole('button', { name: /Plan intelligence/ });
  await expect(intelligenceButton).toContainText('9');
  await intelligenceButton.click();
  const intelligence = page.getByRole('region', { name: 'Live production picture' });
  await expect(intelligence).toContainText('Ready capacity');
  await expect(intelligence.getByRole('button', { name: 'Plan it' })).toHaveCount(8);

  await intelligence.getByRole('button', { name: 'Plan it' }).first().click();
  await expect(intelligenceButton).toContainText('8');
  await page.getByRole('tab', { name: 'Flow' }).click();
  const flow = page.getByRole('region', { name: 'Production flow board' });
  await expect(flow.getByRole('heading', { name: 'Planned' })).toBeVisible();
  await expect(flow).toContainText('AL-24');

  await flow.getByRole('button', { name: 'Details' }).click();
  const item = page.getByRole('heading', { name: /Fermentation reading · ალექსანდროული/ }).locator('xpath=ancestor::article');
  await item.getByText('Details and controls').click();
  await item.getByRole('button', { name: /Edit Fermentation reading/ }).click();
  await item.getByLabel('Title').fill('Daily fermentation check · AL-24');
  await item.getByLabel('Start').fill('2026-08-29');
  await item.getByLabel('End').fill('2026-08-29');
  await item.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Daily fermentation check · AL-24' })).toBeVisible();

  const accessibility = await new AxeBuilder({ page })
    .include('[data-testid="production-planner"]')
    .disableRules(['color-contrast'])
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('owner can pause every notification channel and resume immediately', async ({ page }) => {
  const fixture = await resetFixture(page);
  await page.goto('/');
  await signIn(page, fixture.owner);

  const bell = page.getByRole('button', { name: /^Notifications:/ });
  await bell.click();
  const center = page.getByRole('dialog', { name: 'Notification center' });
  await center.getByRole('button', { name: 'Mute', exact: true }).click();
  await center.getByRole('button', { name: '1 hour', exact: true }).click();

  await expect(center).toContainText('Every channel is paused until');
  await expect(page.getByRole('button', { name: /^Notifications paused until/ })).toBeVisible();

  await center.getByRole('button', { name: 'Resume', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Notifications:/ })).toBeVisible();
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
