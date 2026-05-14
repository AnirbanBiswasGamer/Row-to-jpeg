import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';

const BRANDS = [
  { id: 'all', name: 'Universal' },
  { id: 'sony', name: 'Sony' },
  { id: 'canon', name: 'Canon' },
  { id: 'nikon', name: 'Nikon' },
];

const isTauri = !!window.__TAURI_INTERNALS__;

function App() {
  const [mode, setMode] = useState('local');
  const [brand, setBrand] = useState('all');
  const [inputDir, setInputDir] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [format, setFormat] = useState('jpg');
  const [quality, setQuality] = useState(90);
  const [status, setStatus] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  
  useEffect(() => {
    const eventSource = new EventSource('/api/status');
    eventSource.onmessage = (event) => setStatus(JSON.parse(event.data));
    return () => eventSource.close();
  }, []);

  const pickFolder = async (type) => {
    try {
      const res = await fetch('/api/pick-folder');
      const data = await res.json();
      if (data.path) {
        if (type === 'input') setInputDir(data.path);
        else setOutputDir(data.path);
      }
    } catch (err) { console.error(err); }
  };

  const handleStartLocal = async () => {
    await fetch('/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputDir, outputDir, brand, format, quality })
    });
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop: (files) => setSelectedFiles(files) 
  });

  const handleUpload = async () => {
    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('images', file));
    formData.append('format', format);
    formData.append('quality', quality);
    await fetch('/api/upload', { method: 'POST', body: formData });
  };

  const handleClear = async () => {
    await fetch('/api/clear', { method: 'POST' });
    setStatus(null);
    setSelectedFiles([]);
  };

  const progressPercent = (status && status.total > 0) ? (status.progress / status.total) * 100 : 0;
  const isComplete = status && !status.active && status.total > 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-gutter">
      <main className="w-full max-w-[860px] glass-card rounded-[2rem] overflow-hidden flex flex-col fade-in">
        
        {/* Header */}
        <header className="flex justify-between items-center w-full px-gutter py-md bg-transparent">
          <div className="flex items-center gap-base">
            <div className="text-headline-md font-bold text-on-surface bg-surface-container-highest rounded-full p-2 flex items-center justify-center w-12 h-12">
              <span className="text-primary">L</span><span className="text-secondary">R</span>
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="bg-surface-container-lowest p-xs rounded-xl flex items-center border border-outline-variant">
            <button 
              onClick={() => setMode('local')}
              className={`${mode === 'local' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-secondary'} font-bold rounded-lg px-4 py-2 transition-all text-label-sm`}
            >
              Local Mode
            </button>
            <button 
              onClick={() => setMode('upload')}
              className={`${mode === 'upload' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-secondary'} font-bold rounded-lg px-4 py-2 transition-all text-label-sm`}
            >
              Upload Mode
            </button>
          </div>
          </header>

        {/* Content */}
        <div className="p-gutter grid grid-cols-1 md:grid-cols-2 gap-xl">
          
          {/* Settings Section */}
          <section className="space-y-lg">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-primary">tune</span>
              <h2 className="text-headline-md text-on-surface font-semibold">Settings</h2>
            </div>

            <div className="space-y-md">
              <div className="space-y-base">
                <label className="text-label-sm text-outline">Output Format</label>
                <div className="relative">
                  <select 
                    className="w-full bg-surface-container-low border border-outline-variant rounded-xl px-md py-sm text-on-surface appearance-none focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
                    value={format}
                    onChange={(e) => setFormat(e.target.value)}
                  >
                    <option value="jpg">JPEG (High Quality)</option>
                    <option value="png">PNG (Lossless)</option>
                  </select>
                  <span className="material-symbols-outlined absolute right-md top-1/2 -translate-y-1/2 pointer-events-none text-outline">expand_more</span>
                </div>
              </div>

              {format === 'jpg' && (
                <div className="space-y-base">
                  <label className="text-label-sm text-outline">JPEG Quality ({quality}%)</label>
                  <div className="py-sm">
                    <input 
                      type="range" 
                      min="1" max="100" 
                      value={quality} 
                      onChange={(e) => setQuality(e.target.value)}
                      className="cursor-pointer"
                    />
                  </div>
                </div>
              )}

              <div className="space-y-base">
                <label className="text-label-sm text-outline">Camera Brand</label>
                <div className="flex flex-wrap gap-sm">
                  {BRANDS.map(b => (
                    <button 
                      key={b.id}
                      onClick={() => setBrand(b.id)}
                      className={`px-md py-sm rounded-lg text-label-sm font-bold transition-all ${
                        brand === b.id 
                        ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary/20 scale-105' 
                        : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-bright'
                      }`}
                    >
                      {b.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Selection Section */}
          <section className="space-y-lg flex flex-col">
            <div className="flex items-center gap-sm">
              <span className="material-symbols-outlined text-secondary">folder_open</span>
              <h2 className="text-headline-md text-on-surface font-semibold">File Selection</h2>
            </div>

            <div className="space-y-md flex-grow">
              {mode === 'local' ? (
                <>
                  <div className="space-y-base">
                    <label className="text-label-sm text-outline">Input Path</label>
                    <div className="flex gap-sm">
                      <div className="flex-grow bg-surface-container-low border border-outline-variant rounded-xl px-md py-sm text-on-surface-variant truncate flex items-center min-h-[44px]">
                        {inputDir || "Select RAW folder..."}
                      </div>
                      <button onClick={() => pickFolder('input')} className="p-sm bg-surface-container-high border border-outline-variant rounded-xl text-secondary hover:bg-secondary-container hover:text-on-secondary-container transition-all">
                        <span className="material-symbols-outlined">folder</span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-base">
                    <label className="text-label-sm text-outline">Output Path</label>
                    <div className="flex gap-sm">
                      <div className="flex-grow bg-surface-container-low border border-outline-variant rounded-xl px-md py-sm text-on-surface-variant truncate flex items-center min-h-[44px]">
                        {outputDir || "Select output folder..."}
                      </div>
                      <button onClick={() => pickFolder('output')} className="p-sm bg-surface-container-high border border-outline-variant rounded-xl text-secondary hover:bg-secondary-container hover:text-on-secondary-container transition-all">
                        <span className="material-symbols-outlined">folder</span>
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div {...getRootProps()} className={`flex-grow border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-md transition-all ${isDragActive ? 'border-secondary bg-secondary/10' : 'border-outline-variant hover:border-secondary'}`}>
                  <input {...getInputProps()} />
                  <span className="material-symbols-outlined text-secondary text-4xl mb-2">cloud_upload</span>
                  <p className="text-body-md text-on-surface-variant text-center">
                    {selectedFiles.length > 0 ? `${selectedFiles.length} files selected` : "Drop RAW files here or click to browse"}
                  </p>
                </div>
              )}
            </div>

            <button 
              onClick={mode === 'local' ? handleStartLocal : handleUpload}
              disabled={status?.active || (mode === 'local' && (!inputDir || !outputDir)) || (mode === 'upload' && selectedFiles.length === 0)}
              className="gradient-button w-full py-md rounded-2xl flex items-center justify-center gap-base text-on-primary font-bold text-xl group mt-md disabled:opacity-50 disabled:scale-100"
            >
              <span className="material-symbols-outlined text-[32px] group-hover:scale-110 transition-transform" style={{ fontVariationSettings: "'FILL' 1" }}>
                {status?.active ? 'sync' : 'play_arrow'}
              </span>
              {status?.active ? 'CONVERTING...' : 'START CONVERSION'}
            </button>
          </section>
        </div>

        {/* Progress Footer */}
        {status && (status.active || status.total > 0) && (
          <footer className="mt-auto px-gutter py-md bg-surface-container-lowest/50 border-t border-outline-variant/30">
            <div className="flex justify-between items-end mb-sm">
              <div className="flex items-center gap-xs">
                <span className="material-symbols-outlined text-secondary text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {status.active ? 'sync' : (isComplete ? 'check_circle' : 'hourglass_empty')}
                </span>
                <span className="text-body-md font-bold text-on-surface truncate max-w-[300px]">
                  {status.active ? `Processing: ${status.currentFile}` : (isComplete ? 'Conversion Complete' : 'Ready to start')}
                </span>
              </div>
              <div className="flex items-center gap-md">
                {status.zipPath && (
                  <a href={`/api/download/${status.zipPath}`} className="text-secondary hover:underline flex items-center gap-1 font-bold">
                    <span className="material-symbols-outlined">download</span> Download
                  </a>
                )}
                {!status.active && (
                  <button onClick={handleClear} className="text-error hover:text-error-container transition-colors">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                )}
                <span className="text-label-sm font-bold text-secondary">{Math.round(progressPercent)}%</span>
              </div>
            </div>
            <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
              <div 
                className="h-full progress-gradient rounded-full transition-all duration-500" 
                style={{ width: `${progressPercent}%` }}
              ></div>
            </div>
          </footer>
        )}

        <p className="text-label-sm text-center py-4 opacity-50">
          Made by <a href="https://www.aniplay.eu.org" target="_blank" rel="noopener noreferrer" className="text-secondary font-bold hover:underline">Anirban B.</a>
        </p>
      </main>
    </div>
  );
}
export default App;
