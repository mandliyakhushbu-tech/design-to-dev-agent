/* ─────────────────────────────────────────────
   Design-to-Dev Handoff Agent — script.js

   Current: full mock flow (no API)
   TODO: swap analyzeDesign() stub for real Claude API call
───────────────────────────────────────────── */

// ── State ────────────────────────────────────

const state = {
  files: [],           // { file: File, dataUrl: string, id: string }[]
  outputFormat: 'both',
  animLib: 'gsap',
  isLoading: false,
  inputMode: 'file',   // 'file' | 'url'
  urlData: null,       // { screenshot: string|null, sourceCode: string|null, url: string }
  lastResult: null,    // previous generated output — used for refinement
};

// ── DOM refs ─────────────────────────────────

const uploadZone     = document.getElementById('uploadZone');
const fileInput      = document.getElementById('fileInput');
const browseBtn      = document.getElementById('browseBtn');
const uploadIdle     = document.getElementById('uploadIdle');
const uploadPreview  = document.getElementById('uploadPreview');
const instructionEl  = document.getElementById('instructionInput');
const charCountEl    = document.getElementById('charCount');
const submitBtn      = document.getElementById('submitBtn');

const outputEmpty    = document.getElementById('outputEmpty');
const outputContent  = document.getElementById('outputContent');
const outputLoading  = document.getElementById('outputLoading');
const outputTabs     = document.getElementById('outputTabs');
const jsTabBtn       = document.getElementById('jsTabBtn');

const htmlCodeEl     = document.getElementById('htmlCode');
const cssCodeEl      = document.getElementById('cssCode');
const jsCodeEl       = document.getElementById('jsCode');
const specsBlockEl   = document.getElementById('specsBlock');

// ── Input mode toggle ─────────────────────────

const urlPanel    = document.getElementById('urlPanel');
const urlInputEl  = document.getElementById('urlInput');
const fetchUrlBtn = document.getElementById('fetchUrlBtn');
const urlStatus   = document.getElementById('urlStatus');

document.querySelectorAll('.input-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.input-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    state.inputMode = tab.dataset.mode;

    const isUrl = state.inputMode === 'url';
    uploadZone.hidden = isUrl;
    urlPanel.hidden   = !isUrl;

    // Reset URL data when switching back to file
    if (!isUrl) {
      state.urlData = null;
      setUrlStatus('', '');
    }
    updateSubmitState();
  });
});

urlInputEl.addEventListener('input', () => {
  state.urlData = null; // clear old fetch if URL changes
  setUrlStatus('', '');
  updateSubmitState();
});

urlInputEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') fetchUrlBtn.click();
});

fetchUrlBtn.addEventListener('click', handleFetchUrl);

function setUrlStatus(type, msg) {
  urlStatus.className = `url-status${type ? ' is-' + type : ''}`;
  urlStatus.textContent = msg;
}

async function handleFetchUrl() {
  const url = urlInputEl.value.trim();
  if (!url) return;

  fetchUrlBtn.disabled = true;
  setUrlStatus('loading', 'Fetching page...');
  state.urlData = null;

  try {
    const [screenshot, sourceCode] = await Promise.allSettled([
      captureScreenshot(url),
      fetchPageSource(url),
    ]);

    state.urlData = {
      url,
      screenshot: screenshot.status === 'fulfilled' ? screenshot.value : null,
      sourceCode: sourceCode.status === 'fulfilled' ? sourceCode.value : null,
    };

    const parts = [];
    if (state.urlData.screenshot) parts.push('screenshot');
    if (state.urlData.sourceCode)  parts.push('source code');

    if (parts.length) {
      setUrlStatus('success', `Got ${parts.join(' + ')} ✓ — now add your instruction and Analyze`);
    } else {
      // Fetch failed — still save the URL so Gemini can use it as a reference
      state.urlData = { url, screenshot: null, sourceCode: null };
      setUrlStatus('warn', `Couldn't auto-fetch page (browser restriction) — URL saved as reference. For best results, take a screenshot and upload it. Or just Analyze with your instruction.`);
    }
    updateSubmitState();
  } catch (err) {
    state.urlData = { url, screenshot: null, sourceCode: null };
    setUrlStatus('warn', `Fetch failed — URL saved as reference. Upload a screenshot for better results.`);
    updateSubmitState();
  } finally {
    fetchUrlBtn.disabled = false;
    updateSubmitState();
  }
}

// Race two CORS proxies — use whichever responds first and succeeds
async function fetchViaProxy(targetUrl, asBlob = false, timeoutMs = 25000) {
  const proxies = [
    `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}`,
    `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`,
  ];
  const res = await Promise.any(
    proxies.map(async proxyUrl => {
      const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(timeoutMs) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r;
    })
  );
  return asBlob ? res.blob() : res.text();
}

async function captureScreenshot(url) {
  const screenshotUrl = `https://image.thum.io/get/width/1200/crop/800/${url}`;
  const blob = await fetchViaProxy(screenshotUrl, true, 25000);
  if (!blob.size) throw new Error('Screenshot empty');

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Failed to read screenshot'));
    reader.readAsDataURL(blob);
  });
}

async function fetchPageSource(url) {
  const html = await fetchViaProxy(url, false, 25000);
  return extractAnimationCode(html);
}

function extractAnimationCode(html) {
  const chunks = [];

  // Extract <style> blocks with animation-relevant CSS
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)];
  styles.forEach(m => {
    const css = m[1].trim();
    if (/animation|transition|transform|keyframe|@keyframes/i.test(css)) {
      chunks.push('/* CSS */\n' + css.substring(0, 8000));
    }
  });

  // Extract inline <script> blocks with animation code
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach(m => {
    const js = m[1].trim();
    if (/gsap|anime|motion|\.animate|transition|keyframe|requestAnimationFrame/i.test(js)) {
      chunks.push('/* JS */\n' + js.substring(0, 8000));
    }
  });

  // If no inline code found (most modern sites use bundled JS) — extract page context
  if (!chunks.length) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Look for external lib hints in script src attributes
    const extLibs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
      .map(m => m[1])
      .filter(src => /gsap|three|motion|anime|lottie|locomotive|swiper|webgl|pixi/i.test(src));

    // Grab visible text for page context (strip tags)
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    const bodyText  = bodyMatch
      ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, '')
                    .replace(/<style[\s\S]*?<\/style>/gi, '')
                    .replace(/<[^>]+>/g, ' ')
                    .replace(/\s+/g, ' ').trim()
                    .substring(0, 2000)
      : '';

    const info = [];
    if (title)          info.push(`Page title: ${title}`);
    if (extLibs.length) info.push(`Animation libraries in external scripts: ${extLibs.join(', ')}`);
    if (bodyText)       info.push(`Visible page text: ${bodyText}`);

    if (info.length) {
      chunks.push('/* PAGE CONTEXT (animation is in external JS bundles, not inline) */\n' + info.join('\n'));
    } else {
      throw new Error('Could not extract content from this page');
    }
  }

  return chunks.join('\n\n').substring(0, 20000);
}

