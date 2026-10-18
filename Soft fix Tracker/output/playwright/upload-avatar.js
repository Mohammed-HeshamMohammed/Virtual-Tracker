async (page) => {
  await page.getByRole('button', { name: 'Upload image', exact: true }).setInputFiles('X:/Virtual-Tracker/Soft fix Tracker/output/playwright/project-picture.gif');
}
