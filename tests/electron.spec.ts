import { _electron as electron, expect, test } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

test('Electron shell opens renderer with secure preload bridge', async () => {
  const app = await electron.launch({ args: [path.resolve('electron/main.cjs'), '--no-sandbox'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: 'true' } });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByRole('heading', { name: '图像审查' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => typeof window.datasetApi?.scanDataset)).toBe('function');
  const source = path.resolve('POCO19标注+图片/#json/POCO19-Top-DJ');
  const result = await page.evaluate(async (folder) => {
    const records = await window.datasetApi.scanDataset(folder);
    const positive = records.find((record) => record.segments.length > 0);
    const thumbnail = await window.datasetApi.thumbnail(positive.path, 160, false);
    return { count: records.length, positiveCount: records.filter((record) => record.segments.length).length, label: positive.segments[0].label, thumbnail };
  }, source);
  expect(result.count).toBeGreaterThan(10);
  expect(result.positiveCount).toBeGreaterThan(0);
  expect(result.thumbnail).toMatch(/^data:image\/jpeg;base64,/);

  const output = await fs.mkdtemp(path.join(os.tmpdir(), 'industrial-export-'));
  const manifestPath = await page.evaluate(async ({ folder, destination }) => {
    const records = await window.datasetApi.scanDataset(folder);
    const chosen = records.filter((record) => record.segments.length).slice(0, 2).map((record) => ({ ...record, selected: true }));
    return window.datasetApi.exportDataset({ records: chosen, output: destination, valRatio: 0.5, splitEnabled: true });
  }, { folder: source, destination: output });
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  expect(manifest.total).toBe(2);
  expect(manifest.class_names).toBeTruthy();
  await expect(fs.readFile(path.join(output, 'data.yaml'), 'utf8')).resolves.toContain('train: images/train');
  await app.close();
});