// ── File upload ───────────────────────────────

browseBtn.addEventListener('click', () => fileInput.click());
uploadZone.addEventListener('click', (e) => {
  if (e.target === uploadZone || e.target === uploadIdle) fileInput.click();
});

fileInput.addEventListener('change', (e) => {
  handleFiles(Array.from(e.target.files));
  fileInput.value = '';
});

uploadZone.addEventListener('dragenter', (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragover',  (e) => { e.preventDefault(); uploadZone.classList.add('drag-over'); });
uploadZone.addEventListener('dragleave', (e) => {
  if (!uploadZone.contains(e.relatedTarget)) uploadZone.classList.remove('drag-over');
});
uploadZone.addEventListener('drop', (e) => {
  e.preventDefault();
  uploadZone.classList.remove('drag-over');
  handleFiles(Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/')));
});

function handleFiles(newFiles) {
  const valid = newFiles.filter(f => f.type.startsWith('image/'));
  if (!valid.length) return;

  Promise.all(
    valid.map(file => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ file, dataUrl: e.target.result, id: crypto.randomUUID() });
      reader.readAsDataURL(file);
    }))
  ).then(results => {
    state.files.push(...results);
    renderPreview();
    updateSubmitState();
  });
}

function removeFile(id) {
  state.files = state.files.filter(f => f.id !== id);
  renderPreview();
  updateSubmitState();
}

function renderPreview() {
  if (!state.files.length) {
    uploadPreview.hidden = true;
    uploadIdle.hidden = false;
    return;
  }

  uploadIdle.hidden = true;
  uploadPreview.hidden = false;
  uploadPreview.innerHTML = '';

  state.files.forEach(({ dataUrl, file, id }) => {
    const item = document.createElement('div');
    item.className = 'preview-item';

    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = file.name;
    img.title = file.name;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeFile(id); });

    item.appendChild(img);
    item.appendChild(removeBtn);
    uploadPreview.appendChild(item);
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-more-btn';
  addBtn.textContent = '+';
  addBtn.title = 'Add more files';
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput.click(); });
  uploadPreview.appendChild(addBtn);
}

// ── Instruction textarea ──────────────────────

instructionEl.addEventListener('input', () => {
  const len = instructionEl.value.length;
  charCountEl.textContent = `${len} character${len !== 1 ? 's' : ''}`;
  updateSubmitState();

  // Reset suggestions empty message back to default when user starts typing
  suggestionsEmpty.querySelector('p').innerHTML =
    'Type an instruction and click <strong>Get Suggestions</strong> for guidance and best practices.';
});

// ── Segmented controls ────────────────────────

function wireSegmented(containerId, stateKey, onChange) {
  const container = document.getElementById(containerId);
  container.querySelectorAll('.seg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state[stateKey] = btn.dataset.value;
      onChange && onChange(btn.dataset.value);
    });
  });
}

wireSegmented('outputFormat', 'outputFormat');
wireSegmented('animLib', 'animLib', (val) => {
  // Keep JS tab label in sync with selected lib
  const labels = { gsap: 'JS / GSAP', css: 'CSS Anim', framer: 'Framer Motion' };
  if (jsTabBtn) jsTabBtn.textContent = labels[val] || 'JS';
});

// ── Submit state ──────────────────────────────

function updateSubmitState() {
  const hasFiles  = state.files.length > 0;
  const hasText   = instructionEl.value.trim().length > 0;
  const hasUrl    = state.inputMode === 'url' && state.urlData !== null;
  const enabled   = (hasFiles || hasText || hasUrl) && !state.isLoading;
  submitBtn.disabled = !enabled;
  refineBtn.disabled = !hasText || state.isLoading;
}

// ── Submit ────────────────────────────────────

const refineBtn = document.getElementById('refineBtn');

submitBtn.addEventListener('click', handleSubmit);
refineBtn.addEventListener('click', handleRefine);

function showRefineMode() {
  // Switch to two-button layout
  submitBtn.querySelector('.submit-label').textContent = 'New Analysis';
  refineBtn.hidden = false;
  instructionEl.placeholder = 'What to change? (e.g. "remove the green dots, keep everything else same")';
}

function showFreshMode() {
  submitBtn.querySelector('.submit-label').textContent = 'Analyze & Generate';
  refineBtn.hidden = true;
  instructionEl.placeholder = 'e.g. "Infinite canvas, cards sit still, mouse wheel pans horizontally, smooth momentum, dark background, desktop only"';
}

async function handleSubmit() {
  if (state.isLoading) return;

  const instruction = instructionEl.value.trim();
  if (!state.files.length && !instruction) return;

  // Fresh analysis — clear last result
  state.lastResult = null;
  showFreshMode();

  setLoading(true);
  showOutputLoading();

  try {
    const result = await analyzeDesign({
      files:       state.files,
      instruction,
      outputFormat: state.outputFormat,
      animLib:      state.animLib,
      urlData:      state.urlData,
    });
    renderOutput(result);
  } catch (err) {
    console.error('Analysis failed:', err);
    stopLoadingSteps();
    showError(err.message);
  } finally {
    stopLoadingSteps();
    setLoading(false);
  }
}

async function handleRefine() {
  if (state.isLoading) return;
  if (!state.lastResult) { handleSubmit(); return; }

  const instruction = instructionEl.value.trim();
  if (!instruction) return;

  setLoading(true);
  showOutputLoading();

  try {
    const result = await refineOutput({
      previousResult: state.lastResult,
      instruction,
      animLib: state.animLib,
      outputFormat: state.outputFormat,
    });
    renderOutput(result);
  } catch (err) {
    console.error('Refinement failed:', err);
    stopLoadingSteps();
    showError(err.message);
  } finally {
    stopLoadingSteps();
    setLoading(false);
  }
}

function setLoading(loading) {
  state.isLoading = loading;
  submitBtn.disabled = loading;
  submitBtn.classList.toggle('loading', loading);
  submitBtn.querySelector('.submit-label').textContent = loading ? 'Analyzing...' : 'Analyze & Generate';
  submitBtn.querySelector('.submit-spinner').hidden = !loading;
}

let _loadingStepTimer = null;

function showOutputLoading() {
  outputEmpty.hidden   = true;
  outputContent.hidden = true;
  outputLoading.hidden = false;

  // Animate the step pills sequentially
  const steps = outputLoading.querySelectorAll('.step');
  let current = 0;
  steps.forEach(s => s.classList.remove('active'));
  steps[0].classList.add('active');

  _loadingStepTimer = setInterval(() => {
    steps[current].classList.remove('active');
    current = (current + 1) % steps.length;
    steps[current].classList.add('active');
  }, 600);
}

function stopLoadingSteps() {
  clearInterval(_loadingStepTimer);
  outputLoading.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
}

