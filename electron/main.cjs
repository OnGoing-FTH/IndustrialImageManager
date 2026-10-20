const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

const IMAGE_EXTENSIONS = new Set(['.bmp', '.jpeg', '.jpg', '.png', '.tif', '.tiff', '.webp']);
const APP_VERSION = '1.2.0';

function createWindow() {
  const window = new BrowserWindow({
    width: 1520,
    height: 980,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#f3f5f7',
    title: '工业图像管理工具',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (app.isPackaged) window.loadFile(path.join(__dirname, '../dist/index.html'));
  else window.loadURL('http://127.0.0.1:5173');
}

async function walkImages(root) {
  const result = [];
  const stack = [root];
  while (stack.length) {
    const folder = stack.pop();
    const entries = await fs.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) result.push(full);
    }
  }
  return result.sort((a, b) => a.localeCompare(b, 'zh-CN'));
}

async function parseAnnotation(imagePath, width, height) {
  const jsonPath = imagePath.replace(/\.[^.]+$/, '.json');
  try {
    const data = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
    const sourceWidth = Number(data.imageWidth) || width;
    const sourceHeight = Number(data.imageHeight) || height;
    const segments = [];
    for (const shape of data.shapes || []) {
      if (!Array.isArray(shape.points) || shape.points.length < 3) continue;
      const points = shape.points.map(([x, y]) => [
        Math.min(1, Math.max(0, Number(x) / sourceWidth)),
        Math.min(1, Math.max(0, Number(y) / sourceHeight)),
      ]);
      segments.push({ label: String(shape.label || 'unknown'), points });
    }
    return segments;
  } catch (error) {
    if (error.code !== 'ENOENT') return [];
  }

  const txtPath = imagePath.replace(/\.[^.]+$/, '.txt');
  try {
    const text = await fs.readFile(txtPath, 'utf8');
    const segments = [];
    for (const line of text.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/);
      if (fields.length < 7 || (fields.length - 1) % 2) continue;
      const coords = fields.slice(1).map(Number);
      if (coords.some((value) => !Number.isFinite(value))) continue;
      segments.push({
        label: String(Number(fields[0])),
        points: Array.from({ length: coords.length / 2 }, (_, i) => [
          Math.min(1, Math.max(0, coords[i * 2])),
          Math.min(1, Math.max(0, coords[i * 2 + 1])),
        ]),
      });
    }
    return segments;
  } catch {
    return [];
  }
}

function dctPhash(buffer) {
  const pixels = sharp(buffer).greyscale().resize(32, 32, { fit: 'fill' }).raw();
  return pixels.toBuffer().then((data) => {
    const n = 32;
    const coeff = new Float64Array(n * n);
    const cos = Array.from({ length: 8 }, (_, u) => Array.from({ length: n }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n))));
    for (let v = 0; v < 8; v++) for (let u = 0; u < 8; u++) {
      let sum = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) sum += data[y * n + x] * cos[u][x] * cos[v][y];
      coeff[v * 8 + u] = sum;
    }
    const values = Array.from(coeff.slice(1, 64)).sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    let hash = 0n;
    for (const value of coeff) hash = (hash << 1n) | (value > median ? 1n : 0n);
    return hash.toString(16).padStart(16, '0');
  });
}

function hamming(left, right) {
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value) { count += Number(value & 1n); value >>= 1n; }
  return count;
}

async function shaMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = require('node:fs').createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

