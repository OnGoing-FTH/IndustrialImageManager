const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('datasetApi', {
  chooseDataset: () => ipcRenderer.invoke('dataset:choose'),
  scanDataset: (folder) => ipcRenderer.invoke('dataset:scan', folder),
  thumbnail: (file, size, roi) => ipcRenderer.invoke('image:thumbnail', file, size, roi),
  deduplicate: (records, similarity) => ipcRenderer.invoke('images:deduplicate', records, similarity),
  loadReviewTags: () => ipcRenderer.invoke('review-tags:load'),
  saveReviewTags: (entries) => ipcRenderer.invoke('review-tags:save', entries),
  chooseExport: () => ipcRenderer.invoke('export:choose'),
  exportDataset: (options) => ipcRenderer.invoke('export:run', options),
  revealPath: (file) => ipcRenderer.invoke('path:reveal', file),
});