function showError(msg) {
  outputLoading.hidden = true;
  outputEmpty.hidden   = false;
  outputContent.hidden = true;
  outputEmpty.querySelector('.empty-title').textContent = 'Something went wrong';
  outputEmpty.querySelector('.empty-sub').textContent   = msg || 'Please try again.';
}

// ── Mock AI — instruction-aware ───────────────
//
// Detects component type from instruction keywords so the mock
// output feels contextually relevant while testing.
//
// REPLACE analyzeDesign() body with real Claude API call when ready.
// Each file in payload.files has .dataUrl (base64) for vision input.

function detectComponent(instruction) {
  const t = instruction.toLowerCase();
  if (/modal|popup|dialog|overlay/.test(t))     return 'modal';
  if (/nav|navbar|header|menu/.test(t))          return 'navbar';
  if (/slide|carousel|swipe|slider/.test(t))     return 'slider';
  if (/form|input|field|login|signup/.test(t))   return 'form';
  if (/hero|banner|splash|landing/.test(t))      return 'hero';
  if (/button|btn|cta/.test(t))                  return 'button';
  if (/tooltip|popover|hint/.test(t))            return 'tooltip';
  if (/dropdown|select|menu/.test(t))            return 'dropdown';
  return 'card';
}

// ── API key management ────────────────────────

const apiKeyBtn     = document.getElementById('apiKeyBtn');
const apiKeyDot     = document.getElementById('apiKeyDot');
const apiKeyLabel   = document.getElementById('apiKeyLabel');
const apiKeyPopover = document.getElementById('apiKeyPopover');
const apiKeyInput   = document.getElementById('apiKeyInput');
const apiKeySaveBtn = document.getElementById('apiKeySaveBtn');
const apiKeyClearBtn= document.getElementById('apiKeyClearBtn');

function getApiKey() { return localStorage.getItem('gemini_api_key') || ''; }

function refreshApiKeyUI() {
  const key = getApiKey();
  apiKeyDot.classList.toggle('is-set', !!key);
  apiKeyLabel.textContent = key ? 'Gemini Key ✓' : 'Add Gemini Key';
}

apiKeyBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  apiKeyPopover.hidden = !apiKeyPopover.hidden;
  if (!apiKeyPopover.hidden) {
    const k = getApiKey();
    apiKeyInput.value = k ? '••••••••••••••••' : '';
    apiKeyInput.focus();
  }
});

document.addEventListener('click', (e) => {
  if (!apiKeyPopover.hidden && !document.getElementById('apiKeyWrap').contains(e.target)) {
    apiKeyPopover.hidden = true;
  }
});

apiKeySaveBtn.addEventListener('click', () => {
  const val = apiKeyInput.value.trim();
  if (!val || val.startsWith('••')) { apiKeyPopover.hidden = true; return; }
  localStorage.setItem('gemini_api_key', val);
  refreshApiKeyUI();
  apiKeyPopover.hidden = true;
});

apiKeyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') apiKeySaveBtn.click();
});

apiKeyClearBtn.addEventListener('click', () => {
  localStorage.removeItem('gemini_api_key');
  refreshApiKeyUI();
  apiKeyPopover.hidden = true;
});

refreshApiKeyUI(); // run on load

// ── GitHub publish ────────────────────────────

const githubSettingsBtn = document.getElementById('githubSettingsBtn');
const githubPopover     = document.getElementById('githubPopover');
const githubDot         = document.getElementById('githubDot');
const githubSettingsLabel = document.getElementById('githubSettingsLabel');
const githubTokenInput  = document.getElementById('githubTokenInput');
const githubOwnerInput  = document.getElementById('githubOwnerInput');
const githubRepoInput   = document.getElementById('githubRepoInput');
const githubSaveBtn     = document.getElementById('githubSaveBtn');
const githubClearBtn    = document.getElementById('githubClearBtn');
const publishBtn        = document.getElementById('publishBtn');
const publishLabel      = document.getElementById('publishLabel');

function getGithubConfig() {
  return {
    token: localStorage.getItem('github_token') || '',
    owner: localStorage.getItem('github_owner') || '',
    repo:  localStorage.getItem('github_repo')  || '',
  };
}

function refreshGithubUI() {
  const { token, owner, repo } = getGithubConfig();
  const configured = !!(token && owner && repo);
  githubDot.classList.toggle('is-set', configured);
  githubSettingsLabel.textContent = configured ? `${owner}/${repo}` : 'GitHub';
}

githubSettingsBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  githubPopover.hidden = !githubPopover.hidden;
  if (!githubPopover.hidden) {
    const cfg = getGithubConfig();
    githubTokenInput.value = cfg.token ? '••••••••••••••••' : '';
    githubOwnerInput.value = cfg.owner;
    githubRepoInput.value  = cfg.repo;
  }
});

document.addEventListener('click', (e) => {
  if (!githubPopover.hidden && !document.getElementById('githubWrap').contains(e.target)) {
    githubPopover.hidden = true;
  }
});

githubSaveBtn.addEventListener('click', () => {
  const token = githubTokenInput.value.trim();
  const owner = githubOwnerInput.value.trim();
  const repo  = githubRepoInput.value.trim();
  if (!owner || !repo) return;
  if (token && !token.startsWith('••')) localStorage.setItem('github_token', token);
  localStorage.setItem('github_owner', owner);
  localStorage.setItem('github_repo',  repo);
  refreshGithubUI();
  githubPopover.hidden = true;
});

githubClearBtn.addEventListener('click', () => {
  localStorage.removeItem('github_token');
  localStorage.removeItem('github_owner');
  localStorage.removeItem('github_repo');
  refreshGithubUI();
  githubPopover.hidden = true;
});

refreshGithubUI();

// Encode file content to base64 (handles Unicode/emoji safely)
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  bytes.forEach(b => binary += String.fromCharCode(b));
  return btoa(binary);
}

async function pushFileToGitHub(token, owner, repo, path, content) {
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // Get current SHA (needed to update existing file)
  const getRes = await fetch(apiUrl, { headers });
  if (!getRes.ok && getRes.status !== 404) {
    throw new Error(`GitHub API error ${getRes.status} for ${path}`);
  }
  const current = getRes.ok ? await getRes.json() : null;
  const sha = current?.sha;

  // Push file
  const body = { message: `Update ${path}`, content: toBase64(content) };
  if (sha) body.sha = sha;

  const putRes = await fetch(apiUrl, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
    const err = await putRes.json().catch(() => ({}));
    throw new Error(err.message || `Failed to push ${path}`);
  }
}

const publishToast     = document.getElementById('publishToast');
const publishToastTitle = document.getElementById('publishToastTitle');
const publishToastSub   = document.getElementById('publishToastSub');

function setPublishStep(name, state) {
  // state: 'active' | 'done' | 'error'
  const el = document.getElementById(`pstep-${name}`);
  if (!el) return;
  el.classList.remove('is-active', 'is-done', 'is-error');
  el.classList.add(`is-${state}`);
  const icons = { active: '⏳', done: '✓', error: '✗' };
  el.querySelector('.pstep-icon').textContent = icons[state] || '⏳';
}

