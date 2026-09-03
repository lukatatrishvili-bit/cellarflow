import { expect, test } from '@playwright/test';

test('Georgian sign-in and mobile navigation remain usable', async ({ page }) => {
  const fixtureResponse = await page.request.post('/api/e2e/reset');
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json() as {
    georgian: { identifier: string; passphrase: string };
  };

  await page.goto('/login');
  await page.locator('[aria-label="Choose language"] button').last().click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'ka');
  await page.locator('#auth-login-identifier').fill(fixture.georgian.identifier);
  await page.locator('#auth-login-passcode').fill(fixture.georgian.passphrase);
  await page.locator('form button[type="submit"]').click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'ka');
  const menu = page.getByRole('button', { name: 'მენიუ', exact: true });
  await expect(menu).toBeVisible();
  await menu.click();
  await expect(page.getByRole('menu')).toBeVisible();
});

test('cellar map remains focused and self-contained on a phone', async ({ page }) => {
  const fixtureResponse = await page.request.post('/api/e2e/reset');
  expect(fixtureResponse.ok()).toBe(true);
  const fixture = await fixtureResponse.json() as {
    owner: { identifier: string; passphrase: string };
  };

  await page.goto('/login');
  await page.locator('#auth-login-identifier').fill(fixture.owner.identifier);
  await page.locator('#auth-login-passcode').fill(fixture.owner.passphrase);
  await page.locator('form button[type="submit"]').click();

  await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Cellar', exact: true }).click();
  await page.getByLabel('Winery section').selectOption('cellar');
  await page.getByRole('button', { name: 'By vessel', exact: true }).click();
  await page.getByRole('button', { name: 'Cellar plan', exact: true }).click();

  const module = page.getByTestId('winery-plan-module');
  await expect(module.getByRole('navigation', { name: 'Winery plan navigation' })).toBeVisible();
  const plan = module.getByTestId('winery-plan-stage');
  await expect(plan.getByRole('button', { name: 'X-ray', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(plan.getByRole('combobox', { name: 'Vessel labels' })).toHaveValue('lot');
  await expect(plan.getByRole('button', { name: 'Open full screen', exact: true })).toBeVisible();
  await plan.getByRole('combobox', { name: 'Vessel labels' }).selectOption('status');
  await expect(plan.getByText('0% · 0 L', { exact: true }).first()).toBeAttached();

  const pageWidth = await page.evaluate(() => ({ viewport: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport + 1);
});
