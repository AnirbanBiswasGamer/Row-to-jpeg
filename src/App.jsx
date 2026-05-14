import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDropzone } from 'react-dropzone';


const isTauri = !!window.__TAURI_INTERNALS__;
const API_BASE = isTauri ? 'http://127.0.0.1:48211' : '';

const getBrandFromExt = (filename) => {
  if (!filename) return null;
  const ext = filename.split('.').pop().toLowerCase();
  const map = {
    nef: 'Nikon', nrw: 'Nikon',
    cr2: 'Canon', cr3: 'Canon', crw: 'Canon',
    arw: 'Sony', srf: 'Sony', sr2: 'Sony',
    orf: 'Olympus',
    raf: 'Fujifilm',
    dng: 'Digital Negative (DNG)',
    rw2: 'Panasonic',
    rwl: 'Leica'
  };
  return map[ext] || 'Unknown Brand';
};

function App() {
  const [mode, setMode] = useState('local');
  const [inputDir, setInputDir] = useState('');
  const [outputDir, setOutputDir] = useState('');
  const [format, setFormat] = useState('jpg');
  const [quality, setQuality] = useState(90);
  const [status, setStatus] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFiles, setUploadedFiles] = useState(null);
  const [showFooter, setShowFooter] = useState(true);

  const changeMode = (newMode) => {
    setMode(newMode);
    handleClear(); // Clear everything when switching modes
  };
  
  useEffect(() => {
    // Disable right-click for native feel
    const handleContextMenu = (e) => e.preventDefault();
    document.addEventListener('contextmenu', handleContextMenu);

    const eventSource = new EventSource(`${API_BASE}/api/status`);
    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      setStatus(data);
      if (data.active || data.total > 0) setShowFooter(true);
    };
    
    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      eventSource.close();
    };
  }, []);

  const openExternal = async (url) => {
    if (window.__TAURI_INTERNALS__) {
      const { open } = await import('@tauri-apps/plugin-shell');
      await open(url);
    } else {
      window.open(url, '_blank');
    }
  };

  const pickFolder = async (type) => {
    const assignPath = (selectedPath) => {
      if (!selectedPath || !selectedPath.trim()) return false;
      if (type === 'input') setInputDir(selectedPath.trim());
      else setOutputDir(selectedPath.trim());
      return true;
    };

    try {
      // 1. Try native Tauri dialog if available
      if (isTauri) {
        try {
          const { open } = await import('@tauri-apps/plugin-dialog');
          const selected = await open({ directory: true, multiple: false });
          if (selected) {
            const path = Array.isArray(selected) ? selected[0] : selected;
            assignPath(path);
            return;
          }
        } catch (tauriErr) {
          console.warn("Tauri dialog plugin failed, falling back to API picker:", tauriErr);
          // Continue to fallback
        }
      }

      // 2. Fallback to our robust API-based PowerShell picker
      const res = await fetch(`${API_BASE}/api/pick-folder`);
      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        console.warn('Failed to parse /api/pick-folder response JSON:', parseErr);
        throw new Error('Invalid response from folder picker API');
      }
      if (res.ok && assignPath(data.path || '')) {
        return;
      }

      const reason = data?.error || data?.warning || (!res.ok ? `Server picker failed (HTTP ${res.status})` : 'No folder path returned from picker');
      alert(`Folder picker unavailable: ${reason}. You can type the full folder path manually.`);
    } catch (err) {
      console.error("Folder pick error:", err);
      alert(`Connection Error: Ensure the background server is running. ${err.message}. You can also type the full folder path manually.`);
    }
  };

  const handleStartLocal = async () => {
    const res = await fetch(`${API_BASE}/api/convert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputDir, outputDir, format, quality })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      alert(error.error || `Failed to start local conversion (HTTP ${res.status}). Please verify input/output folders exist and permissions are allowed.`);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop: (files) => setSelectedFiles(files) 
  });

  const handleUpload = () => {
    if (selectedFiles.length === 0) {
      alert("Please select files first!");
      return;
    }
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    selectedFiles.forEach(file => formData.append('images', file));

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}/api/upload`, true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setUploadProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        if (xhr.status === 200) {
          const data = JSON.parse(xhr.responseText);
          console.log('Upload success:', data);
          setUploadedFiles(data.files);
          setUploading(false);
        } else {
          console.error('Upload failed with status:', xhr.status);
          setUploading(false);
          alert('Upload failed. Please try again.');
        }
      } catch (err) {
        console.error('Error parsing response:', err);
        setUploading(false);
      }
    };

    xhr.onerror = () => {
      console.error('Upload error');
      setUploading(false);
    };

    xhr.send(formData);
  };

  const handleStartCloud = async () => {
    if (!uploadedFiles) return;
    const res = await fetch(`${API_BASE}/api/convert-cloud`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: uploadedFiles, format, quality })
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      alert(error.error || `Failed to start cloud conversion (HTTP ${res.status}). Please verify files were uploaded successfully and try again.`);
      return;
    }
    setUploadedFiles(null); // Reset after starting
  };

  const handleClear = async () => {
    // Immediately clear local state to avoid flicker
    setStatus({ active: false, total: 0, progress: 0, currentFile: '', zipPath: null });
    setUploadedFiles(null);
    setUploadProgress(0);
    await fetch(`${API_BASE}/api/clear`, { method: 'POST' }).catch(() => {});
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
            <div className="bg-surface-container-highest rounded-full flex items-center justify-center w-12 h-12 overflow-hidden border border-outline-variant">
              <img src="/favicon.png" alt="Lumina RAW" className="w-8 h-8 object-contain" />
            </div>
          </div>

          {/* Mode Toggle */}
          <div className="bg-surface-container-lowest p-xs rounded-xl flex items-center border border-outline-variant">
            <button 
              onClick={() => changeMode('local')}
              className={`${mode === 'local' ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:text-secondary'} font-bold rounded-lg px-4 py-2 transition-all text-label-sm`}
            >
              Local Mode
            </button>
            <button 
              onClick={() => changeMode('upload')}
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
                      onChange={(e) => setQuality(parseInt(e.target.value, 10))}
                      className="cursor-pointer"
                    />
                  </div>
                </div>
              )}

              {/* Detected Brand Display */}
              <div className="space-y-base pt-md border-t border-outline-variant/30">
                <label className="text-label-sm text-outline">Detected Camera</label>
                <div className="bg-surface-container-low border border-outline-variant/30 rounded-xl px-md py-sm flex items-center gap-sm shadow-sm">
                  <div className="w-8 h-8 rounded-full bg-secondary/10 flex items-center justify-center">
                    <span className="material-symbols-outlined text-secondary text-[20px]">
                      {selectedFiles.length > 0 ? 'photo_camera' : (inputDir ? 'auto_fix' : 'sensors')}
                    </span>
                  </div>
                  <div>
                    <div className="text-label-sm font-bold text-on-surface">
                      {selectedFiles.length > 0 
                        ? getBrandFromExt(selectedFiles[0].name)
                        : (mode === 'local' && inputDir ? 'Mixed RAW Formats' : 'Auto-Detect Ready')}
                    </div>
                    <div className="text-[10px] text-on-surface-variant uppercase tracking-wider font-medium">
                      Intelligence Engine Active
                    </div>
                  </div>
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
                      <input
                        type="text"
                        value={inputDir}
                        onChange={(e) => setInputDir(e.target.value)}
                        placeholder="Select RAW folder..."
                        className="flex-grow bg-surface-container-low border border-outline-variant rounded-xl px-md py-sm text-on-surface min-h-[44px] focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
                      />
                      <button onClick={() => pickFolder('input')} className="p-sm bg-surface-container-high border border-outline-variant rounded-xl text-secondary hover:bg-secondary-container hover:text-on-secondary-container transition-all">
                        <span className="material-symbols-outlined">folder</span>
                      </button>
                    </div>
                  </div>
                  <div className="space-y-base">
                    <label className="text-label-sm text-outline">Output Path</label>
                    <div className="flex gap-sm">
                      <input
                        type="text"
                        value={outputDir}
                        onChange={(e) => setOutputDir(e.target.value)}
                        placeholder="Select output folder..."
                        className="flex-grow bg-surface-container-low border border-outline-variant rounded-xl px-md py-sm text-on-surface min-h-[44px] focus:border-secondary focus:ring-1 focus:ring-secondary transition-all"
                      />
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
              onClick={() => {
                if (mode === 'local') handleStartLocal();
                else if (uploadedFiles) handleStartCloud();
                else handleUpload();
              }}
              disabled={status?.active || uploading || (mode === 'local' && (!inputDir || !outputDir)) || (mode === 'upload' && selectedFiles.length === 0)}
              className={`${uploadedFiles ? 'bg-secondary' : 'gradient-button'} w-full py-md rounded-2xl flex flex-col items-center justify-center gap-1 text-on-primary font-bold group mt-md disabled:opacity-50 disabled:scale-100 transition-all`}
            >
              <div className="flex items-center gap-base">
                <span className="material-symbols-outlined text-[32px] group-hover:scale-110 transition-transform" style={{ fontVariationSettings: "'FILL' 1" }}>
                  {status?.active || uploading ? 'sync' : (uploadedFiles ? 'play_circle' : (mode === 'upload' ? 'cloud_upload' : 'play_arrow'))}
                </span>
                <span className="text-xl">
                  {status?.active ? 'CONVERTING...' : 
                   uploading ? `UPLOADING ${uploadProgress}%` : 
                   uploadedFiles ? 'START CONVERSION' : 
                   mode === 'upload' ? 'UPLOAD TO SERVER' : 'START CONVERSION'}
                </span>
              </div>
              {uploading && (
                <div className="w-48 h-1 bg-white/20 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-white transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              )}
            </button>
          </section>
        </div>

        {/* Progress Footer */}
        {showFooter && status && (status.active || status.total > 0) && (
          <footer className="mt-auto px-gutter py-md bg-surface-container-lowest/50 border-t border-outline-variant/30 relative">
            <button 
              onClick={() => setShowFooter(false)}
              className="absolute top-2 right-2 text-on-surface-variant hover:text-on-surface transition-colors"
              title="Dismiss"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
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
                {status.error ? (
                  <div className="text-error font-bold flex items-center gap-1 text-label-sm">
                    <span className="material-symbols-outlined text-[20px]">error</span>
                    Error: {status.error}
                  </div>
                ) : status.zipPath ? (
                  <a 
                    href={`${API_BASE}/api/download/${status.zipPath}`} 
                    download={status.zipPath}
                    className="gradient-button px-gutter py-2 rounded-xl text-on-primary font-bold flex items-center gap-2 shadow-lg hover:scale-105 transition-all text-label-sm"
                  >
                    <span className="material-symbols-outlined text-[20px]">download</span> 
                    DOWNLOAD RESULTS
                  </a>
                ) : (
                  isComplete && mode === 'local' && (
                    <div className="text-secondary font-bold flex items-center gap-2 text-label-sm">
                      <span className="material-symbols-outlined text-[20px]">check_circle</span>
                      SAVED TO FOLDER
                    </div>
                  )
                )}
                {!status.active && (
                  <button onClick={handleClear} className="p-2 text-error hover:bg-error/10 rounded-lg transition-colors ml-2" title="Clear Workspace">
                    <span className="material-symbols-outlined">delete</span>
                  </button>
                )}
                <span className="text-label-sm font-bold text-secondary ml-2">{Math.round(progressPercent)}%</span>
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
          Made by <button 
            onClick={() => openExternal('https://www.aniplay.eu.org')} 
            className="text-secondary font-bold hover:underline bg-transparent border-none cursor-pointer"
          >
            Anirban B.
          </button>
        </p>
      </main>
    </div>
  );
}
export default App;