function resetPublishSteps() {
  ['index.html', 'style.css', 'script.js'].forEach(name => {
    const el = document.getElementById(`pstep-${name}`);
    if (!el) return;
    el.classList.remove('is-active', 'is-done', 'is-error');
    el.querySelector('.pstep-icon').textContent = '⏳';
  });
}

publishBtn.addEventListener('click', handlePublish);

async function handlePublish() {
  const { token, owner, repo } = getGithubConfig();

  if (!token || !owner || !repo) {
    githubPopover.hidden = false;
    return;
  }

  if (!window.showDirectoryPicker) {
    alert('Your browser does not support folder access. Please use Chrome or Edge.');
    return;
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({ mode: 'read' });
  } catch (e) {
    if (e.name === 'AbortError') return;
    throw e;
  }

  // Show toast
  publishToast.hidden = false;
  publishToastTitle.className = 'publish-toast-title';
  publishToastTitle.textContent = 'Publishing to GitHub…';
  publishToastSub.textContent = '';
  resetPublishSteps();

  publishBtn.disabled = true;
  publishLabel.textContent = 'Publishing…';

  try {
    const fileNames = ['index.html', 'style.css', 'script.js'];
    for (const name of fileNames) {
      setPublishStep(name, 'active');

      let fileHandle;
      try {
        fileHandle = await dirHandle.getFileHandle(name);
      } catch (_) {
        setPublishStep(name, 'error');
        throw new Error(`Could not find ${name} in the selected folder`);
      }

      const file    = await fileHandle.getFile();
      const content = await file.text();
      await pushFileToGitHub(token, owner, repo, name, content);
      setPublishStep(name, 'done');
    }

    // Success
    publishToastTitle.textContent = 'Published ✓';
    publishToastTitle.className = 'publish-toast-title is-success';
    publishToastSub.textContent = 'GitHub Pages will update in ~30 seconds.';
    publishLabel.textContent = 'Published ✓';

    setTimeout(() => {
      publishToast.hidden = true;
      publishLabel.textContent = 'Publish';
    }, 5000);

  } catch (err) {
    console.error('Publish failed:', err);
    publishToastTitle.textContent = 'Publish failed';
    publishToastTitle.className = 'publish-toast-title is-error';
    publishToastSub.textContent = err.message;
    publishLabel.textContent = 'Publish';

    setTimeout(() => { publishToast.hidden = true; }, 8000);
  } finally {
    publishBtn.disabled = false;
  }
}

// ── Gemini API ────────────────────────────────

const GEMINI_MODEL = 'gemini-2.5-flash';

function buildPrompt(instruction, animLib, outputFormat, sourceUrl = null) {
  const cdnTags = {
    'GSAP': '<script src="https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js"><\\/script>',
    'CSS animations': '<!-- No external library needed for CSS animations -->',
    'Framer Motion': '<script src="https://unpkg.com/framer-motion@11/dist/framer-motion.js"><\\/script>',
  };
  const cdn = cdnTags[animLib] || cdnTags['GSAP'];

  return `You are a Design-to-Dev Handoff Agent. Generate developer-ready specs and FULLY RUNNABLE code based on the user's instruction.

The user may write in Hinglish (Hindi + English mix) — understand the intent naturally.

━━━ PRIMARY INSTRUCTION (follow this above everything else) ━━━
"${instruction || 'Analyze the design and suggest an appropriate implementation.'}"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${sourceUrl ? `REFERENCE URL: ${sourceUrl}
Use this URL only for visual reference (colors, card styles, layout density). Do NOT copy its interaction logic — implement exactly what the instruction says above.` : ''}
ANIMATION LIBRARY: ${animLib}

INTERACTION PATTERN GUIDE — read before generating:
- "endless canvas / infinite canvas / figma-like" = a large static canvas of cards, user pans by scrolling mouse wheel (NOT auto-moving). Implement with: overflow:hidden viewport, translate the canvas container on wheel event, GSAP lerp for smooth deceleration. Cards never move on their own.
- "auto-scroll / marquee / ticker" = cards move automatically with no user input. Use GSAP repeat(-1).
- "scroll animation" = elements animate AS the user scrolls down the page. Use GSAP ScrollTrigger.
- These are three different things — do not mix them up.

CRITICAL CODE RULES:
1. The "html" field must be a COMPLETE standalone HTML file:
   - <!DOCTYPE html>, <html>, <head>, <body> tags
   - CDN script tags in <head>: ${cdn}
   - Inline <style> in <head>, inline <script> at bottom of <body>
   - NO external file references — fully self-contained
2. For 3D spheres/globes: CSS 3D transforms or canvas — NEVER flat SVG ellipses
3. All interactions must actually work when opened in a browser
4. Match colors, card sizes, spacing from the reference image or URL

IF BUILDING AN INFINITE CANVAS:
- Viewport: width:100vw, height:100vh, overflow:hidden
- Canvas container: position:absolute, large enough to hold all cards
- On wheel event: update targetX += e.deltaY (or deltaX for trackpad), use gsap.to(canvas, {x: targetX}) with lerp ease
- Cards are static divs inside the canvas — they do not animate themselves

Return ONLY a raw JSON object — no markdown, no code fences, no explanation:
{
  "component": "short name (e.g. wireframe-globe, button, modal)",
  "specs": {
    "groups": [
      { "title": "Layout",    "rows": [{ "key": "property", "val": "value" }] },
      { "title": "Colors",    "rows": [{ "key": "Background", "val": "#000" }] },
      { "title": "Animation", "rows": [
          { "key": "Type",     "val": "continuous rotation" },
          { "key": "Duration", "val": "0.3s per frame" },
          { "key": "Easing",   "val": "linear" },
          { "key": "Trigger",  "val": "on load, loops forever" }
        ]
      }
    ]
  },
  "html": "COMPLETE standalone HTML file as one string — self-contained, opens and runs in browser",
  "css": "extracted CSS snippet only (no html/body tags)",
  "js": "extracted ${animLib} animation code only"
}`;
}

function parseGeminiResponse(text) {
  // Try direct parse first
  try { return JSON.parse(text); } catch (_) {}
  // Strip markdown code fences if present
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(cleaned); } catch (_) {}
  // Last resort — find first JSON object or array block
  const objMatch = cleaned.match(/\{[\s\S]*\}/);
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  // Use whichever appears first in the string
  const match = objMatch && arrMatch
    ? (cleaned.indexOf(objMatch[0]) < cleaned.indexOf(arrMatch[0]) ? objMatch : arrMatch)
    : (objMatch || arrMatch);
  if (match) return JSON.parse(match[0]);
  throw new Error('Could not parse response as JSON');
}

