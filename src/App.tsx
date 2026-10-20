import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FixedSizeGrid as Grid, GridChildComponentProps } from 'react-window';
import {
  AlertTriangle, Check, ChevronsUpDown, CopyCheck, Download, FolderOpen,
  Grid2X2, Image as ImageIcon, Layers3, ListFilter, MoreHorizontal, Search, Sparkles, Tags, X,
} from 'lucide-react';
import type { ImageRecord } from './types';

type Filters = { query: string; sample: string; count: string; className: string; tag: string; hasClass: string; lacksClass: string; area: string };
const initialFilters: Filters = { query: '', sample: 'all', count: 'any', className: 'all', tag: 'all', hasClass: '', lacksClass: '', area: 'all' };

function App() {
  const [records, setRecords] = useState<ImageRecord[]>([]);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [columns, setColumns] = useState(6);
  const [roi, setRoi] = useState(false);
  const [filters, setFilters] = useState(initialFilters);
  const [similarity, setSimilarity] = useState(95);
  const [valRatio, setValRatio] = useState(15);
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [positivePct, setPositivePct] = useState(80);
  const [negativePct, setNegativePct] = useState(20);
  const [classTargets, setClassTargets] = useState<Record<string, number>>({});
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const tagsLoaded = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(1200);
  useEffect(() => {
    if (!scrollRef.current) return;
    const observer = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width));
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    window.datasetApi.loadReviewTags().then((tags) => {
      tagsLoaded.current = true;
      if (Object.keys(tags).length) setRecords((current) => current.map((record) => ({ ...record, reviewTag: tags[record.path] ?? record.reviewTag })));
    }).catch(() => { tagsLoaded.current = true; });
  }, []);
  useEffect(() => {
    if (!tagsLoaded.current || !records.length) return;
    const tags = Object.fromEntries(records.filter((record) => record.reviewTag).map((record) => [record.path, record.reviewTag]));
    window.datasetApi.saveReviewTags(tags);
  }, [records]);

  const classes = useMemo(() => [...new Set(records.flatMap((record) => record.segments.map((segment) => segment.label)))].sort(), [records]);
  const selected = useMemo(() => records.filter((record) => record.selected), [records]);
  const stats = useMemo(() => {
    const positives = selected.filter((record) => record.segments.length).length;
    const instances: Record<string, number> = {};
    for (const record of selected) for (const segment of record.segments) instances[segment.label] = (instances[segment.label] || 0) + 1;
    return { total: selected.length, positives, negatives: selected.length - positives, ratio: selected.length ? positives / selected.length : 0, instances };
  }, [selected]);

  const visible = useMemo(() => records.filter((record) => {
    if (filters.query && !record.name.toLowerCase().includes(filters.query.toLowerCase())) return false;
    if (filters.sample === 'positive' && !record.segments.length) return false;
    if (filters.sample === 'negative' && record.segments.length) return false;
    if (filters.count === 'zero' && record.segments.length !== 0) return false;
    if (filters.count === 'one' && record.segments.length !== 1) return false;
    if (filters.count === 'three' && record.segments.length < 3) return false;
    if (filters.className !== 'all' && !record.segments.some((segment) => segment.label === filters.className)) return false;
    if (filters.tag === 'untagged' && record.reviewTag) return false;
    if (!['all', 'untagged'].includes(filters.tag) && record.reviewTag !== filters.tag) return false;
    const names = new Set(record.segments.map((segment) => segment.label));
    if (filters.hasClass && !names.has(filters.hasClass)) return false;
    if (filters.lacksClass && names.has(filters.lacksClass)) return false;
    if (filters.area !== 'all') {
      const hasArea = record.segments.some((segment) => {
        const xs = segment.points.map((point) => point[0] * record.width);
        const ys = segment.points.map((point) => point[1] * record.height);
        const area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        return filters.area === 'small' ? area < 32 * 32 : filters.area === 'medium' ? area >= 32 * 32 && area <= 96 * 96 : area > 96 * 96;
      });
      if (!hasArea) return false;
    }
    return true;
  }), [records, filters]);

  const patchRecord = useCallback((id: string, patch: Partial<ImageRecord>) => {
    setRecords((current) => current.map((record) => record.id === id ? { ...record, ...patch } : record));
  }, []);

  const columnCount = Math.max(1, Math.min(columns, Math.floor(gridWidth / 220)));

  const scanFolder = async (selectedFolder?: string) => {
    const target = selectedFolder || await window.datasetApi.chooseDataset();
    if (!target) return;
    setFolder(target);
    setBusy(true);
    setError('');
    setNotice('');
    setProgress('扫描图片与分割标注…');
    try {
      const scanned = await window.datasetApi.scanDataset(target);
      setRecords(scanned);
      setClassTargets(Object.fromEntries([...new Set(scanned.flatMap((record) => record.segments.map((segment) => segment.label)))].map((name) => [name, 0])));
      setFilters(initialFilters);
      setProgress(`${scanned.length.toLocaleString()} 张图片已索引`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setProgress('');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      const cards = [...document.querySelectorAll<HTMLElement>('[data-image-card="true"]')];
      const active = document.activeElement as HTMLElement;
      const index = cards.indexOf(active);
      if (event.key === ' ' && index >= 0) { event.preventDefault(); active.click(); }
      if (index >= 0 && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -columnCount : columnCount;
        event.preventDefault();
        cards[Math.max(0, Math.min(cards.length - 1, index + delta))]?.focus();
      }
      if (event.key === '1' || event.key === '2' || event.key === '3') {
        if (index >= 0) {
          const tags = { '1': '反光', '2': '疑似脏污', '3': '待作废' };
          patchRecord(active.dataset.id || '', { reviewTag: tags[event.key] });
        }
      }
      if (event.key === 'PageDown') scrollRef.current?.scrollBy({ top: scrollRef.current.clientHeight * 0.85, behavior: 'smooth' });
      if (event.key === 'PageUp') scrollRef.current?.scrollBy({ top: -scrollRef.current.clientHeight * 0.85, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [patchRecord, columnCount]);

  const toggleVisible = (value: boolean) => {
    const ids = new Set(visible.map((record) => record.id));
    setRecords((current) => current.map((record) => ids.has(record.id) ? { ...record, selected: value } : record));
  };

  const setAllSelected = (value: boolean) => setRecords((current) => current.map((record) => ({ ...record, selected: value })));

  const deduplicate = async () => {
    if (!records.length) return;
    setBusy(true);
    setProgress('计算感知哈希并查找相似图片…');
    try {
      const result = await window.datasetApi.deduplicate(records, similarity / 100);
      setRecords(result.records);
      setNotice(`已保留 ${result.records.length - result.removed} 张代表图，取消选择 ${result.removed} 张相似图。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setProgress(''); }
  };

  const recommend = () => {
    const denominator = positivePct + negativePct;
    if (!denominator) { setError('正负样本比例之和必须大于 0。'); return; }
    const targetCount = Math.min(records.length, Math.round(records.length * Math.min(100, denominator) / 100));
    const positiveTarget = Math.min(records.filter((record) => record.segments.length).length, Math.round(targetCount * positivePct / denominator));
    const positivePool = records.filter((record) => record.segments.length);
    const negatives = records.filter((record) => !record.segments.length).slice(0, Math.max(0, targetCount - positiveTarget));
    const classTargetCount = Object.fromEntries(classes.map((name) => [name, positiveTarget * (classTargets[name] || 0) / 100]));
    const classCounts: Record<string, number> = {};
    const chosen: ImageRecord[] = [];
    while (positivePool.length && chosen.length < positiveTarget) {
      positivePool.sort((left, right) => score(right) - score(left));
      const best = positivePool.shift()!;
      chosen.push(best);
      for (const name of new Set(best.segments.map((segment) => segment.label))) classCounts[name] = (classCounts[name] || 0) + 1;
    }
    function score(record: ImageRecord) {
      return [...new Set(record.segments.map((segment) => segment.label))].reduce((sum, name) => sum + Math.max(0, (classTargetCount[name] || 0) - (classCounts[name] || 0)), 0);
    }
    const ids = new Set([...chosen, ...negatives].map((record) => record.id));
    setRecords((current) => current.map((record) => ({ ...record, selected: ids.has(record.id) })));
    setBalanceOpen(false);
    setNotice(`配比建议完成，已选择 ${ids.size} 张。`);
  };

  const exportData = async () => {
    if (!selected.length) { setError('请先勾选要导出的图片。'); return; }
    const output = await window.datasetApi.chooseExport();
    if (!output) return;
    setBusy(true);
    setProgress('正在复制图片、转换分割标签并计算 MD5…');
    try {
      const manifest = await window.datasetApi.exportDataset({ records: selected, output, valRatio: valRatio / 100, splitEnabled: true });
      setNotice(`导出完成：${manifest}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); setProgress(''); }
  };

  const cellWidth = Math.floor(gridWidth / columnCount);
  const rowCount = Math.ceil(visible.length / columnCount);
  const gridHeight = Math.max(400, window.innerHeight - 288);
  const cellData = useMemo(() => ({ visible, roi, patchRecord }), [visible, roi, patchRecord]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><div className="brand-mark"><Layers3 size={18} /></div><div><div className="brand-title">Industrial Image Manager</div><div className="brand-subtitle">数据集审查与配比</div></div></div>
        <div className="top-actions">
          <span className="dataset-path" title={folder}>{folder || '尚未打开数据集'}</span>
          <button className="button button-quiet" onClick={() => scanFolder()} disabled={busy}><FolderOpen size={16} />打开数据集</button>
          <button className="button button-primary" onClick={exportData} disabled={busy || !selected.length}><Download size={16} />导出 <span className="button-count">{selected.length}</span></button>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar">
          <div className="side-section"><div className="section-label">数据集</div><button className="nav-item active"><Grid2X2 size={16} />图像审查<span className="nav-count">{records.length.toLocaleString()}</span></button></div>
          <div className="side-section"><div className="section-label">样本类型</div>
            <FilterButton active={filters.sample === 'all'} onClick={() => setFilters({ ...filters, sample: 'all' })} label="全部图像" count={records.length} />
            <FilterButton active={filters.sample === 'positive'} onClick={() => setFilters({ ...filters, sample: 'positive' })} label="有标注" count={records.filter((r) => r.segments.length).length} />
            <FilterButton active={filters.sample === 'negative'} onClick={() => setFilters({ ...filters, sample: 'negative' })} label="空样本" count={records.filter((r) => !r.segments.length).length} />
          </div>
          <div className="side-section"><div className="section-label">类别 <span>{classes.length}</span></div>
            <button className={`class-row ${filters.className === 'all' ? 'class-active' : ''}`} onClick={() => setFilters({ ...filters, className: 'all' })}><span className="class-dot all-dot" />全部类别<span className="class-count">{records.reduce((sum, r) => sum + r.segments.length, 0)}</span></button>
            {classes.map((name, index) => <button className={`class-row ${filters.className === name ? 'class-active' : ''}`} key={name} onClick={() => setFilters({ ...filters, className: name })}><span className={`class-dot class-dot-${index % 6}`} /><span className="class-name">{name}</span><span className="class-count">{records.reduce((sum, r) => sum + r.segments.filter((s) => s.label === name).length, 0)}</span></button>)}
          </div>
          <div className="side-section"><div className="section-label">管理标签</div>{['反光', '疑似脏污', '待作废'].map((tag) => <FilterButton key={tag} active={filters.tag === tag} onClick={() => setFilters({ ...filters, tag: filters.tag === tag ? 'all' : tag })} label={tag} count={records.filter((r) => r.reviewTag === tag).length} />)}</div>
          <div className="sidebar-bottom"><div className="storage-title"><span className="online-dot" />索引状态</div><div className="storage-meta">{busy ? progress || '处理中…' : `${records.length.toLocaleString()} 张图像已载入`}</div><div className="storage-bar"><span style={{ width: records.length ? '100%' : '0%' }} /></div></div>
        </aside>

        <section className="content-area">
          <div className="content-heading"><div><div className="eyebrow">CURATION WORKSPACE</div><h1>图像审查</h1><p>{records.length ? `${visible.length.toLocaleString()} 张图像 · ${selected.length.toLocaleString()} 张已选` : '选择数据集目录以开始浏览标注图像'}</p></div><div className="heading-tools"><button className={`icon-button ${roi ? 'is-on' : ''}`} title="ROI 缺陷特写" onClick={() => setRoi(!roi)}><ScanIcon /> <span>ROI</span></button><div className="segmented-control"><button className={columns === 4 ? 'selected' : ''} onClick={() => setColumns(4)}>4 × 4</button><button className={columns === 6 ? 'selected' : ''} onClick={() => setColumns(6)}>6 × 6</button></div><button className="icon-button" title="全选当前筛选结果" onClick={() => toggleVisible(true)}><CopyCheck size={16} /></button><button className="icon-button" title="取消全部选择" onClick={() => setAllSelected(false)}><X size={16} /></button></div></div>

          <div className="stats-strip"><div className="stat-block"><span className="stat-label">已选样本</span><strong>{stats.total.toLocaleString()}</strong></div><div className="stat-divider" /><div className="stat-block"><span className="stat-label">正样本</span><strong>{stats.positives.toLocaleString()} <small>{stats.total ? `${(stats.ratio * 100).toFixed(1)}%` : '0%'}</small></strong></div><div className="stat-block"><span className="stat-label">空样本</span><strong>{stats.negatives.toLocaleString()} <small>{stats.total ? `${((1 - stats.ratio) * 100).toFixed(1)}%` : '0%'}</small></strong></div><div className="ratio-track"><span style={{ width: `${stats.ratio * 100}%` }} /></div><button className="button button-outline" onClick={() => setBalanceOpen(true)} disabled={!records.length}><Sparkles size={15} />配比建议</button><div className="stat-divider" /><button className="button button-outline" onClick={deduplicate} disabled={!records.length || busy}><ChevronsUpDown size={15} />相似去重</button></div>

          <div className="filter-toolbar"><div className="search-field"><Search size={16} /><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="搜索文件名" /><kbd>⌘ K</kbd></div><select value={filters.count} onChange={(event) => setFilters({ ...filters, count: event.target.value })}><option value="any">任意目标数</option><option value="zero">0 个目标</option><option value="one">1 个目标</option><option value="three">至少 3 个目标</option></select><select value={filters.area} onChange={(event) => setFilters({ ...filters, area: event.target.value })}><option value="all">任意目标面积</option><option value="small">小目标 (&lt;32²)</option><option value="medium">中目标 (32²–96²)</option><option value="large">大目标 (&gt;96²)</option></select><select value={filters.hasClass} onChange={(event) => setFilters({ ...filters, hasClass: event.target.value })}><option value="">包含类别…</option>{classes.map((name) => <option key={name}>{name}</option>)}</select><select value={filters.lacksClass} onChange={(event) => setFilters({ ...filters, lacksClass: event.target.value })}><option value="">不包含类别…</option>{classes.map((name) => <option key={name}>{name}</option>)}</select><select value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })}><option value="all">全部管理标签</option><option value="untagged">未标记</option>{['反光', '疑似脏污', '待作废'].map((tag) => <option key={tag}>{tag}</option>)}</select><button className="icon-button filter-reset" title="重置筛选" onClick={() => setFilters(initialFilters)}><ListFilter size={16} /></button></div>

          <div className="grid-frame" ref={scrollRef}>
            {records.length === 0 && !busy ? <div className="empty-state"><div className="empty-icon"><ImageIcon size={24} /></div><strong>打开一个图像数据集</strong><span>递归读取图片与同名 JSON 分割标注</span><button className="button button-primary" onClick={() => scanFolder()}><FolderOpen size={16} />选择文件夹</button></div> : visible.length === 0 ? <div className="no-results"><ListFilter size={22} /><span>没有符合当前筛选条件的图像</span><button onClick={() => setFilters(initialFilters)}>清除筛选</button></div> : <Grid columnCount={columnCount} columnWidth={cellWidth} height={gridHeight} rowCount={rowCount} rowHeight={228} width={gridWidth} itemData={{ ...cellData, columnCount }} overscanRowCount={2}>
              {ImageCell}
            </Grid>}
          </div>
          <footer className="grid-footer"><span>{progress || `显示 ${visible.length.toLocaleString()} / ${records.length.toLocaleString()} 张`}</span><span>方向键移动 · Space 选择 · 1/2/3 管理标签 · PgUp/PgDn 翻页</span></footer>
        </section>
      </section>

      {error && <div className="toast toast-error"><AlertTriangle size={16} /><span>{error}</span><button onClick={() => setError('')}><X size={15} /></button></div>}
      {notice && <div className="toast toast-success"><Check size={16} /><span>{notice}</span><button onClick={() => setNotice('')}><X size={15} /></button></div>}
      {balanceOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setBalanceOpen(false); }}><section className="balance-modal"><header><div><div className="eyebrow">AUTO BALANCING</div><h2>配比建议</h2></div><button className="icon-button" onClick={() => setBalanceOpen(false)}><X size={17} /></button></header><p className="modal-description">按目标比例从当前数据池建议勾选样本，生成后仍可逐张调整。</p><div className="ratio-inputs"><label>正样本 <NumberInput value={positivePct} onChange={setPositivePct} /></label><label>空样本 <NumberInput value={negativePct} onChange={setNegativePct} /></label></div><div className="modal-section-title">类别目标占正样本比例</div><div className="class-target-list">{classes.map((name) => <label key={name}><span>{name}</span><NumberInput value={classTargets[name] || 0} onChange={(value) => setClassTargets({ ...classTargets, [name]: value })} /></label>)}</div><footer><button className="button button-quiet" onClick={() => setBalanceOpen(false)}>取消</button><button className="button button-primary" onClick={recommend}><Sparkles size={15} />建议选中</button></footer></section></div>}

      <div className="export-dock"><div className="dock-selection"><span className="selection-check"><Check size={13} /></span><div><strong>{selected.length.toLocaleString()} 张已选择</strong><span>正样本 {stats.positives} · 空样本 {stats.negatives}</span></div></div><div className="dock-split"><label><input type="checkbox" checked={valRatio > 0} onChange={(event) => setValRatio(event.target.checked ? 15 : 0)} />分层验证集</label><input aria-label="验证集比例" type="range" min="5" max="40" step="5" value={valRatio || 15} onChange={(event) => setValRatio(Number(event.target.value))} disabled={!valRatio} /><span>{valRatio || 0}%</span></div><div className="dock-class-summary">{Object.entries(stats.instances).slice(0, 3).map(([name, count]) => <span key={name}>{name}<b>{count}</b></span>)}</div><button className="button button-primary dock-export" onClick={exportData} disabled={!selected.length || busy}><Download size={16} />导出 YOLO 数据</button></div>
    </main>
  );
}

