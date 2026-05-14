import express from 'express';
import cors from 'cors';
import { exec, execFile, execSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, createWriteStream, mkdirSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const archiver = require('archiver');
import { extractEmbeddedJpeg } from './extractor.js';
import multer from 'multer';

// Ensure directories exist
if (!existsSync('uploads')) mkdirSync('uploads');
if (!existsSync('outputs')) mkdirSync('outputs');

const execPromise = promisify(exec);
const execFilePromise = promisify(execFile);
const app = express();
const port = 48211;

// ImageMagick Path
const DEFAULT_MAGICK_PATH = process.platform === 'win32'
  ? 'C:\\Program Files\\ImageMagick-7.1.2-Q16\\magick.exe'
  : 'magick';
const MAGICK_PATH = (process.env.MAGICK_PATH || DEFAULT_MAGICK_PATH).replace(/^['"]+|['"]+$/g, '');
const RESERVED_WINDOWS_NAMES = new Set(['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']);

async function convertWithWIC({ inputPath, outputPath, format, quality }) {
  const encoderClass = format === 'png' ? 'PngBitmapEncoder' : 'JpegBitmapEncoder';
  const psCommand = `
    Add-Type -AssemblyName PresentationCore, PresentationFramework;
    $stream = New-Object System.IO.FileStream("${inputPath.replace(/"/g, '`"')}", [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::Read);
    try {
    $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create($stream, [System.Windows.Media.Imaging.BitmapCreateOptions]::DelayCreation, [System.Windows.Media.Imaging.BitmapCacheOption]::None);
    if ($decoder.Frames.Count -gt 0) {
      $frame = $decoder.Frames[0];
      $encoder = New-Object System.Windows.Media.Imaging.${encoderClass};
      if ("${format}" -eq "jpg") { $encoder.QualityLevel = ${quality || 90} }
      $encoder.Frames.Add($frame);
      $outStream = New-Object System.IO.FileStream("${outputPath.replace(/"/g, '`"')}", [System.IO.FileMode]::Create);
      $encoder.Save($outStream);
      $outStream.Close();
    } else {
      throw "No frames found in image";
    }
    } finally {
      $stream.Close();
    }
  `;
  
  await execPromise(`powershell -Command "${psCommand.replace(/\n/g, ' ')}"`);
}

async function convertWithMagick({ inputPath, outputPath, format, quality }) {
  const args = [
    '-quiet',
    '-define', 'dng:read-thumbnail=false',
    `${inputPath}[0]`,
    '-auto-orient',
    '-auto-level',
    '-colorspace', 'sRGB'
  ];
  if (format === 'jpg') args.push('-quality', String(quality || 100));
  args.push(outputPath);
  await execFilePromise(MAGICK_PATH, args);
}

const RAW_EXTENSIONS = [
  '.3fr', '.arw', '.bay', '.bmq', '.cap', '.cine', '.cr2', '.cr3', '.crw', '.cs1',
  '.dc2', '.dcr', '.dng', '.drf', '.dsc', '.erf', '.fff', '.ia', '.iiq', '.k25',
  '.kc2', '.kdc', '.mdc', '.mef', '.mos', '.mrw', '.nef', '.nrw', '.orf', '.pef',
  '.ptx', '.pxn', '.qtk', '.raf', '.raw', '.rdc', '.rw2', '.rwl', '.rwz', '.sr2',
  '.srf', '.srw', '.sti', '.x3f'
];

async function smartConvert(params) {
  const ext = path.extname(params.inputPath).toLowerCase();
  
  // 1. Try "In-App" extraction first (Best for avoiding corruption)
  try {
    console.log(`Extracting embedded JPEG from ${params.inputPath}...`);
    const success = await extractEmbeddedJpeg(params.inputPath, params.outputPath);
    if (success) return;
  } catch (err) {
    console.warn("In-app extraction failed:", err.message);
  }

  // 2. Fallback to WIC (Native Windows)
  if (process.platform === 'win32' && RAW_EXTENSIONS.includes(ext)) {
    try {
      console.log(`Using WIC for ${ext} conversion...`);
      await convertWithWIC(params);
      return;
    } catch (err) {
      console.warn("WIC conversion failed:", err.message);
    }
  }

  // 3. Last resort: ImageMagick
  await convertWithMagick(params);
}

function sanitizeOutputBaseName(input, fallbackValue) {
  const base = path.parse(path.basename(input || '')).name;
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim();
  if (!cleaned || /^\.+$/.test(cleaned) || RESERVED_WINDOWS_NAMES.has(cleaned.toUpperCase())) return fallbackValue;
  return cleaned.length > 0 ? cleaned : fallbackValue;
}

async function pickFolderNative() {
  if (process.platform === 'win32') {
    const psCommand = `
      Add-Type -AssemblyName System.Windows.Forms;
      $f = New-Object System.Windows.Forms.FolderBrowserDialog;
      $f.Description = "Select a folder for Lumina RAW";
      if($f.ShowDialog() -eq "OK"){ $f.SelectedPath }
    `;
    const { stdout } = await execPromise(`powershell -Command "${psCommand.replace(/\n/g, '')}"`);
    return stdout.trim();
  }

  if (process.platform === 'darwin') {
    const { stdout } = await execPromise(`osascript -e 'POSIX path of (choose folder with prompt "Select a folder for Lumina RAW")'`);
    return stdout.trim();
  }

  if (process.platform === 'linux') {
    try {
      const { stdout } = await execPromise('zenity --file-selection --directory');
      const selected = stdout.trim();
      if (selected) return selected;
    } catch (_zenityErr) {
      // try kdialog fallback
    }

    try {
      const { stdout } = await execPromise('kdialog --getexistingdirectory');
      return stdout.trim();
    } catch (_) {
      throw new Error('No supported folder picker found on Linux (install zenity or kdialog).');
    }
  }

  return '';
}

app.use(cors());
app.use(express.json());

// --- Native Folder Picker (Windows) ---
app.get('/api/pick-folder', async (req, res) => {
  try {
    const pickedPath = await pickFolderNative();
    res.json({ path: pickedPath || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Setup storage for uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});


let conversionStatus = {
  active: false,
  progress: 0,
  total: 0,
  currentFile: '',
  logs: [],
  error: null,
  zipPath: null
};

function resetStatus() {
  conversionStatus.active = false;
  conversionStatus.progress = 0;
  conversionStatus.total = 0;
  conversionStatus.currentFile = '';
  conversionStatus.logs = [];
  conversionStatus.error = null;
  conversionStatus.zipPath = null;
}

// --- Folder Browser API ---
app.get('/api/browse', async (req, res) => {
  const currentPath = req.query.path || process.cwd();
  try {
    const items = await fs.readdir(currentPath, { withFileTypes: true });
    const result = items
      .filter(item => item.isDirectory() || RAW_EXTENSIONS.includes(path.extname(item.name).toLowerCase()))
      .map(item => ({
        name: item.name,
        isDir: item.isDirectory(),
        path: path.join(currentPath, item.name)
      }));
    
    // Add parent option
    const parent = path.dirname(currentPath);
    res.json({
      currentPath,
      parent: parent !== currentPath ? parent : null,
      items: result
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Local Conversion API ---
app.post('/api/convert', async (req, res) => {
  const { inputDir, outputDir, format, quality } = req.body;
  if (conversionStatus.active) return res.status(400).json({ error: 'Busy' });

  try {
    const files = await fs.readdir(inputDir);
    const rawFiles = files.filter(f => RAW_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    
    if (rawFiles.length === 0) return res.status(400).json({ error: 'No RAW files' });

    resetStatus();
    conversionStatus.active = true;
    conversionStatus.total = rawFiles.length;
    res.json({ message: 'Started' });

    startLocalConversion(rawFiles, inputDir, outputDir, format, quality);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function startLocalConversion(files, inputDir, outputDir, format, quality) {
  if (!existsSync(outputDir)) await fs.mkdir(outputDir, { recursive: true });

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const inputPath = path.join(inputDir, file);
    const outputName = path.parse(file).name + (format === 'png' ? '.png' : '.jpg');
    const outputPath = path.join(outputDir, outputName);

    conversionStatus.currentFile = file;
    conversionStatus.progress = i + 1;

    if (existsSync(outputPath)) {
      conversionStatus.logs.push(`Skipping ${file}`);
      continue;
    }

    try {
      await smartConvert({ inputPath, outputPath, format, quality });
      conversionStatus.logs.push(`Completed ${file}`);
    } catch (err) {
      conversionStatus.logs.push(`Error ${file}: ${err.message}`);
    }
  }
  conversionStatus.active = false;
  conversionStatus.currentFile = 'Done';
}

// --- Cloud Upload (Stage 1) ---
app.post('/api/upload', upload.array('images'), async (req, res) => {
  const files = req.files;
  console.log(`Received ${files ? files.length : 0} files for upload`);
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files' });
  
  // Return the temp filenames so the frontend can trigger conversion later
  const sessionFiles = files.map(f => ({ path: f.path, originalname: f.originalname }));
  res.json({ message: 'Uploaded', files: sessionFiles });
});

// --- Cloud Convert (Stage 2) ---
app.post('/api/convert-cloud', async (req, res) => {
  const { files, format, quality } = req.body;
  if (!files || files.length === 0) return res.status(400).json({ error: 'No files' });
  if (conversionStatus.active) return res.status(400).json({ error: 'Busy' });

  const uploadsRoot = path.resolve(process.cwd(), 'uploads');
  const normalizedFiles = files
    .map(file => {
      if (!file || typeof file.path !== 'string' || typeof file.originalname !== 'string') return null;
      const resolvedPath = path.resolve(process.cwd(), file.path);
      const relativePath = path.relative(uploadsRoot, resolvedPath);
      if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
      return {
        path: resolvedPath,
        originalname: path.basename(file.originalname),
        baseName: sanitizeOutputBaseName(file.originalname, 'converted_file')
      };
    })
    .filter(Boolean);

  if (normalizedFiles.length !== files.length) {
    return res.status(400).json({ error: 'Invalid upload session files' });
  }

  resetStatus();
  conversionStatus.active = true;
  conversionStatus.total = normalizedFiles.length;
  res.json({ message: 'Starting cloud conversion' });

  const outputDir = path.join(process.cwd(), 'outputs', Date.now().toString());
  await fs.mkdir(outputDir, { recursive: true });

  try {
    const usedOutputNames = new Set();

    for (let i = 0; i < normalizedFiles.length; i++) {
      const file = normalizedFiles[i];
      try {
        const ext = format === 'png' ? '.png' : '.jpg';
        const baseSeed = file.baseName || `converted_${i + 1}`;
        let baseName = baseSeed;
        let suffix = 1;
        while (usedOutputNames.has(baseName.toLowerCase())) {
          baseName = `${baseSeed}_${suffix}`;
          suffix += 1;
        }
        usedOutputNames.add(baseName.toLowerCase());
        const outputPath = path.join(outputDir, `${baseName}${ext}`);
        
        conversionStatus.currentFile = file.originalname;
        conversionStatus.progress = i + 1;

        await smartConvert({ inputPath: file.path, outputPath, format, quality });
        conversionStatus.logs.push(`Completed ${file.originalname}`);
      } catch (fileErr) {
        console.error(`Error converting ${file.originalname}:`, fileErr);
        conversionStatus.logs.push(`Error ${file.originalname}: ${fileErr.message}`);
        // Continue to next file
      } finally {
        // Cleanup uploaded temp file
        await fs.unlink(file.path).catch(() => {});
      }
    }

    if (normalizedFiles.length === 1 && usedOutputNames.size === 1) {
      // Single file - provide direct download
      const singleFileName = Array.from(usedOutputNames)[0] + (format === 'png' ? '.png' : '.jpg');
      const finalPath = path.join(process.cwd(), 'outputs', singleFileName);
      await fs.rename(path.join(outputDir, singleFileName), finalPath);
      conversionStatus.zipPath = singleFileName;
      // Cleanup temp dir
      await fs.rm(outputDir, { recursive: true }).catch(() => {});
    } else {
      // Multiple files - zip them
      const zipName = `converted_${Date.now()}.zip`;
      const zipPath = path.join(process.cwd(), 'outputs', zipName);
      const output = createWriteStream(zipPath);
      const archiverFunc = typeof archiver === 'function' ? archiver : archiver.default;
      const archive = archiverFunc('zip', { zlib: { level: 9 } });

      await new Promise((resolve, reject) => {
        output.on('close', resolve);
        output.on('error', reject);
        archive.on('error', reject);
        archive.pipe(output);
        archive.directory(outputDir, false);
        archive.finalize();
      });

      conversionStatus.zipPath = zipName;
    }
  } catch (err) {
    console.error('Conversion/Zip Error:', err);
    conversionStatus.error = err.message;
  } finally {
    conversionStatus.active = false;
    conversionStatus.currentFile = 'Done';
  }
});

app.get('/api/download/:zipName', (req, res) => {
  const filePath = path.join(process.cwd(), 'outputs', req.params.zipName);
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.zipName}"`);
  res.download(filePath);
});