async function analyzeDesign(payload) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error('Gemini API key not set — click "Add Gemini Key" in the header.');
  }

  const animLibName = { gsap: 'GSAP', css: 'CSS animations', framer: 'Framer Motion' }[payload.animLib] || 'GSAP';
  const parts = [];

  // Attach uploaded images
  payload.files.forEach(({ dataUrl, file }) => {
    const mimeType = file.type || 'image/jpeg';
    const base64   = dataUrl.split(',')[1];
    parts.push({ inlineData: { mimeType, data: base64 } });
  });

  // Attach URL screenshot if available
  if (payload.urlData?.screenshot) {
    parts.push({ inlineData: { mimeType: 'image/jpeg', data: payload.urlData.screenshot } });
  }

  // Attach page source code if available
  if (payload.urlData?.sourceCode) {
    parts.push({ text: `PAGE SOURCE CODE from ${payload.urlData.url}:\n\`\`\`\n${payload.urlData.sourceCode}\n\`\`\`` });
  }

  // Main prompt
  parts.push({ text: buildPrompt(payload.instruction, animLibName, payload.outputFormat, payload.urlData?.url) });

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${res.status}`;
    throw new Error(msg);
  }

  const data   = await res.json();
  const text   = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini — try again.');

  const result = parseGeminiResponse(text);
  return {
    ...result,
    format: payload.outputFormat,
    lib:    payload.animLib,
  };
}

// ── LEGACY MOCK (kept only for suggestions detectComponent) ──
const MOCK_DATA = {
  card: {
    specs: {
      groups: [
        { title: 'Layout', rows: [
          { key: 'Component',       val: 'Card' },
          { key: 'Width',           val: '360px' },
          { key: 'Padding',         val: '24px' },
          { key: 'Border radius',   val: '12px' },
          { key: 'Shadow',          val: '0 4px 24px rgba(0,0,0,0.3)' },
        ]},
        { title: 'Typography', rows: [
          { key: 'Title',           val: 'Inter 700 / 20px' },
          { key: 'Body',            val: 'Inter 400 / 14px / lh 1.6' },
          { key: 'Label',           val: 'Inter 500 / 12px / uppercase' },
        ]},
        { title: 'Colors', rows: [
          { key: 'Background',      val: '#18181c' },
          { key: 'Border',          val: '#2a2a32' },
          { key: 'Accent',          val: '#7c6dfa' },
          { key: 'Text primary',    val: '#e8e8f0' },
          { key: 'Text secondary',  val: '#9090a8' },
        ]},
        { title: 'Animation', rows: [
          { key: 'Entry',           val: 'fade + translateY(20px)' },
          { key: 'Duration',        val: '0.45s' },
          { key: 'Easing',          val: 'power2.out' },
          { key: 'Hover',           val: 'scale(1.02), shadow +' },
        ]},
      ],
    },
    html: `<div class="card">
  <div class="card__tag">Component</div>
  <h2 class="card__title">Card Title</h2>
  <p class="card__body">
    Supporting text goes here. Keep it concise and scannable.
  </p>
  <div class="card__footer">
    <button class="btn btn--primary">Primary Action</button>
    <button class="btn btn--ghost">Cancel</button>
  </div>
</div>`,
    css: `.card {
  width: 360px;
  padding: 24px;
  background: #18181c;
  border: 1px solid #2a2a32;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.3);
  transition: box-shadow 0.2s ease, transform 0.2s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}

.card__tag {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #7c6dfa;
  margin-bottom: 10px;
}

.card__title {
  font-size: 20px;
  font-weight: 700;
  color: #e8e8f0;
  margin-bottom: 8px;
}

.card__body {
  font-size: 14px;
  color: #9090a8;
  line-height: 1.6;
}

.card__footer {
  display: flex;
  gap: 8px;
  margin-top: 20px;
}

.btn {
  padding: 9px 18px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
}

