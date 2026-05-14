import express from 'express';
import cors from 'cors';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs/promises';
import { existsSync, createWriteStream, mkdirSync } from 'fs';
import multer from 'multer';
import { ZipArchive } from 'archiver';

// Ensure directories exist
if (!existsSync('uploads')) mkdirSync('uploads');
if (!existsSync('outputs')) mkdirSync('outputs');

const execPromise = promisify(exec);
const app = express();
const port = 48211;

// ImageMagick Path
const MAGICK_PATH = `"C:\\Program Files\\ImageMagick-7.1.2-Q16\\magick.exe"`;

app.use(cors());
app.use(express.json());

// --- Native Folder Picker (Windows) ---
app.get('/api/pick-folder', async (req, res) => {
  try {
    const psCommand = `
      Add-Type -AssemblyName System.Windows.Forms;
      $f = New-Object System.Windows.Forms.FolderBrowserDialog;
      $f.Description = "Select a folder for Lumina RAW";
      if($f.ShowDialog() -eq "OK"){ $f.SelectedPath }
    `;
    const { exec } = await import('child_process');
    exec(`powershell -Command "${psCommand.replace(/\n/g, '')}"`, (err, stdout, stderr) => {
      if (err) return res.status(500).json({ error: err.message });
      const pickedPath = stdout.trim();
      res.json({ path: pickedPath });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Setup storage for uploads
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB limit
});

const RAW_EXTENSIONS = [
  '.3fr', '.arw', '.bay', '.bmq', '.cap', '.cine', '.cr2', '.cr3', '.crw', '.cs1',
  '.dc2', '.dcr', '.dng', '.drf', '.dsc', '.erf', '.fff', '.ia', '.iiq', '.k25',
  '.kc2', '.kdc', '.mdc', '.mef', '.mos', '.mrw', '.nef', '.nrw', '.orf', '.pef',
  '.ptx', '.pxn', '.qtk', '.raf', '.raw', '.rdc', '.rw2', '.rwl', '.rwz', '.sr2',
  '.srf', '.srw', '.sti', '.x3f'
];

let conversionStatus = {
  active: false,
  progress: 0,
  total: 0,
  currentFile: '',
  logs: [],
  error: null,
  zipPath: null
};

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
  const { inputDir, outputDir, brand, format, quality } = req.body;
  if (conversionStatus.active) return res.status(400).json({ error: 'Busy' });

  try {
    const files = await fs.readdir(inputDir);
    const rawFiles = files.filter(f => RAW_EXTENSIONS.includes(path.extname(f).toLowerCase()));
    
    if (rawFiles.length === 0) return res.status(400).json({ error: 'No RAW files' });

    conversionStatus = { active: true, progress: 0, total: rawFiles.length, currentFile: '', logs: [], error: null };
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
      const qFlag = format === 'jpg' ? `-quality ${quality || 100}` : '';
      const cmd = `${MAGICK_PATH} "${inputPath}" -auto-orient -auto-level ${qFlag} "${outputPath}"`;
      await execPromise(cmd);
      conversionStatus.logs.push(`Completed ${file}`);
    } catch (err) {
      conversionStatus.logs.push(`Error ${file}: ${err.message}`);
    }
  }
  conversionStatus.active = false;
  conversionStatus.currentFile = 'Done';
}

// --- Upload & Convert API ---
app.post('/api/upload', upload.array('images'), async (req, res) => {
  const { format, quality } = req.body;
  const files = req.files;

  if (!files || files.length === 0) return res.status(400).json({ error: 'No files' });

  conversionStatus = { active: true, progress: 0, total: files.length, currentFile: '', logs: [], error: null, zipPath: null };
  res.json({ message: 'Upload received, starting conversion' });

  const outputDir = path.join(process.cwd(), 'outputs', Date.now().toString());
  await fs.mkdir(outputDir, { recursive: true });

  try {
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = format === 'png' ? '.png' : '.jpg';
      const outputPath = path.join(outputDir, file.originalname + ext);
      
      conversionStatus.currentFile = file.originalname;
      conversionStatus.progress = i + 1;

      const qFlag = format === 'jpg' ? `-quality ${quality || 100}` : '';
      const cmd = `${MAGICK_PATH} "${file.path}" -auto-orient -auto-level ${qFlag} "${outputPath}"`;
      await execPromise(cmd);
      conversionStatus.logs.push(`Completed ${file.originalname}`);
      
      // Cleanup uploaded temp file
      await fs.unlink(file.path);
    }

    // Zip the results
    const zipName = `converted_${Date.now()}.zip`;
    const zipPath = path.join(process.cwd(), 'outputs', zipName);
    const output = createWriteStream(zipPath);
    const archive = new ZipArchive({ zlib: { level: 9 } });

    archive.pipe(output);
    archive.directory(outputDir, false);
    await archive.finalize();

    conversionStatus.zipPath = zipName;
  } catch (err) {
    conversionStatus.error = err.message;
  } finally {
    conversionStatus.active = false;
    conversionStatus.currentFile = 'Done';
  }
});

app.get('/api/download/:zipName', (req, res) => {
  const filePath = path.join(process.cwd(), 'outputs', req.params.zipName);
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
    conversionStatus = { active: false, progress: 0, total: 0, currentFile: '', logs: [], error: null, zipPath: null };
    
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