function stratifiedSplit(records, valRatio) {
  const groups = new Map();
  for (const record of records) {
    const key = record.segments.length ? [...new Set(record.segments.map((shape) => shape.label))].sort().join('|') : '__background__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  let seed = 42;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const train = [];
  const val = [];
  for (const group of groups.values()) {
    for (let i = group.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [group[i], group[j]] = [group[j], group[i]]; }
    let count = Math.round(group.length * valRatio);
    if (valRatio > 0 && group.length > 1) count = Math.max(1, Math.min(group.length - 1, count));
    val.push(...group.slice(0, count));
    train.push(...group.slice(count));
  }
  return { train, val };
}

async function exportSplit(records, root, split, classes) {
  const items = [];
  const imageDir = path.join(root, 'images', split);
  const labelDir = path.join(root, 'labels', split);
  await fs.mkdir(imageDir, { recursive: true });
  await fs.mkdir(labelDir, { recursive: true });
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const base = `${String(i).padStart(6, '0')}_${path.parse(record.path).name}`;
    const imageName = `${base}${path.extname(record.path).toLowerCase()}`;
    const imageTarget = path.join(imageDir, imageName);
    await fs.copyFile(record.path, imageTarget);
    const lines = record.segments.map((shape) => `${classes[shape.label]} ${shape.points.flat().map((v) => v.toFixed(6)).join(' ')}`);
    if (lines.length) await fs.writeFile(path.join(labelDir, `${base}.txt`), `${lines.join('\n')}\n`, 'utf8');
    const jsonPath = record.path.replace(/\.[^.]+$/, '.json');
    try { await fs.copyFile(jsonPath, path.join(labelDir, `${base}.source.json`)); } catch {}
    items.push({
      source: record.path,
      split,
      exported_image: path.relative(root, imageTarget),
      md5: await shaMd5(record.path),
      segmentation_count: record.segments.length,
      class_names: [...new Set(record.segments.map((shape) => shape.label))].sort(),
      review_tag: record.reviewTag,
    });
  }
  return items;
}

ipcMain.handle('dataset:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dataset:scan', async (_event, root) => {
  const files = await walkImages(root);
  const records = [];
  for (const file of files) {
    try {
      const meta = await sharp(file).metadata();
      if (!meta.width || !meta.height) continue;
      const segments = await parseAnnotation(file, meta.width, meta.height);
      records.push({ id: file, path: file, name: path.basename(file), width: meta.width, height: meta.height, segments, selected: false, reviewTag: '', phash: null });
    } catch {}
  }
  return records;
});