// --- Workspace Cleanup API ---
app.post('/api/clear', async (req, res) => {
  try {
    const uploadFiles = await fs.readdir('uploads');
    const outputFiles = await fs.readdir('outputs');
    
    for (const f of uploadFiles) await fs.unlink(path.join('uploads', f)).catch(() => {});
    for (const f of outputFiles) {
      const p = path.join('outputs', f);
      const stat = await fs.stat(p);
      if (stat.isDirectory()) await fs.rm(p, { recursive: true }).catch(() => {});
      else await fs.unlink(p).catch(() => {});
    }
    
    // Reset global status
    resetStatus();
    
    res.json({ message: 'Workspace cleared' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Auto-Cleanup Task (Every Hour) ---
const CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
const MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

setInterval(async () => {
  console.log("Running auto-cleanup...");
  const now = Date.now();
  const dirs = ['uploads', 'outputs'];
  
  for (const dir of dirs) {
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const filePath = path.join(dir, file);
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > MAX_AGE) {
          console.log(`Auto-deleting old file: ${file}`);
          if (stats.isDirectory()) await fs.rm(filePath, { recursive: true }).catch(() => {});
          else await fs.unlink(filePath).catch(() => {});
        }
      }
    } catch (err) {
      console.error(`Cleanup error in ${dir}:`, err);
    }
  }
}, CLEANUP_INTERVAL);

app.get('/api/status', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  const interval = setInterval(() => {
    res.write(`data: ${JSON.stringify(conversionStatus)}\n\n`);
  }, 500);
  req.on('close', () => clearInterval(interval));
});

app.listen(port, () => console.log(`Backend v2.0 on port ${port}`));
