async (page) => {
  const results = [];
  const verify = async (label, expectedImage = true) => {
    const result = await page.evaluate(({ label, expectedImage }) => {
      const meta = JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'))['nova-vanguard'];
      const copies = [...document.querySelectorAll('[data-project-avatar="nova-vanguard"]')];
      return { label, copies: copies.length, visible: copies.filter(el => el.getClientRects().length).length,
        correct: copies.length > 0 && copies.every(el => expectedImage ? el.querySelector('img')?.src === meta.avatar : !el.querySelector('img')),
        loaded: copies.every(el => !el.querySelector('img') || el.querySelector('img').naturalWidth > 0),
        overflow: document.documentElement.scrollWidth > innerWidth };
    }, { label, expectedImage });
    if (!result.correct || result.overflow) throw new Error(JSON.stringify(result));
    results.push(result);
  };
  await verify('cropped GIF in Lounge and mounted Work/Dashboard');
  await page.getByRole('button', { name: 'Server Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await verify('remove in Lounge updates all mounted modes', false);
  await page.getByRole('button', { name: 'Upload image', exact: true }).setInputFiles('X:/Virtual-Tracker/Soft fix Tracker/output/playwright/project-picture.png');
  await page.getByRole('button', { name: 'Use this picture', exact: true }).click();
  await verify('replace in Lounge updates all mounted modes');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/lounge-project-avatar.png' });
  await page.getByRole('button', { name: 'Work', exact: true }).click();
  await verify('Work overview and sidebar');
  await page.getByRole('button', { name: 'My tasks', exact: true }).click();
  await verify('Work tasks');
  await page.getByRole('button', { name: 'My timesheet', exact: true }).click();
  await verify('Work timesheet');
  await page.getByRole('button', { name: 'My schedule', exact: true }).click();
  await verify('Work schedule');
  await page.getByRole('button', { name: 'Dashboard', exact: true }).click();
  await verify('Dashboard project detail');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await verify('Dashboard overview');
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await verify('Projects overview');
  await page.reload();
  await verify('picture persists after reload');
  await page.getByRole('button', { name: 'Change the window', exact: true }).click();
  await page.getByRole('menuitem', { name: /Focus mode/ }).click();
  await verify('Focus mode');
  await page.screenshot({ path: 'output/playwright/focus-project-avatar.png' });
  return results;
}