ipcMain.handle('images:deduplicate', async (_event, records, similarity) => {
  const threshold = Math.floor(64 * (1 - similarity));
  const retained = [];
  const buckets = new Map();
  const result = [];
  let removed = 0;
  for (const record of records) {
    const buffer = await fs.readFile(record.path);
    const hash = await dctPhash(buffer);
    const candidates = new Set();
    for (let chunk = 0; chunk < 4; chunk++) {
      const key = `${chunk}:${(BigInt(`0x${hash}`) >> BigInt(chunk * 16) & 0xffffn).toString(16)}`;
      for (const index of buckets.get(key) || []) candidates.add(index);
    }
    const duplicate = [...candidates].some((index) => hamming(hash, retained[index].phash) <= threshold);
    const next = { ...record, phash: hash, selected: duplicate ? false : true };
    if (duplicate) removed++;
    else {
      const index = retained.push(next) - 1;
      for (let chunk = 0; chunk < 4; chunk++) {
        const key = `${chunk}:${(BigInt(`0x${hash}`) >> BigInt(chunk * 16) & 0xffffn).toString(16)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(index);
      }
    }
    result.push(next);
  }
  return { records: result, removed };
});

ipcMain.handle('image:thumbnail', async (_event, file, size, roi) => {
  try {
    const stat = await fs.stat(file);
    const cacheKey = crypto.createHash('sha1').update(`${file}:${stat.size}:${stat.mtimeMs}:${size}:${roi}`).digest('hex');
    const cacheDir = path.join(app.getPath('userData'), 'thumbnail-cache');
    const cacheFile = path.join(cacheDir, `${cacheKey}.jpg`);
    try {
      const cached = await fs.readFile(cacheFile);
      return `data:image/jpeg;base64,${cached.toString('base64')}`;
    } catch {}
    let image = sharp(file, { failOn: 'none' });
    if (roi) {
      const data = JSON.parse(await fs.readFile(file.replace(/\.[^.]+$/, '.json'), 'utf8'));
      const shape = data.shapes?.[0];
      if (shape?.points?.length) {
        const xs = shape.points.map((p) => p[0]);
        const ys = shape.points.map((p) => p[1]);
        const width = data.imageWidth || (await image.metadata()).width;
        const height = data.imageHeight || (await image.metadata()).height;
        const boxWidth = Math.max(...xs) - Math.min(...xs);
        const boxHeight = Math.max(...ys) - Math.min(...ys);
        const cropWidth = Math.min(width, Math.max(1, Math.round(boxWidth * 4)));
        const cropHeight = Math.min(height, Math.max(1, Math.round(boxHeight * 4)));
        const left = Math.max(0, Math.min(width - cropWidth, Math.round((Math.min(...xs) + Math.max(...xs)) / 2 - cropWidth / 2)));
        const top = Math.max(0, Math.min(height - cropHeight, Math.round((Math.min(...ys) + Math.max(...ys)) / 2 - cropHeight / 2)));
        image = image.extract({ left, top, width: cropWidth, height: cropHeight });
      }
    }
    const thumbnail = await image.resize(size, size, { fit: 'inside' }).jpeg({ quality: 78 }).toBuffer();
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, thumbnail).catch(() => {});
    return `data:image/jpeg;base64,${thumbnail.toString('base64')}`;
  } catch { return null; }
});

ipcMain.handle('export:choose', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('export:run', async (_event, options) => {
  const selected = options.records.filter((record) => record.selected);
  if (!selected.length) throw new Error('请先选择至少一张图片。');
  const classNames = [...new Set(selected.flatMap((record) => record.segments.map((shape) => shape.label)))].sort();
  const classes = Object.fromEntries(classNames.map((name, index) => [name, index]));
  const { train, val } = options.splitEnabled ? stratifiedSplit(selected, options.valRatio) : { train: selected, val: [] };
  const root = options.output;
  const items = await exportSplit(train, root, 'train', classes);
  items.push(...await exportSplit(val, root, 'val', classes));
  const classImageCounts = {};
  const classInstanceCounts = {};
  for (const record of selected) for (const name of new Set(record.segments.map((shape) => shape.label))) classImageCounts[name] = (classImageCounts[name] || 0) + 1;
  for (const record of selected) for (const shape of record.segments) classInstanceCounts[shape.label] = (classInstanceCounts[shape.label] || 0) + 1;
  const positives = selected.filter((record) => record.segments.length).length;
  const manifest = {
    format: 'industrial-image-manager/manifest-v1', application_version: APP_VERSION,
    created_at: new Date().toISOString(),
    split: { enabled: options.splitEnabled, train_ratio: options.splitEnabled ? 1 - options.valRatio : 1, val_ratio: options.splitEnabled ? options.valRatio : 0, seed: 42 },
    total: selected.length, positive_count: positives, negative_count: selected.length - positives,
    positive_ratio: positives / selected.length, negative_ratio: (selected.length - positives) / selected.length,
    class_names: classes, class_image_counts: classImageCounts, class_instance_counts: classInstanceCounts, items,
  };
  const yaml = [
    `path: ${JSON.stringify(root.replaceAll('\\\\', '/'))}`,
    'train: images/train',
    'val: images/val',
    'names:',
    ...classNames.map((name, index) => `  ${index}: ${JSON.stringify(name)}`),
    '',
  ].join('\\n');
  await fs.writeFile(path.join(root, 'data.yaml'), yaml, 'utf8');
  const manifestPath = path.join(root, 'export_manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return manifestPath;
});

ipcMain.handle('review-tags:load', async () => {
  try { return JSON.parse(await fs.readFile(path.join(app.getPath('userData'), 'review-tags.json'), 'utf8')); }
  catch { return {}; }
});
ipcMain.handle('review-tags:save', async (_event, entries) => {
  const file = path.join(app.getPath('userData'), 'review-tags.json');
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(entries, null, 2), 'utf8');
});
ipcMain.handle('path:reveal', async (_event, file) => shell.showItemInFolder(file));

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
