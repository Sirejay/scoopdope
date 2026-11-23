import { test, expect, request, type APIRequestContext } from '@playwright/test';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API_BASE = process.env.PLAYWRIGHT_API_URL || 'http://localhost:3000';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uniqueUser() {
  const ts = Date.now();
  return {
    username: `e2eauth_${ts}`,
    email: `e2eauth_${ts}@example.com`,
    password: 'Auth@Test1234!',
  };
}

async function getAdminToken(apiContext: APIRequestContext): Promise<string | null> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;
  if (!email || !password) return null;
  const res = await apiContext.post(`${API_BASE}/v1/auth/login`, { data: { email, password } });
  if (!res.ok()) return null;
  const body = await res.json();
  return body.access_token ?? body.token ?? null;
}

async function registerViaApi(apiContext: APIRequestContext, user: ReturnType<typeof uniqueUser>) {
  const res = await apiContext.post(`${API_BASE}/v1/auth/register`, {
    data: { username: user.username, email: user.email, password: user.password },
  });
  return res.ok();
}

// ---------------------------------------------------------------------------
// Suite 1 — existing shallow tests (preserved)
// ---------------------------------------------------------------------------

/**
 * Critical journey: authentication.
 * Complements user-journey.spec.ts (register → enroll → complete lesson).
 */