function ImageCell({ columnIndex, rowIndex, style, data }: GridChildComponentProps<{ visible: ImageRecord[]; roi: boolean; columnCount: number; patchRecord: (id: string, patch: Partial<ImageRecord>) => void }>) {
  const record = data.visible[rowIndex * data.columnCount + columnIndex];
  if (!record) return <div style={style} />;
  return <ImageCard record={record} roi={data.roi} patchRecord={data.patchRecord} style={style} />;
}

function ImageCard({ record, roi, patchRecord, style }: { record: ImageRecord; roi: boolean; patchRecord: (id: string, patch: Partial<ImageRecord>) => void; style: React.CSSProperties }) {
  const [thumbnail, setThumbnail] = useState('');
  useEffect(() => { let active = true; window.datasetApi.thumbnail(record.path, 260, roi).then((image) => { if (active) setThumbnail(image || ''); }); return () => { active = false; }; }, [record.path, roi]);
  const tags = ['反光', '疑似脏污', '待作废'];
  const [menu, setMenu] = useState(false);
  const classNames = [...new Set(record.segments.map((segment) => segment.label))];
  return <article data-image-card="true" data-id={record.id} tabIndex={0} className={`image-card ${record.selected ? 'selected' : ''}`} style={{ ...style, padding: 6 }} onClick={() => patchRecord(record.id, { selected: !record.selected })} onContextMenu={(event) => { event.preventDefault(); setMenu(!menu); }}>
    <div className="image-surface">{thumbnail ? <img src={thumbnail} loading="lazy" /> : <div className="thumb-placeholder"><ImageIcon size={20} /></div>}<span className={`bbox-badge ${record.segments.length ? 'bbox-positive' : ''}`}>{record.segments.length} 个目标</span><span className={`check-indicator ${record.selected ? 'checked' : ''}`}>{record.selected && <Check size={13} />}</span>{record.reviewTag && <span className="review-badge">{record.reviewTag}</span>}</div>
    <div className="card-caption"><span className="card-name" title={record.name}>{record.name}</span><span className="card-resolution">{record.width} × {record.height}</span></div><div className="card-meta"><div className="card-classes">{classNames.slice(0, 2).map((name, index) => <span className={`class-chip chip-${index}`} key={name}>{name}</span>)}{classNames.length > 2 && <span className="more-classes">+{classNames.length - 2}</span>}</div><button className="card-menu-button" title="管理标签" onClick={(event) => { event.stopPropagation(); setMenu(!menu); }}><MoreHorizontal size={16} /></button></div>
    {menu && <div className="tag-menu" onClick={(event) => event.stopPropagation()}>{tags.map((tag) => <button key={tag} onClick={() => { patchRecord(record.id, { reviewTag: tag }); setMenu(false); }}><Tags size={13} />{tag}{record.reviewTag === tag && <Check size={13} />}</button>)}<button onClick={() => { patchRecord(record.id, { reviewTag: '' }); setMenu(false); }}><X size={13} />清除标签</button></div>}
  </article>;
}

function FilterButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return <button className={`filter-button ${active ? 'filter-active' : ''}`} onClick={onClick}><span>{label}</span><span className="filter-count">{count.toLocaleString()}</span></button>;
}

function NumberInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <span className="number-input"><input type="number" min="0" max="100" value={value} onChange={(event) => onChange(Math.max(0, Math.min(100, Number(event.target.value))))} /><span>%</span></span>;
}

function ScanIcon() { return <span className="scan-icon">⌗</span>; }

export default App;