.btn--primary { background: #7c6dfa; color: #fff; }
.btn--ghost   { background: transparent; color: #9090a8; border: 1px solid #2a2a32; }`,
    gsap: `import { gsap } from "gsap";

// Entry animation
gsap.from(".card", {
  duration: 0.45,
  opacity: 0,
  y: 20,
  ease: "power2.out",
});

// Hover micro-interaction (optional — CSS handles this via :hover)
// Uncomment if you need JS-driven hover for touch devices:
//
// const card = document.querySelector(".card");
// card.addEventListener("mouseenter", () =>
//   gsap.to(card, { duration: 0.2, y: -2, ease: "power1.out" })
// );
// card.addEventListener("mouseleave", () =>
//   gsap.to(card, { duration: 0.2, y: 0, ease: "power1.in" })
// );`,
    css_anim: `/* Card entry — pure CSS */
@keyframes cardIn {
  from { opacity: 0; transform: translateY(20px); }
  to   { opacity: 1; transform: translateY(0); }
}

.card {
  animation: cardIn 0.45s cubic-bezier(0.33, 1, 0.68, 1) both;
}`,
    framer: `import { motion } from "framer-motion";

export function Card({ children }) {
  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.33, 1, 0.68, 1] }}
      whileHover={{ y: -2, boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}
    >
      {children}
    </motion.div>
  );
}`,
  },

  modal: {
    specs: {
      groups: [
        { title: 'Layout', rows: [
          { key: 'Component',       val: 'Modal / Dialog' },
          { key: 'Max width',       val: '520px' },
          { key: 'Padding',         val: '32px' },
          { key: 'Border radius',   val: '16px' },
          { key: 'Backdrop',        val: 'rgba(0,0,0,0.6) blur(4px)' },
        ]},
        { title: 'Colors', rows: [
          { key: 'Background',      val: '#18181c' },
          { key: 'Border',          val: '#2a2a32' },
          { key: 'Backdrop',        val: 'rgba(0,0,0,0.6)' },
        ]},
        { title: 'Animation', rows: [
          { key: 'Backdrop entry',  val: 'fade 0.2s' },
          { key: 'Modal entry',     val: 'fade + scale(0.95→1) 0.3s' },
          { key: 'Easing',          val: 'back.out(1.4)' },
          { key: 'Exit',            val: 'reverse — scale(0.95) + fade' },
        ]},
      ],
    },
    html: `<!-- Trigger -->
<button class="btn btn--primary" id="openModal">Open Modal</button>

<!-- Modal -->
<div class="modal-backdrop" id="modalBackdrop" aria-hidden="true">
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <div class="modal__header">
      <h2 class="modal__title" id="modalTitle">Modal Title</h2>
      <button class="modal__close" id="closeModal" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <p class="modal__body">
      Modal content goes here. Be concise — modals interrupt the flow.
    </p>
    <div class="modal__footer">
      <button class="btn btn--ghost" id="cancelModal">Cancel</button>
      <button class="btn btn--primary">Confirm</button>
    </div>
  </div>
</div>`,
    css: `.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  opacity: 0;
  pointer-events: none;
}

.modal-backdrop.is-open {
  opacity: 1;
  pointer-events: all;
}

.modal {
  width: min(520px, calc(100vw - 32px));
  background: #18181c;
  border: 1px solid #2a2a32;
  border-radius: 16px;
  padding: 32px;
  transform: scale(0.95);
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.modal-backdrop.is-open .modal { transform: scale(1); }

.modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.modal__title { font-size: 18px; font-weight: 700; color: #e8e8f0; }

.modal__close {
  background: none;
  border: none;
  color: #9090a8;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
}
.modal__close:hover { color: #e8e8f0; background: #2a2a32; }

.modal__body { font-size: 14px; color: #9090a8; line-height: 1.6; }

.modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}`,
    gsap: `import { gsap } from "gsap";

const backdrop = document.getElementById("modalBackdrop");
const modal    = backdrop.querySelector(".modal");

function openModal() {
  backdrop.classList.add("is-open");
  gsap.fromTo(modal,
    { opacity: 0, scale: 0.92, y: 12 },
    { opacity: 1, scale: 1,    y: 0,
      duration: 0.35,
      ease: "back.out(1.4)" }
  );
}

function closeModal() {
  gsap.to(modal, {
    opacity: 0, scale: 0.94, y: 8,
    duration: 0.2,
    ease: "power2.in",
    onComplete: () => backdrop.classList.remove("is-open"),
  });
}

document.getElementById("openModal").addEventListener("click", openModal);
document.getElementById("closeModal").addEventListener("click", closeModal);
document.getElementById("cancelModal").addEventListener("click", closeModal);
backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });`,
    css_anim: `/* Modal entry — pure CSS */
@keyframes backdropIn {
  from { opacity: 0; }
  to   { opacity: 1; }
}
@keyframes modalIn {
  from { opacity: 0; transform: scale(0.92) translateY(12px); }
  to   { opacity: 1; transform: scale(1) translateY(0); }
}

.modal-backdrop.is-open {
  animation: backdropIn 0.2s ease both;
}
.modal-backdrop.is-open .modal {
  animation: modalIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}`,
    framer: `import { AnimatePresence, motion } from "framer-motion";

export function Modal({ isOpen, onClose }) {
  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            className="modal"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1,    y: 0  }}
            exit={{    opacity: 0, scale: 0.94, y: 8  }}
            transition={{ duration: 0.35, ease: [0.34, 1.56, 0.64, 1] }}
          >
            {/* modal content */}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}`,
  },

  button: {
    specs: {
      groups: [
        { title: 'Anatomy', rows: [
          { key: 'Component',       val: 'Button' },
          { key: 'Height',          val: '40px (default)' },
          { key: 'Padding',         val: '0 20px' },
          { key: 'Border radius',   val: '8px' },
          { key: 'Min width',       val: '96px' },
        ]},
        { title: 'States', rows: [
          { key: 'Default',         val: 'bg #7c6dfa' },
          { key: 'Hover',           val: 'bg #6b5ce7, translateY(-1px)' },
          { key: 'Active',          val: 'scale(0.97)' },
          { key: 'Disabled',        val: 'opacity 0.35, no-cursor' },
          { key: 'Loading',         val: 'spinner icon, cursor wait' },
        ]},
        { title: 'Animation', rows: [
          { key: 'Hover lift',      val: '0.15s ease' },
          { key: 'Click pulse',     val: 'scale ripple 0.3s' },
          { key: 'Focus ring',      val: '3px offset, accent color' },
        ]},
      ],
    },
    html: `<button class="btn btn--primary" id="demoBtn">
  <span class="btn__label">Click me</span>
</button>

<!-- States -->
<button class="btn btn--primary btn--loading">
  <svg class="btn__spinner" viewBox="0 0 24 24" width="16" height="16">
    <path d="M21 12a9 9 0 1 1-6.219-8.56" fill="none"
      stroke="currentColor" stroke-width="2"/>
  </svg>
  <span class="btn__label">Loading...</span>
</button>

<button class="btn btn--primary" disabled>
  <span class="btn__label">Disabled</span>
</button>`,
    css: `.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 40px;
  padding: 0 20px;
  min-width: 96px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  position: relative;
  overflow: hidden;
  transition: background 0.15s ease,
              transform 0.1s ease,
              box-shadow 0.15s ease;
}

.btn--primary {
  background: #7c6dfa;
  color: #fff;
}

.btn--primary:hover:not(:disabled) {
  background: #6b5ce7;
  transform: translateY(-1px);
  box-shadow: 0 4px 16px rgba(124, 109, 250, 0.4);
}

.btn--primary:active:not(:disabled) {
  transform: scale(0.97) translateY(0);
  box-shadow: none;
}

.btn:focus-visible {
  outline: 3px solid rgba(124, 109, 250, 0.6);
  outline-offset: 2px;
}

.btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.btn--loading {
  cursor: wait;
  pointer-events: none;
}

.btn__spinner {
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}

@keyframes spin { to { transform: rotate(360deg); } }`,
    gsap: `import { gsap } from "gsap";

const btn = document.getElementById("demoBtn");

// Click ripple / pulse
btn.addEventListener("click", (e) => {
  // Scale pulse
  gsap.fromTo(btn,
    { scale: 0.97 },
    { scale: 1, duration: 0.35, ease: "elastic.out(1, 0.5)" }
  );

  // Ripple effect
  const ripple = document.createElement("span");
  ripple.style.cssText = \`
    position: absolute;
    border-radius: 50%;
    background: rgba(255,255,255,0.25);
    width: 8px; height: 8px;
    left: \${e.offsetX - 4}px;
    top:  \${e.offsetY - 4}px;
    pointer-events: none;
  \`;
  btn.appendChild(ripple);

  gsap.to(ripple, {
    scale: 20, opacity: 0,
    duration: 0.5, ease: "power2.out",
    onComplete: () => ripple.remove(),
  });
});`,
    css_anim: `/* Button ripple — pure CSS (uses :active) */
.btn::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle, rgba(255,255,255,0.25) 1%, transparent 70%);
  opacity: 0;
  transform: scale(0);
  transition: transform 0.4s ease, opacity 0.4s ease;
}

.btn:active::after {
  transform: scale(2.5);
  opacity: 1;
  transition: 0s;
}`,
    framer: `import { motion } from "framer-motion";

export function Button({ children, onClick, disabled, loading }) {
  return (
    <motion.button
      className="btn btn--primary"
      onClick={onClick}
      disabled={disabled || loading}
      whileHover={{ y: -1, boxShadow: "0 4px 16px rgba(124,109,250,0.4)" }}
      whileTap={{ scale: 0.97 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
    >
      {loading && <Spinner />}
      {children}
    </motion.button>
  );
}`,
  },
};

// Fallback — reuse card mock for unrecognised component types
['navbar', 'slider', 'form', 'hero', 'tooltip', 'dropdown'].forEach(t => {
  MOCK_DATA[t] = MOCK_DATA.card;
});

// ── Refinement ────────────────────────────────

