// 测试脚本 - 直接测试 FFmpeg 和 SiliconFlow API
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// 手动加载 .env 文件
const envFile = path.join(process.cwd(), '.env');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx > 0) {
      const key = trimmed.substring(0, idx).trim();
      const value = trimmed.substring(idx + 1).trim();
      process.env[key] = value;
    }
  }
}

console.log('SILICONFLOW_API_KEY loaded:', !!process.env.SILICONFLOW_API_KEY);

// 设置 FFmpeg 路径
const ffmpegPath = path.join(
  process.cwd(),
  'node_modules',
  '.pnpm',
  '@ffmpeg-installer+win32-x64@4.1.0',
  'node_modules',
  '@ffmpeg-installer',
  'win32-x64',
  'ffmpeg.exe'
);
ffmpeg.setFfmpegPath(ffmpegPath);

console.log('Testing FFmpeg...');

// 测试 ffprobe
ffmpeg.ffprobe(ffmpegPath, (err, metadata) => {
  if (err) {
    console.error('FFprobe error:', err.message);
  } else {
    console.log('FFprobe works! Version:', metadata.format?.format_long_name);
  }
});

// 测试 SiliconFlow API
async function testSiliconFlow() {
  console.log('\nTesting SiliconFlow API...');

  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) {
    console.log('No API key, skipping test');
    return;
  }

  console.log('API key loaded:', apiKey.substring(0, 10) + '...');

  // 创建一个 1 秒的静音音频用于测试
  const testDir = path.join(process.cwd(), 'temp_test');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }
  const testAudioPath = path.join(testDir, 'test.wav');

  try {
    // 使用 ffmpeg 创建测试音频
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input('anullsrc=r=16000:cl=mono')
        .duration(1)
        .output(testAudioPath)
        .on('end', () => {
          console.log('Test audio created');
          resolve();
        })
        .on('error', (err) => {
          console.error('Create audio error:', err.message);
          reject(err);
        })
        .run();
    });

    // 读取音频文件
    const audioBuffer = fs.readFileSync(testAudioPath);
    const base64Audio = audioBuffer.toString('base64');

    // 调用 API
    const response = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: createFormData(base64Audio, 'audio/wav'),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('SiliconFlow API error:', response.status, errorText);
    } else {
      const result = await response.json();
      console.log('SiliconFlow API success:', result);
    }
  } catch (error) {
    console.error('Test error:', error.message);
  }
}

function createFormData(base64Audio, mimeType) {
  const byteCharacters = atob(base64Audio);
  const byteNumbers = new Array(byteCharacters.length);
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  const blob = new Blob([byteArray], { type: mimeType });

  const formData = new FormData();
  formData.append('file', blob, 'audio.wav');
  formData.append('model', 'paraformer-realtime-v2');
  formData.append('response_format', 'verbose_json');
  formData.append('language', 'auto');

  return formData;
}

testSiliconFlow();