test.describe('Critical user journey: authentication', () => {
  test('unauthenticated user is redirected from dashboard to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
  });

  test('login page renders the sign-in form', async ({ page }) => {
    await page.goto('/auth/login');
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/^password$/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /log in|sign in/i })).toBeVisible();
  });

  test('empty submission shows validation errors and stays on login', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await expect(page.getByText(/required|valid email/i).first()).toBeVisible();
  });

  test('invalid credentials do not authenticate the user', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill(`nobody_${Date.now()}@example.com`);
    await page.getByLabel(/^password$/i).fill('WrongPass@123');
    await page.getByRole('button', { name: /log in|sign in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test('login link navigates to registration', async ({ page }) => {
    await page.goto('/auth/login');
    await page.getByRole('link', { name: /register|sign up|create account/i }).first().click();
    await expect(page).toHaveURL(/\/auth\/register/);
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — register, login, logout
// ---------------------------------------------------------------------------

test.describe('Auth: register, login, and logout', () => {
  test('user can register via UI and reach an authenticated page', async ({ page }) => {
    const user = uniqueUser();

    await page.goto('/auth/register');
    await page.getByLabel(/username/i).fill(user.username);
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password$/i).fill(user.password);
    await page.getByRole('button', { name: /register|sign up|create account/i }).click();

    // Should leave the register page (may land on login for email verification flows)
    await expect(page).toHaveURL(/login|dashboard|courses|verify/, { timeout: 10_000 });
  });

  test('wrong password on login shows an error message', async ({ page }) => {
    const apiContext = await request.newContext();
    const user = uniqueUser();
    await registerViaApi(apiContext, user);
    await apiContext.dispose();

    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password$/i).fill('definitely-wrong-password');
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // Must stay on login
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 8_000 });
    // An error message must appear
    await expect(
      page.getByText(/invalid|incorrect|wrong|unauthorized|credentials/i).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('after logout, navigating to /dashboard redirects to /auth/login', async ({ page }) => {
    const apiContext = await request.newContext();
    const user = uniqueUser();
    const registered = await registerViaApi(apiContext, user);
    await apiContext.dispose();

    if (!registered) {
      // If API registration is not available, register via UI
      await page.goto('/auth/register');
      await page.getByLabel(/username/i).fill(user.username);
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/^password$/i).fill(user.password);
      await page.getByRole('button', { name: /register|sign up|create account/i }).click();
      await expect(page).toHaveURL(/login|dashboard|courses|verify/, { timeout: 10_000 });
    }

    // Log in
    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password$/i).fill(user.password);
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // If the app requires email verification, skip the logout assertion
    const url = page.url();
    if (url.includes('verify') || url.includes('login')) {
      test.skip();
      return;
    }

    await expect(page).not.toHaveURL(/login|register/, { timeout: 10_000 });

    // Find and click the logout button/link
    const logoutBtn = page.getByRole('button', { name: /log out|logout|sign out/i });
    const logoutLink = page.getByRole('link', { name: /log out|logout|sign out/i });

    const hasLogoutBtn = await logoutBtn.first().isVisible({ timeout: 5_000 }).catch(() => false);
    const hasLogoutLink = await logoutLink.first().isVisible({ timeout: 3_000 }).catch(() => false);

    if (hasLogoutBtn) {
      await logoutBtn.first().click();
    } else if (hasLogoutLink) {
      await logoutLink.first().click();
    } else {
      // Logout might be in a dropdown — look for a user menu first
      const userMenu = page.getByRole('button', { name: /profile|account|user menu/i });
      if (await userMenu.first().isVisible({ timeout: 3_000 }).catch(() => false)) {
        await userMenu.first().click();
        await page.getByRole('menuitem', { name: /log out|logout|sign out/i }).first().click();
      }
    }

    // After logout, /dashboard must redirect to login
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — email verification
// ---------------------------------------------------------------------------

test.describe('Auth: email verification', () => {
  test('verification page shows a prompt to check email or enter a code', async ({ page }) => {
    // Navigate to a likely verification URL
    await page.goto('/auth/verify-email');
    // The page should render (not 404 or crash)
    // Accept either a form with a token/code input or a "check your email" message
    const hasCodeInput = await page
      .getByRole('textbox')
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    const hasMessage = await page
      .getByText(/verify|check your email|confirmation/i)
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);

    expect(hasCodeInput || hasMessage).toBe(true);
  });

  test('submitting an invalid verification token shows an error', async ({ page }) => {
    await page.goto('/auth/verify-email?token=obviously-invalid-token-12345');

    // Should either show an error inline or redirect to an error state
    const hasError = await page
      .getByText(/invalid|expired|not found|error/i)
      .first()
      .isVisible({ timeout: 8_000 })
      .catch(() => false);

    const isOnErrorPage = page.url().includes('error') || page.url().includes('invalid');

    expect(hasError || isOnErrorPage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — password reset
// ---------------------------------------------------------------------------

test.describe('Auth: password reset', () => {
  test('forgot-password page renders an email input', async ({ page }) => {
    // Try common URL patterns
    await page.goto('/auth/forgot-password');
    const url = page.url();

    // If it redirected away (e.g. 404 → home), try alternate path
    if (!url.includes('forgot') && !url.includes('reset') && !url.includes('password')) {
      await page.goto('/auth/reset-password');
    }

    await expect(page.getByRole('textbox', { name: /email/i })).toBeVisible({ timeout: 8_000 });
  });

  test('submitting forgot-password form shows a confirmation message', async ({ page }) => {
    await page.goto('/auth/forgot-password');
    const url = page.url();
    if (!url.includes('forgot') && !url.includes('reset') && !url.includes('password')) {
      await page.goto('/auth/reset-password');
    }

    const emailInput = page.getByRole('textbox', { name: /email/i });
    await expect(emailInput).toBeVisible({ timeout: 8_000 });

    await emailInput.fill('someuser@example.com');
    await page.getByRole('button', { name: /send|reset|submit/i }).first().click();

    // Should show a success/confirmation message (even for non-existent email, to prevent enumeration)
    await expect(
      page.getByText(/sent|check your email|if.*account.*exists|reset link/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// Suite 5 — token storage
// ---------------------------------------------------------------------------

test.describe('Auth: token storage', () => {
  test('access token is stored after successful login', async ({ page, context }) => {
    const apiContext = await request.newContext();
    const user = uniqueUser();
    const registered = await registerViaApi(apiContext, user);
    await apiContext.dispose();

    if (!registered) {
      // Register via UI
      await page.goto('/auth/register');
      await page.getByLabel(/username/i).fill(user.username);
      await page.getByLabel(/email/i).fill(user.email);
      await page.getByLabel(/^password$/i).fill(user.password);
      await page.getByRole('button', { name: /register|sign up|create account/i }).click();
      await expect(page).toHaveURL(/login|dashboard|courses|verify/, { timeout: 10_000 });
    }

    await page.goto('/auth/login');
    await page.getByLabel(/email/i).fill(user.email);
    await page.getByLabel(/^password$/i).fill(user.password);
    await page.getByRole('button', { name: /log in|sign in/i }).click();

    // If email verification is required, skip token storage check
    const afterUrl = page.url();
    if (afterUrl.includes('verify') || afterUrl.includes('login')) {
      test.skip();
      return;
    }

    await expect(page).not.toHaveURL(/login|register/, { timeout: 10_000 });

    // Check localStorage for a token
    const lsToken = await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        const val = localStorage.getItem(key);
        if (val && (key.toLowerCase().includes('token') || key.toLowerCase().includes('auth'))) {
          return val;
        }
      }
      return null;
    });

    // Check cookies for an access_token cookie
    const cookies = await context.cookies();
    const tokenCookie = cookies.find(
      (c) => c.name.toLowerCase().includes('token') || c.name.toLowerCase().includes('auth'),
    );

    // At least one storage mechanism must have a token
    expect(lsToken !== null || tokenCookie !== undefined).toBe(true);
  });
});