async function refineOutput({ previousResult, instruction, animLib, outputFormat }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Gemini API key not set — click "Add Gemini Key" in the header.');

  const animLibName = { gsap: 'GSAP', css: 'CSS animations', framer: 'Framer Motion' }[animLib] || 'GSAP';

  const prompt = `You are refining existing UI code. The user is happy with the previous output but wants specific small changes.

EXISTING CODE — use this as your base, do NOT rewrite from scratch:

HTML:
${previousResult.html || ''}

CSS:
${previousResult.css || ''}

JS:
${previousResult.js || ''}

REFINEMENT REQUEST: "${instruction}"

RULES — follow these exactly:
1. Make ONLY the changes the user explicitly asked for
2. Keep ALL animations, colors, sizes, layout exactly as they are unless the user said to change them
3. If user says "keep everything same" or "rest keep same" — they mean it literally
4. Do NOT remove any working animation or interaction
5. Do NOT change colors, fonts, or layout unless asked
6. Return the complete updated files (not just the changed parts)

Return ONLY a raw JSON object — same format as before:
{
  "component": "${previousResult.component || 'component'}",
  "specs": ${JSON.stringify(previousResult.specs || { groups: [] })},
  "html": "complete updated HTML file",
  "css": "updated CSS snippet",
  "js": "updated JS snippet"
}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      }),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${res.status}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty response from Gemini — try again.');

  const result = parseGeminiResponse(text);
  return { ...result, format: outputFormat, lib: animLib };
}

// ── Output rendering ──────────────────────────

function renderOutput(result) {
  // Save result for potential refinement
  state.lastResult = result;
  showRefineMode();

  outputLoading.hidden = true;
  outputEmpty.hidden   = true;
  outputContent.hidden = false;

  // Populate specs
  specsBlockEl.innerHTML = '';
  result.specs.groups.forEach(group => {
    const groupEl = document.createElement('div');
    groupEl.className = 'spec-group';

    const titleEl = document.createElement('div');
    titleEl.className = 'spec-group-title';
    titleEl.textContent = group.title;
    groupEl.appendChild(titleEl);

    group.rows.forEach(({ key, val }) => {
      const row = document.createElement('div');
      row.className = 'spec-row';
      row.innerHTML = `<span class="spec-key">${escHtml(key)}</span><span class="spec-val">${escHtml(val)}</span>`;
      groupEl.appendChild(row);
    });

    specsBlockEl.appendChild(groupEl);
  });

  // Populate code
  htmlCodeEl.textContent = result.html;
  cssCodeEl.textContent  = result.css;
  jsCodeEl.textContent   = result.js;

  // Update JS tab label
  const libLabel = { gsap: 'JS / GSAP', css: 'CSS Anim', framer: 'Framer Motion' };
  if (jsTabBtn) jsTabBtn.textContent = libLabel[result.lib] || 'JS';

  // Apply output format — show/hide tabs accordingly
  applyOutputFormat(result.format);

  // Show metadata strip
  renderMeta(result);

  // Fade the output panel in
  outputContent.style.opacity = '0';
  requestAnimationFrame(() => {
    outputContent.style.transition = 'opacity 0.3s ease';
    outputContent.style.opacity = '1';
  });
}

function applyOutputFormat(format) {
  const specsTab  = document.querySelector('[data-tab="specs"]');
  const codeGroup = document.getElementById('codeTabGroup');

  if (format === 'specs') {
    specsTab.hidden   = false;
    codeGroup.hidden  = true;
    switchTab('specs');
  } else if (format === 'code') {
    specsTab.hidden   = true;
    codeGroup.hidden  = false;
    switchTab('html');
  } else {
    specsTab.hidden   = false;
    codeGroup.hidden  = false;
    switchTab('specs');
  }
}

function renderMeta(result) {
  const metaEl = document.getElementById('outputMeta');
  if (!metaEl) return;
  const libBadge = { gsap: 'GSAP', css: 'CSS', framer: 'Framer' }[result.lib] || result.lib;
  metaEl.innerHTML = `
    <span class="meta-tag">${escHtml(result.component)}</span>
    <span class="meta-tag">${escHtml(libBadge)}</span>
    <button class="meta-reset" id="resetBtn">New analysis</button>
  `;
  document.getElementById('resetBtn').addEventListener('click', resetOutput);
}

function resetOutput() {
  state.lastResult = null;
  showFreshMode();

  outputContent.hidden = true;
  outputLoading.hidden = true;
  outputEmpty.hidden   = false;

  outputEmpty.querySelector('.empty-title').textContent = 'Output will appear here';
  outputEmpty.querySelector('.empty-sub').textContent   = 'Upload a design and describe what you need';

  document.querySelector('[data-tab="specs"]').hidden = false;
  document.getElementById('codeTabGroup').hidden = false;
}

// ── Tab switching ─────────────────────────────

outputTabs.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tabName) {
  outputTabs.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.toggle('active', p.id === `tab-${tabName}`);
  });
}

// ── Copy buttons ──────────────────────────────

document.querySelectorAll('.copy-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = document.getElementById(btn.dataset.target);
    if (!target) return;
    navigator.clipboard.writeText(target.textContent).then(() => {
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 2000);
    });
  });
});

// ── Suggestions ──────────────────────────────

const getSuggestionsBtn  = document.getElementById('getSuggestionsBtn');
const suggestionsEmpty   = document.getElementById('suggestionsEmpty');
const suggestionsLoading = document.getElementById('suggestionsLoading');
const suggestionsList    = document.getElementById('suggestionsList');

// What to look for as "missing" in the instruction
const MISSING_CHECKS = [
  {
    check: (t) => !/(click|hover|scroll|load|appear|entry|exit|pe|trigger)/i.test(t),
    title: 'Trigger not specified',
    body:  'When does it animate? On page load, scroll into view, click, or hover? This changes the implementation significantly.',
  },
  {
    check: (t) => !/(0\.\d+s|\ds|\d+ms|duration|time|second|kitna)/i.test(t),
    title: 'Duration missing',
    body:  '0.2s feels snappy, 0.3–0.4s is smooth and modern, 0.6s+ is slow and dramatic. Pick one.',
  },
  {
    check: (t) => !/(ease|spring|bounce|linear|smooth|natural)/i.test(t),
    title: 'Easing not mentioned',
    body:  'ease-out for entrances, ease-in-out for loops, spring/bounce for playful feel. Affects the whole character of the animation.',
  },
  {
    check: (t) => !/(color|colour|bg|background|dark|light|theme)/i.test(t),
    title: 'Color scheme unclear',
    body:  'Specify dark or light theme, or a hex color. Without this the output will use a generic palette.',
  },
  {
    check: (t) => !/(mobile|desktop|responsive|screen|device)/i.test(t),
    title: 'Target device not specified',
    body:  'Desktop or mobile? Mobile needs touch events instead of mouse events, and 44px minimum touch targets.',
  },
];

// Best practice tips per component type
const BEST_PRACTICE_TIPS = {
  button: [
    { title: '44px height standard',      body: 'Button height 40–48px rakho. 44px touch-friendly hai — mobile pe bhi comfortable hoti hai.' },
    { title: 'Hover lift effect',          body: 'translateY(-2px) + box-shadow on hover — subtle aur polished lagta hai, 0.15s ease.' },
    { title: 'Active/press state',         body: 'Click pe scale(0.97) natural press feel deta hai. 80–100ms kaafi hai.' },
    { title: 'Focus ring accessibility',   body: '3px focus ring zaroor rakho — outline: 3px solid accent, offset: 2px. Keyboard users ke liye must.' },
  ],
  modal: [
    { title: 'Entry: scale + fade',        body: 'scale(0.95 → 1) + opacity(0 → 1) — 0.3s, ease-out. Yeh most polished modal entry hai.' },
    { title: 'Backdrop blur',              body: 'backdrop-filter: blur(6px) + rgba(0,0,0,0.6) — professional depth deta hai.' },
    { title: 'Modal width',                body: 'Desktop pe 480–560px ideal hai. Min padding 24–32px andar.' },
    { title: 'Escape key close',           body: 'Escape key aur backdrop click se close hona chahiye — UX expectation hai.' },
  ],
  card: [
    { title: 'Hover lift',                 body: 'translateY(-4px) + enhanced shadow on hover — 0.2s ease. Subtle aur effective.' },
    { title: 'Border radius',              body: '12–16px modern cards ke liye standard hai. 8px traditional, 20px+ very rounded.' },
    { title: 'Card padding',               body: '20–24px andar padding comfortable reading space deta hai.' },
    { title: 'Entry animation',            body: 'translateY(20px → 0) + opacity(0 → 1), 0.4s ease-out. Stagger karo agar multiple cards hain.' },
  ],
  default: [
    { title: '0.3s sweet spot',            body: 'Animation duration 0.2s–0.4s most natural lagti hai. 0.3s safe bet hai almost sabke liye.' },
    { title: 'Ease-out for entries',       body: 'Ease-out entry ke liye best — fast start, smooth stop. Ease-in exit ke liye.' },
    { title: '44px touch target',          body: 'Mobile pe koi bhi tappable element 44×44px minimum hona chahiye — Apple HIG standard.' },
    { title: 'Less is more',               body: 'Ek element pe ek animation kaafi hai. Multiple animations ek saath chaotic lagte hain.' },
    { title: 'Reduce motion',              body: '@media (prefers-reduced-motion) zaroor add karo — accessibility best practice hai.' },
  ],
};

getSuggestionsBtn.addEventListener('click', handleGetSuggestions);

async function handleGetSuggestions() {
  const instruction = instructionEl.value.trim();

  if (!instruction) {
    suggestionsEmpty.hidden   = false;
    suggestionsList.hidden    = true;
    suggestionsLoading.hidden = true;
    suggestionsEmpty.querySelector('p').innerHTML =
      'Write something in the instruction box first, then click Get Suggestions.';
    return;
  }

  // Show loading
  suggestionsEmpty.hidden    = true;
  suggestionsList.hidden     = true;
  suggestionsLoading.hidden  = false;
  getSuggestionsBtn.disabled = true;

  try {
    const apiKey = getApiKey();

    // If no API key — fall back to keyword-based suggestions
    if (!apiKey) {
      const component = detectComponent(instruction);
      const items = buildSuggestions(instruction, component);
      renderSuggestions(items);
      return;
    }

    const prompt = `You are a senior front-end developer helping someone get better AI-generated code. They describe what they want — you spot how it could be misread and give them a precise rewrite.

The user may write in Hinglish. Always respond in ENGLISH ONLY.

USER'S BRIEF: "${instruction}"

Step 1: Read the brief and identify:
- What the user ACTUALLY wants (their real intent)
- How an AI might MISREAD it and generate the wrong thing
- What technical pattern this really is

Step 2: Return ONLY a raw JSON array — no markdown, no extra text:
[
  {
    "type": "identify",
    "icon": "🚨",
    "title": "Misread risk: [what AI might wrongly generate in 4-6 words]",
    "body": "Your instruction '[quote the ambiguous part]' might generate [wrong thing] — but you want [correct thing]. These are different: [one sentence explanation of the difference]."
  },
  {
    "type": "tip",
    "icon": "✏️",
    "title": "Use this instead",
    "body": "[Complete rewritten instruction with exact technical terms. Include: what it is, how it moves, what triggers it, timing, colors if relevant, device target. Write it so you can copy-paste directly into the instruction box.]"
  },
  {
    "type": "tip",
    "icon": "💡",
    "title": "[One specific technical thing to know about this pattern]",
    "body": "[One concrete implementation detail the user should be aware of — e.g. 'For scroll-pan canvas: wheel event updates a targetX variable, GSAP lerps the canvas container to targetX — NOT CSS scroll-behavior which only works on scrollable containers']"
  }
]

Rules:
- English only — no Hindi, no Hinglish
- The "Use this instead" body must be a complete, ready-to-paste instruction
- Be specific to THIS exact brief — no generic advice
- If the brief is already clear and precise, say so in the identify card and still give a slightly improved version`;

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.5, responseMimeType: 'application/json' },
        }),
      }
    );

    if (!res.ok) throw new Error(`API error ${res.status}`);

    const data  = await res.json();
    const text  = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response');

    let items;
    try {
      const parsed = parseGeminiResponse(text);
      items = Array.isArray(parsed) ? parsed : parsed.suggestions || [];
    } catch (_) {
      // fallback to keyword suggestions if parse fails
      items = buildSuggestions(instruction, detectComponent(instruction));
    }

    renderSuggestions(items);

  } catch (err) {
    console.error('Suggestions failed:', err);
    // Graceful fallback
    renderSuggestions(buildSuggestions(instruction, detectComponent(instruction)));
  } finally {
    suggestionsLoading.hidden  = true;
    getSuggestionsBtn.disabled = false;
  }
}

function buildSuggestions(instruction, component) {
  const result = [];

  // Type 1 — missing info (only if instruction has some text)
  if (instruction.length > 0) {
    MISSING_CHECKS.forEach(({ check, title, body }) => {
      if (check(instruction)) {
        result.push({ type: 'missing', icon: '💬', title, body });
      }
    });
  }

  // Type 2 — best practice tips for this component
  const tips = BEST_PRACTICE_TIPS[component] || BEST_PRACTICE_TIPS.default;
  tips.forEach(({ title, body }) => {
    result.push({ type: 'tip', icon: '💡', title, body });
  });

  return result;
}

function renderSuggestions(items) {
  suggestionsList.innerHTML = '';

  if (!items.length) {
    suggestionsEmpty.hidden = false;
    suggestionsList.hidden  = true;
    return;
  }

  items.forEach(({ type, icon, title, body }) => {
    const item = document.createElement('div');
    item.className = `suggestion-item type-${type}`;
    item.innerHTML = `
      <span class="suggestion-icon">${icon}</span>
      <div class="suggestion-text">
        <strong>${escHtml(title)}</strong>
        ${escHtml(body)}
      </div>
    `;
    suggestionsList.appendChild(item);
  });

  suggestionsList.hidden = false;
}

// ── Utility ───────────────────────────────────

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
