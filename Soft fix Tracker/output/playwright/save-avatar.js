async (page) => {
  const frame = page.getByRole('group', { name: /The part of the picture that shows/ });
  await frame.press('Equal');
  await frame.press('Equal');
  await frame.press('ArrowRight');
  await page.getByRole('button', { name: 'Use this picture', exact: true }).click();
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.waitForURL(/pm-project\?target=nova-vanguard/);
  const result = await page.evaluate(() => {
    const meta = JSON.parse(localStorage.getItem('softfix.ui.v2.dashboard.project-meta'))['nova-vanguard'];
    return { gif: meta.avatar.startsWith('data:image/gif'), crop: meta.avatarCrop,
      copies: Array.from(document.querySelectorAll('[data-project-avatar="nova-vanguard"]')).map(el => ({ srcMatches: el.querySelector('img')?.src === meta.avatar, width: el.clientWidth, style: el.querySelector('img')?.getAttribute('style') })) };
  });
  if (!result.gif || result.crop.zoom <= 1 || !result.copies.every(item => item.srcMatches)) throw new Error(JSON.stringify(result));
  console.log(JSON.stringify(result));
}
