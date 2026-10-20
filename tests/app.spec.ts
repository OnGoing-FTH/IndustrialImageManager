import { expect, test } from '@playwright/test';
test('renders workspace and keeps the grid virtualized', async ({ page }) => {
  await page.addInitScript(() => {
    window.datasetApi = {
      chooseDataset: async () => null, scanDataset: async () => [], thumbnail: async () => null,
      chooseExport: async () => null, exportDataset: async () => '', revealPath: async () => undefined,
      deduplicate: async (items) => ({ records: items, removed: 0 }),
      loadReviewTags: async () => ({}), saveReviewTags: async () => undefined,
    };
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '图像审查' })).toBeVisible();
  await expect(page.getByText('打开一个图像数据集')).toBeVisible();
});

test('filters, selection, management tags and export controls work', async ({ page }) => {
  await page.addInitScript((records) => {
    window.datasetApi = {
      chooseDataset: async () => '/fixture',
      scanDataset: async () => records,
      thumbnail: async () => 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=',
      chooseExport: async () => null,
      exportDataset: async () => '/tmp/manifest.json',
      revealPath: async () => undefined,
      deduplicate: async (items) => ({ records: items, removed: 0 }),
      loadReviewTags: async () => ({}),
      saveReviewTags: async () => undefined,
    };
  }, [
    { id: '/part-a.png', path: '/part-a.png', name: 'part-a.png', width: 100, height: 100, segments: [{ label: '电极缺损', points: [[.1,.1],[.9,.1],[.9,.9],[.1,.9]] }], selected: false, reviewTag: '', phash: null },
    { id: '/part-b.png', path: '/part-b.png', name: 'part-b.png', width: 100, height: 100, segments: [{ label: '电极脏污', points: [[.3,.2],[.7,.2],[.7,.7],[.3,.7]] }], selected: false, reviewTag: '', phash: null },
    { id: '/part-c.png', path: '/part-c.png', name: 'part-c.png', width: 100, height: 100, segments: [], selected: false, reviewTag: '', phash: null },
  ]);
  await page.goto('/');
  await page.getByRole('button', { name: /选择文件夹/ }).click();
  const cards = page.locator('[data-image-card="true"]');
  await expect(cards).toHaveCount(3);
  await expect(page.getByText('3 张图像已载入')).toBeVisible();
  await cards.nth(0).click();
  await expect(page.locator('.selection-check')).toBeVisible();
  await expect(page.getByText('1 张已选择')).toBeVisible();
  await page.getByRole('combobox').nth(0).selectOption('zero');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('part-c.png');
  await page.getByRole('combobox').nth(0).selectOption('any');
  await cards.first().focus();
  await page.keyboard.press('2');
  await expect(cards.first()).toContainText('疑似脏污');
});
