import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Camera, FolderOpen, Play, CheckCircle, AlertCircle, Loader2, Info, Upload, Download, ChevronRight, Home, ChevronLeft, Sliders, Droplets } from 'lucide-react';
import { useDropzone } from 'react-dropzone';

const BRANDS = [
  { id: 'all', name: 'Universal', color: '#7000ff' },
  { id: 'sony', name: 'Sony', color: '#0033cc' },
  { id: 'canon', name: 'Canon', color: '#cc0000' },
  { id: 'nikon', name: 'Nikon', color: '#ffcc00' },
];

function App() {
  const [mode, setMode] = useState('local');
  const [brand, setBrand] = useState('all');
  const [inputDir, setInputDir] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [format, setFormat] = useState('jpg');
  const [quality, setQuality] = useState(90);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(null);
  const [browseData, setBrowseData] = useState({ items: [], currentPath: '' });
  const [selectedFiles, setSelectedFiles] = useState([]);
  
  const logEndRef = useRef(null);

  useEffect(() => {
    const eventSource = new EventSource('/api/status');
    eventSource.onmessage = (event) => setStatus(JSON.parse(event.data));
    return () => eventSource.close();
  }, []);

  const fetchDir = async (path = '') => {
    try {
      const res = await fetch(`/api/browse?path=${encodeURIComponent(path)}`);
      const data = await res.json();
      setBrowseData(data);
    } catch (err) { console.error(err); }
  };

  const handleStartLocal = async () => {
    setError('');
    const res = await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputDir, outputDir, brand, format, quality })
    });
    if (!res.ok) setError((await res.json()).error);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop: (files) => setSelectedFiles(files) 
  });

  const handleUpload = async () => {
    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('images', file));
    formData.append('format', format);
    formData.append('quality', quality);
    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    if (!res.ok) setError((await res.json()).error);
  };

  const progressPercent = status ? (status.progress / status.total) * 100 : 0;

  return (
    <div className="app-container fade-in">
      <div className="liquid-bg"></div>
      <div className="floating-orb" style={{ top: '10%', left: '10%', width: '300px', height: '300px', background: 'var(--accent-cyan)' }}></div>
      <div className="floating-orb" style={{ bottom: '10%', right: '10%', width: '400px', height: '400px', background: 'var(--accent-magenta)' }}></div>

      <header className="title-container">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 1, type: 'spring' }}>
          <h1 className="main-title">LUMINA <span style={{ color: 'var(--accent-cyan)' }}>RAW</span></h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '0.5rem' }}>Next-Gen Liquid Glass Conversion</p>
        </motion.div>
        
        <div className="mode-pill">
          <button className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}>Local Station</button>
          <button className={mode === 'upload' ? 'active' : ''} onClick={() => setMode('upload')}>Cloud Portal</button>
        </div>
      </header>

      <motion.div className="liquid-glass refract-border" style={{ padding: '3rem' }} layout>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem' }}>
          
          <div className="settings-panel">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
              <Sliders size={20} /> Parameters
            </h3>
            
            <div className="input-group">
              <label>Output Alchemy</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <select className="glass-input" value={format} onChange={e => setFormat(e.target.value)}>
                  <option value="jpg">Superior JPEG</option>
                  <option value="png">Eternal PNG</option>
                </select>
              </div>
            </div>

            {format === 'jpg' && (
              <div className="input-group">
                <label>Purity Index ({quality}%)</label>
                <input type="range" className="liquid-range" min="1" max="100" value={quality} onChange={e => setQuality(e.target.value)} />
              </div>
            )}

            <div className="input-group">
              <label>Refraction Profile</label>
              <div className="brand-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {BRANDS.map(b => (
                  <button key={b.id} className={`brand-btn ${brand === b.id ? 'active' : ''}`} onClick={() => setBrand(b.id)}
                    style={brand === b.id ? { backgroundColor: b.color, borderColor: b.color } : {}}>
                    {b.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="action-panel">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
              <Droplets size={20} /> Essence Source
            </h3>

            {mode === 'local' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="input-group">
                  <label>Input Path</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input className="glass-input" value={inputDir} onChange={e => setInputDir(e.target.value)} placeholder="C:\...\RAW" />
                    <button className="icon-btn" onClick={() => { setShowPicker('input'); fetchDir(inputDir); }}><FolderOpen /></button>
                  </div>
                </div>
                <div className="input-group">
                  <label>Output Path</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input className="glass-input" value={outputDir} onChange={e => setOutputDir(e.target.value)} placeholder="C:\...\JPEG" />
                    <button className="icon-btn" onClick={() => { setShowPicker('output'); fetchDir(outputDir); }}><FolderOpen /></button>
                  </div>
                </div>
                <button className="btn-liquid" onClick={handleStartLocal} disabled={status?.active || !inputDir || !outputDir}>
                  {status?.active ? <Loader2 className="animate-spin" /> : <Play fill="currentColor" />}
                  Ignite Conversion
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div {...getRootProps()} className={`dropzone liquid-glass ${isDragActive ? 'active' : ''}`} 
                  style={{ flex: 1, borderStyle: 'dashed', borderRadius: '24px', padding: '2rem' }}>
                  <input {...getInputProps()} />
                  <Upload size={32} style={{ color: 'var(--accent-cyan)', marginBottom: '1rem' }} />
                  <p style={{ fontSize: '0.9rem' }}>{selectedFiles.length > 0 ? `${selectedFiles.length} files prepared` : "Infuse RAW files here"}</p>
                </div>
                <button className="btn-liquid" style={{ marginTop: '1.5rem' }} onClick={handleUpload} disabled={status?.active || selectedFiles.length === 0}>
                  {status?.active ? <Loader2 className="animate-spin" /> : <Upload />}
                  Vaporize to Cloud
                </button>
              </div>
            )}
          </div>
        </div>

        {status && (status.active || status.logs.length > 0) && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="progress-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <span style={{ fontWeight: 800 }}>{status.currentFile}</span>
              <span style={{ color: 'var(--accent-cyan)' }}>{Math.round(progressPercent)}%</span>
            </div>
            <div className="liquid-progress-bg"><div className="liquid-progress-fill" style={{ width: `${progressPercent}%` }}></div></div>
            
            {status.zipPath && (
              <a href={`/api/download/${status.zipPath}`} className="download-btn" style={{ background: 'linear-gradient(90deg, #00f2ff, #7000ff)' }}>
                <Download size={18} /> Retrieve Essence (.zip)
              </a>
            )}
          </motion.div>
        )}
      </motion.div>

      {/* Modal Picker */}
      <AnimatePresence>
        {showPicker && (
          <motion.div className="modal-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="modal-content liquid-glass refract-border" style={{ padding: '2.5rem' }} initial={{ y: 100, scale: 0.9 }} animate={{ y: 0, scale: 1 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2rem' }}>
                <h3 style={{ margin: 0 }}>Liquid Navigator</h3>
                <button onClick={() => setShowPicker(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer' }}>✕</button>
              </div>
              <div className="breadcrumb">
                <button onClick={() => fetchDir('C:\\')}><Home size={14} /></button>
                {browseData.parent && <button onClick={() => fetchDir(browseData.parent)}><ChevronLeft size={14} /> Back</button>}
                <span style={{ marginLeft: 'auto', opacity: 0.5 }}>{browseData.currentPath}</span>
              </div>
              <div className="browser-list" style={{ height: '300px' }}>
                {browseData.items.map(item => (
                  <div key={item.path} className={`browser-item ${item.isDir ? 'dir' : 'file'}`} onClick={() => item.isDir && fetchDir(item.path)}>
                    {item.isDir ? <FolderOpen size={16} color="var(--accent-violet)" /> : <Camera size={16} color="var(--text-muted)" />}
                    <span>{item.name}</span>
                    {item.isDir && <ChevronRight size={14} className="ml-auto" />}
                  </div>
                ))}
              </div>
              <button className="btn-liquid" style={{ padding: '1rem' }} onClick={() => {
                if (showPicker === 'input') setInputDir(browseData.currentPath);
                else setOutputDir(browseData.currentPath);
                setShowPicker(null);
              }}>Condense Selection</button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .liquid-range {
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
          outline: none;
        }
        .liquid-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--accent-cyan);
          cursor: pointer;
          box-shadow: 0 0 10px var(--accent-cyan);
        }
      `}</style>
    </div>
  );
}

export default App;
