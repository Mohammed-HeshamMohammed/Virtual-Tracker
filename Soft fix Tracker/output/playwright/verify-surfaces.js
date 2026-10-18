async (page) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const results = [];
  for (const section of ['pm-projects', 'pm-tasks', 'pm-clients', 'reports-work-sessions', 'reports-project-budgets', 'financials-expenses', 'calendar', 'activity']) {
    await page.goto('http://127.0.0.1:1427/#dashboard/' + section);
    await page.locator('.db-page').first().waitFor();
    const result = await page.evaluate(section => {
      const visible = [...document.querySelectorAll('[data-project-avatar="nova-vanguard"]')].filter(el => el.getClientRects().length);
      return { section, avatars: visible.length, pictures: visible.filter(el => el.querySelector('img')).length, overflow: document.documentElement.scrollWidth > innerWidth };
    }, section);
    if (!result.avatars || result.avatars !== result.pictures || result.overflow) throw new Error(JSON.stringify(result));
    results.push(result);
  }
  // Invalid pictures fall back to the same initials everywhere rather than a broken-image placeholder.
  await page.evaluate(() => {
    const key = 'softfix.ui.v2.dashboard.project-meta';
    const meta = JSON.parse(localStorage.getItem(key));
    meta['nova-vanguard'].avatar = 'data:image/png;base64,invalid';
    localStorage.setItem(key, JSON.stringify(meta));
  });
  await page.reload();
  await page.waitForFunction(() => [...document.querySelectorAll('[data-project-avatar="nova-vanguard"]')].length > 0 && [...document.querySelectorAll('[data-project-avatar="nova-vanguard"]')].every(el => !el.querySelector('img') && el.textContent === 'NV'));
  results.push({ brokenImageFallback: true });
  // A cleared, migrated icon stays cleared after restarting.
  await page.evaluate(() => {
    const key = 'softfix.ui.v2.dashboard.project-meta';
    const meta = JSON.parse(localStorage.getItem(key));
    delete meta['buffalo-campaign'].avatar;
    localStorage.setItem(key, JSON.stringify(meta));
  });
  await page.reload();
  await page.locator('[data-project-avatar="buffalo-campaign"]').first().waitFor({ state: 'attached' });
  const revived = await page.locator('[data-project-avatar="buffalo-campaign"] img').count();
  if (revived) throw new Error('Removed legacy avatar returned');
  results.push({ removedLegacyStaysRemoved: true });
  if (errors.length) throw new Error(JSON.stringify(errors));
  return results;
}
