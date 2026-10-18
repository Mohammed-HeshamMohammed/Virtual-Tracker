async (page) => {
  await page.getByRole('button', { name: 'Nova Vanguard', exact: true }).nth(1).click();
  await page.getByRole('button', { name: 'Server Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Rocket', exact: true }).click();
  const shared = await page.evaluate(() => {
    const copies = [...document.querySelectorAll('[data-project-avatar="nova-vanguard"]')];
    return { copies: copies.length, allGlyphs: copies.every(el => el.querySelector('svg')), meta: JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'))['nova-vanguard'].avatarGlyph };
  });
  if (!shared.copies || !shared.allGlyphs || shared.meta !== 'rocket') throw new Error(JSON.stringify(shared));
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.goto('http://127.0.0.1:1427/#dashboard/pm-new?target=nova-vanguard');
  await page.getByRole('button', { name: 'Save changes', exact: true }).waitFor();
  const previews = await page.locator('.np-avatar-field .sf-project-avatar svg').count();
  if (!previews) throw new Error('Project edit preview lost the glyph');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForURL(/pm-project\?target=nova-vanguard/);
  const preserved = await page.evaluate(() => JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'))['nova-vanguard'].avatarGlyph);
  if (preserved !== 'rocket') throw new Error('Editing project dropped its glyph');
  await page.getByRole('button', { name: 'Edit project', exact: true }).click();
  await page.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForURL(/pm-project\?target=nova-vanguard/);
  const removed = await page.evaluate(() => {
    const copies = [...document.querySelectorAll('[data-project-avatar="nova-vanguard"]')];
    return copies.length > 0 && copies.every(el => !el.querySelector('svg') && !el.querySelector('img') && el.textContent === 'NV');
  });
  if (!removed) throw new Error('Cleared glyph did not update everywhere');
  return { shared, editorPreview: true, preserved, removed };
}
