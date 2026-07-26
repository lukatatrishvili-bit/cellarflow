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
