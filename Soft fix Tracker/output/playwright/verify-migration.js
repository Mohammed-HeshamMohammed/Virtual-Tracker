async (page) => {
  const results = [];
  const easy = await page.evaluate(() => ({
    copies: document.querySelectorAll('[data-project-avatar="nova-vanguard"] img').length,
    labelDirections: [...document.querySelectorAll('.sf-project-label')].map(el => getComputedStyle(el).flexDirection),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  if (!easy.copies || easy.labelDirections.some(dir => dir !== 'row') || easy.overflow) throw new Error(JSON.stringify(easy));
  results.push({ easy });
  await page.screenshot({ path: 'output/playwright/easy-project-avatar.png' });
  const fullApp = page.getByRole('button', { name: 'Everything else Open the full Soft Fix', exact: true });
  if (await fullApp.count()) await fullApp.click();
  await page.evaluate(() => {
    const loungeKey = 'softfix.ui.v2.lounge';
    const data = JSON.parse(localStorage.getItem(loungeKey));
    const meta = JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'));
    data.serverIcons = {
      'nova-vanguard': { glyph: 'flame' },
      'buffalo-campaign': { image: meta['nova-vanguard'].avatar },
      rws: { glyph: 'rocket' },
      workplace: { glyph: 'heart' },
    };
    localStorage.setItem(loungeKey, JSON.stringify(data));
  });
  await page.reload();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'))?.['buffalo-campaign']?.avatar && JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'))?.rws?.avatarGlyph);
  const migrated = await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'));
    const icons = JSON.parse(localStorage.getItem('softfix.ui.v2.lounge')).serverIcons;
    return { mainWins: !!meta['nova-vanguard'].avatar && !meta['nova-vanguard'].avatarGlyph,
      legacyImage: meta['buffalo-campaign'].avatar === meta['nova-vanguard'].avatar,
      legacyGlyph: meta.rws.avatarGlyph, remainingKeys: Object.keys(icons), workplace: icons.workplace.glyph };
  });
  if (!migrated.mainWins || !migrated.legacyImage || migrated.legacyGlyph !== 'rocket' || migrated.remainingKeys.length !== 1 || migrated.workplace !== 'heart') throw new Error(JSON.stringify(migrated));
  results.push({ migrated });
  // The same project ID in another organization must resolve to that organization's picture.
  await page.evaluate(() => {
    const registry = JSON.parse(localStorage.getItem('softfix.orgs.v1'));
    registry.orgs.push({ id: 'avatar-check', name: 'Avatar check', createdAt: new Date().toISOString() });
    registry.active = 'avatar-check';
    localStorage.setItem('softfix.orgs.v1', JSON.stringify(registry));
    localStorage.setItem('softfix.ui.v2.org.avatar-check.projects', JSON.stringify([{ id: 'nova-vanguard', name: 'Other project', color: 'green', tasks: [] }]));
    localStorage.setItem('softfix.ui.v2.org.avatar-check.dashboard.project-meta', JSON.stringify({ 'nova-vanguard': { description: '', budget: 0, due: '' } }));
  });
  await page.reload();
  await page.locator('[data-project-avatar="nova-vanguard"]').first().waitFor({ state: 'attached' });
  const isolated = await page.evaluate(() => ({
    copies: document.querySelectorAll('[data-project-avatar="nova-vanguard"]').length,
    leakedImages: document.querySelectorAll('[data-project-avatar="nova-vanguard"] img').length,
  }));
  if (!isolated.copies || isolated.leakedImages) throw new Error(JSON.stringify(isolated));
  results.push({ isolated });
  await page.evaluate(() => {
    const registry = JSON.parse(localStorage.getItem('softfix.orgs.v1'));
    registry.active = 'main';
    registry.orgs = registry.orgs.filter(org => org.id !== 'avatar-check');
    localStorage.setItem('softfix.orgs.v1', JSON.stringify(registry));
    for (const key of Object.keys(localStorage)) if (key.startsWith('softfix.ui.v2.org.avatar-check.')) localStorage.removeItem(key);
  });
  await page.reload();
  await page.locator('[data-project-avatar="nova-vanguard"] img').first().waitFor({ state: 'attached' });
  const restored = await page.locator('[data-project-avatar="nova-vanguard"] img').count();
  if (!restored) throw new Error('Main organization picture did not restore');
  results.push({ restored });
  return results;
}
