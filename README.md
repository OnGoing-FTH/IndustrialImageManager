# 工业图像管理工具

面向工业分割数据集的浏览、筛选、选配、去重与 YOLO segmentation 导出工具。

## 输入格式

递归扫描常见图片格式（JPG/JPEG/PNG/BMP/TIF/TIFF/WEBP）。每张图片可以对应同目录同名 JSON 或 TXT，JSON 优先：

```text
dataset/
├── POCO19-Top-DJ/
│   ├── sample_001.png
│   ├── sample_001.json
│   ├── sample_002.png
│   └── sample_002.json
└── POCO19-Top-CT/
    ├── sample_003.png
    └── sample_003.json
```

JSON 支持 LabelMe/X-AnyLabeling 多边形结构：`imageWidth`、`imageHeight`、`shapes[].label`、`shapes[].points`。JSON 缺失时，兼容 YOLO segmentation TXT，每行 `class_id x1 y1 x2 y2 ...`，点坐标为 0~1 归一化值。缺少标签的图片视为空样本。

## 功能

- 异步递归扫描图片及 JSON 多边形 / YOLO segmentation 标注。
- 4×4 / 6×6 Qt Model/View 网格、ROI 特写、正负样本和目标数过滤。
- 按类别、目标数和管理标签过滤。
- 管理标签支持快捷键 `1/2/3`、右键菜单设置或清除。
- pHash 相似图去重，可设置相似度阈值；自动勾选代表图，取消重复图。
- 配比建议：正负样本目标比例及类别分布建议选择。
- 分层 Train/Val 导出；按类别组合与空样本分层，默认随机种子 42。
- 导出 YOLO segmentation 标签，并保留原始 JSON 为 `.source.json`。
- `export_manifest.json` 记录程序版本、时间、比例、类别映射、图像清单和每张图 MD5。

## 桌面技术栈

桌面版使用 Electron + React + TypeScript。扫描、图像缩放、pHash、文件哈希和导出运行在 Electron 主进程；浏览器视图使用 `react-window` 虚拟网格，滚动时只挂载可见图片项。Python/PyQt 源文件保留在仓库历史开发目录，不再是桌面应用入口。

## 安装与运行

需要 Node.js 20 或更新版本：

```powershell
npm install
npm run dev
```

开发环境页面地址为 `http://127.0.0.1:5173/`，Electron 会自动打开该页面。

## 打包

```powershell
npm run dist:win
```

Windows 文件夹版输出在 `release/win-unpacked/`，交付时整体复制该文件夹。

## 输入与导出

递归读取常见图片格式；优先读取同目录同名 LabelMe/X-AnyLabeling JSON 多边形，缺 JSON 时读取 YOLO segmentation TXT。导出生成 `images/train|val`、`labels/train|val`、`data.yaml` 和 `export_manifest.json`；JSON 源标注以 `.source.json` 额外保留。
