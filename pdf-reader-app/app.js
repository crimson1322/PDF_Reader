/* ============================================
   AI PDF READER — app.js (FIXED PAGE SEPARATION)
   ============================================ */
'use strict';

// ===== PDF.js Worker =====
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* ============================================
   STATE
   ============================================ */
const state = {
  pdfDoc:        null,
  currentPage:   1,
  totalPages:    0,
  scale:         1.0,
  fileName:      '',
  textContent:   {},
  bookmarks:     [],
  notes:         [],
  searchResults: [],
  searchIndex:   0,
  isSpeaking:    false,
  isPaused:      false,
  speechQueue:   [],
  renderQueue:   Promise.resolve(), // ← prevents overlapping renders
  voiceSettings: {
    voice:  null,
    rate:   1.0,
    pitch:  1.0,
    volume: 1.0
  }
};

/* ============================================
   DOM REFERENCES
   ============================================ */
const $ = id => document.getElementById(id);

const dom = {
  splash:           $('splash'),
  app:              $('app'),
  menuBtn:          $('menuBtn'),
  docTitle:         $('docTitle'),
  searchBtn:        $('searchBtn'),
  bookmarkBtn:      $('bookmarkBtn'),
  exportBtn:        $('exportBtn'),
  searchBar:        $('searchBar'),
  searchInput:      $('searchInput'),
  searchPrev:       $('searchPrev'),
  searchNext:       $('searchNext'),
  searchClose:      $('searchClose'),
  searchCount:      $('searchCount'),
  sidebar:          $('sidebar'),
  closeSidebar:     $('closeSidebar'),
  tocList:          $('tocList'),
  bookmarkList:     $('bookmarkList'),
  thumbnailList:    $('thumbnailList'),
  uploadZone:       $('uploadZone'),
  uploadCard:       document.querySelector('.upload-card'),
  fileInput:        $('fileInput'),
  pdfContainer:     $('pdfContainer'),
  pdfViewer:        $('pdfViewer'),
  bottomBar:        $('bottomBar'),
  prevPage:         $('prevPage'),
  nextPage:         $('nextPage'),
  currentPageInput: $('currentPageInput'),
  totalPages:       $('totalPages'),
  zoomOut:          $('zoomOut'),
  zoomIn:           $('zoomIn'),
  zoomLevel:        $('zoomLevel'),
  fitPage:          $('fitPage'),
  playBtn:          $('playBtn'),
  pauseBtn:         $('pauseBtn'),
  stopBtn:          $('stopBtn'),
  readPageBtn:      $('readPageBtn'),
  voiceList:        $('voiceList'),
  speedRange:       $('speedRange'),
  pitchRange:       $('pitchRange'),
  volumeRange:      $('volumeRange'),
  speedVal:         $('speedVal'),
  pitchVal:         $('pitchVal'),
  volumeVal:        $('volumeVal'),
  testVoice:        $('testVoice'),
  exportNotesPdf:   $('exportNotesPdf'),
  exportTextPdf:    $('exportTextPdf'),
  exportSummaryPdf: $('exportSummaryPdf'),
  notesInput:       $('notesInput'),
  notePageLabel:    $('notePageLabel'),
  saveNote:         $('saveNote'),
  clearNote:        $('clearNote'),
  fab:              $('fab'),
  progressWrap:     $('progressWrap'),
  progressFill:     $('progressFill'),
  progressLabel:    $('progressLabel'),
  toastMsg:         $('toastMsg'),
};

// Bootstrap Modal instance
const exportModalBS = new bootstrap.Modal($('exportModal'));
let toastBS = null;

/* ============================================
   SPLASH
   ============================================ */
setTimeout(() => {
  dom.splash.style.animation = 'fadeOut 0.5s ease forwards';
  setTimeout(() => {
    dom.splash.style.display = 'none';
    dom.app.classList.remove('d-none');
  }, 500);
}, 2200);

/* ============================================
   TOAST
   ============================================ */
function showToast(msg) {
  dom.toastMsg.textContent = msg;
  const el = $('appToast');
  if (!toastBS) toastBS = new bootstrap.Toast(el);
  toastBS.show();
}

/* ============================================
   PROGRESS BAR
   ============================================ */
function showProgress(text) {
  dom.progressWrap.classList.remove('d-none');
  dom.progressFill.style.width = '0%';
  dom.progressLabel.textContent = text || 'Loading...';
}

function updateProgress(pct, text) {
  dom.progressFill.style.width = pct + '%';
  if (text) dom.progressLabel.textContent = text;
}

function hideProgress() {
  updateProgress(100);
  setTimeout(() => dom.progressWrap.classList.add('d-none'), 400);
}

/* ============================================
   FILE INPUT & DRAG DROP
   ============================================ */
dom.fileInput.addEventListener('change', e => {
  if (e.target.files[0]) loadPDF(e.target.files[0]);
});

dom.uploadCard.addEventListener('dragover', e => {
  e.preventDefault();
  dom.uploadCard.classList.add('drag-over');
});

dom.uploadCard.addEventListener('dragleave', () => {
  dom.uploadCard.classList.remove('drag-over');
});

dom.uploadCard.addEventListener('drop', e => {
  e.preventDefault();
  dom.uploadCard.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file?.type === 'application/pdf') {
    loadPDF(file);
  } else {
    showToast('⚠️ Please drop a valid PDF file');
  }
});

/* ============================================
   LOAD PDF
   ============================================ */
async function loadPDF(file) {
  try {
    showProgress('Loading PDF...');

    state.fileName    = file.name.replace(/\.pdf$/i, '');
    dom.docTitle.textContent = state.fileName;

    const buffer      = await file.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: buffer });

    loadingTask.onProgress = d => {
      if (d.total) {
        updateProgress(
          Math.round((d.loaded / d.total) * 50),
          'Loading PDF...'
        );
      }
    };

    state.pdfDoc      = await loadingTask.promise;
    state.totalPages  = state.pdfDoc.numPages;
    state.currentPage = 1;
    state.textContent = {};

    // Reset UI counters
    dom.totalPages.textContent    = state.totalPages;
    dom.currentPageInput.max      = state.totalPages;
    dom.currentPageInput.value    = 1;
    dom.notePageLabel.textContent = 'Page 1';

    // Show viewer panels
    dom.uploadZone.classList.add('d-none');
    dom.pdfContainer.classList.remove('d-none');
    dom.bottomBar.classList.remove('d-none');

    updateProgress(55, 'Building page layout...');

    // ── IMPORTANT: build empty page slots first ──
    buildPageSlots();

    updateProgress(65, 'Rendering pages...');

    // ── Then render each page into its slot ──
    await renderAllPages();

    updateProgress(88, 'Loading outline...');
    await loadOutline();

    updateProgress(94, 'Generating thumbnails...');
    await generateThumbnails();

    hideProgress();
    showToast('✅ PDF loaded — ' + state.totalPages + ' pages');

    // Pre-cache text for page 1
    extractPageText(1);

  } catch (err) {
    hideProgress();
    showToast('❌ Failed to load: ' + err.message);
    console.error(err);
  }
}

/* ============================================
   BUILD PAGE SLOTS
   Creates one wrapper + canvas per page FIRST
   so pages never overlap
   ============================================ */
function buildPageSlots() {
  // Clear any previous content
  dom.pdfViewer.innerHTML = '';

  for (let i = 1; i <= state.totalPages; i++) {

    /* ── Outer page wrapper ── */
    const wrapper        = document.createElement('div');
    wrapper.className    = 'page-wrapper';
    wrapper.id           = `page-wrapper-${i}`;
    wrapper.dataset.page = i;

    if (i === 1) wrapper.classList.add('active-page');

    /* ── Page header label ── */
    const header           = document.createElement('div');
    header.className       = 'page-header-label';
    header.textContent     = `Page ${i} of ${state.totalPages}`;

    /* ── Canvas (will be sized when rendered) ── */
    const canvas           = document.createElement('canvas');
    canvas.id              = `pdf-canvas-${i}`;
    canvas.className       = 'pdf-page-canvas';

    /* ── Loading placeholder ── */
    const placeholder      = document.createElement('div');
    placeholder.className  = 'page-placeholder';
    placeholder.id         = `placeholder-${i}`;
    placeholder.innerHTML  = `
      <div class="placeholder-inner">
        <div class="spinner-border spinner-border-sm text-secondary"
             role="status"></div>
        <span class="ms-2 text-secondary" style="font-size:13px;">
          Loading page ${i}...
        </span>
      </div>`;

    /* ── Page footer badge ── */
    const footer           = document.createElement('div');
    footer.className       = 'page-footer-badge';
    footer.textContent     = `${i} / ${state.totalPages}`;

    /* ── Separator line between pages ── */
    const separator        = document.createElement('div');
    separator.className    = 'page-separator';

    wrapper.appendChild(header);
    wrapper.appendChild(placeholder);
    wrapper.appendChild(canvas);
    wrapper.appendChild(footer);
    dom.pdfViewer.appendChild(wrapper);
    dom.pdfViewer.appendChild(separator);

    // Click to set as active page
    wrapper.addEventListener('click', () => {
      setActivePage(i);
    });
  }

  // Start scroll observer after slots exist
  setupScrollObserver();
}

/* ============================================
   RENDER ALL PAGES
   Renders each page canvas one by one
   ============================================ */
async function renderAllPages() {
  const containerWidth = dom.pdfContainer.clientWidth - 40;

  for (let i = 1; i <= state.totalPages; i++) {
    await renderSinglePage(i, containerWidth);

    updateProgress(
      65 + Math.round((i / state.totalPages) * 22),
      `Rendering page ${i} of ${state.totalPages}...`
    );
  }
}

/* ============================================
   RENDER SINGLE PAGE
   ============================================ */
async function renderSinglePage(pageNum, containerWidth) {
  try {
    const page     = await state.pdfDoc.getPage(pageNum);
    const baseVP   = page.getViewport({ scale: 1 });

    // Calculate scale to fit container width
    const scale    = Math.min(
      (containerWidth || dom.pdfContainer.clientWidth - 40) / baseVP.width,
      2.0
    );

    // Only update global scale based on page 1
    if (pageNum === 1) state.scale = scale;

    const viewport = page.getViewport({ scale });

    const canvas   = $(`pdf-canvas-${pageNum}`);
    const ph       = $(`placeholder-${pageNum}`);

    if (!canvas) return;

    // Set exact canvas dimensions
    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width  = canvas.width  + 'px';
    canvas.style.height = canvas.height + 'px';
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');

    // Clear before rendering
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Render the PDF page onto the canvas
    const renderTask = page.render({
      canvasContext: ctx,
      viewport:      viewport
    });

    await renderTask.promise;

    // Hide placeholder once rendered
    if (ph) ph.style.display = 'none';

  } catch (err) {
    console.error(`Error rendering page ${pageNum}:`, err);
  }
}

/* ============================================
   SCROLL OBSERVER
   Auto-detects which page is visible
   ============================================ */
function setupScrollObserver() {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.3) {
        const pg = parseInt(entry.target.dataset.page);
        if (pg && pg !== state.currentPage) {
          setActivePage(pg, false); // false = don't scroll (already visible)
        }
      }
    });
  }, {
    root:       dom.pdfContainer,
    rootMargin: '0px',
    threshold:  [0.3, 0.5, 0.8]
  });

  document.querySelectorAll('.page-wrapper').forEach(w => {
    observer.observe(w);
  });
}

/* ============================================
   SET ACTIVE PAGE
   ============================================ */
function setActivePage(pg, scroll = true) {
  if (!state.pdfDoc) return;
  pg = Math.max(1, Math.min(state.totalPages, pg));

  state.currentPage             = pg;
  dom.currentPageInput.value    = pg;
  dom.notePageLabel.textContent = `Page ${pg}`;

  // Update prev/next buttons
  dom.prevPage.disabled = pg <= 1;
  dom.nextPage.disabled = pg >= state.totalPages;

  // Update active page highlight
  document.querySelectorAll('.page-wrapper').forEach(w => {
    w.classList.toggle(
      'active-page',
      parseInt(w.dataset.page) === pg
    );
  });

  // Scroll to page
  if (scroll) {
    const wrapper = $(`page-wrapper-${pg}`);
    if (wrapper) {
      wrapper.scrollIntoView({
        behavior: 'smooth',
        block:    'start'
      });
    }
  }

  // Sync thumbnails
  syncThumbnails(pg);

  // Pre-cache text
  extractPageText(pg);
}

function syncThumbnails(pg) {
  document.querySelectorAll('.thumbnail-item').forEach(t => {
    t.classList.toggle('active', parseInt(t.dataset.page) === pg);
  });
}

/* ============================================
   PAGE NAVIGATION
   ============================================ */
dom.prevPage.addEventListener('click', () =>
  setActivePage(state.currentPage - 1));

dom.nextPage.addEventListener('click', () =>
  setActivePage(state.currentPage + 1));

dom.currentPageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const v = parseInt(dom.currentPageInput.value);
    if (!isNaN(v)) setActivePage(v);
  }
});

dom.currentPageInput.addEventListener('change', () => {
  const v = parseInt(dom.currentPageInput.value);
  if (!isNaN(v)) setActivePage(v);
});

/* ============================================
   ZOOM
   ============================================ */
async function setZoom(newScale) {
  if (!state.pdfDoc) return;

  newScale = Math.max(0.4, Math.min(3.0, newScale));
  state.scale = newScale;
  dom.zoomLevel.textContent = Math.round(newScale * 100) + '%';

  showProgress('Re-rendering at ' + Math.round(newScale * 100) + '%...');

  const containerWidth = dom.pdfContainer.clientWidth - 40;

  for (let i = 1; i <= state.totalPages; i++) {
    const page     = await state.pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: newScale });

    const canvas   = $(`pdf-canvas-${i}`);
    if (!canvas) continue;

    canvas.width  = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width  = canvas.width  + 'px';
    canvas.style.height = canvas.height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    await page.render({ canvasContext: ctx, viewport }).promise;

    updateProgress(
      Math.round((i / state.totalPages) * 100),
      `Re-rendering page ${i} of ${state.totalPages}...`
    );
  }

  hideProgress();
  showToast(`🔍 Zoom: ${Math.round(newScale * 100)}%`);
}

dom.zoomIn.addEventListener('click', () =>
  setZoom(state.scale + 0.25));

dom.zoomOut.addEventListener('click', () =>
  setZoom(state.scale - 0.25));

dom.fitPage.addEventListener('click', async () => {
  if (!state.pdfDoc) return;
  const page  = await state.pdfDoc.getPage(state.currentPage);
  const vp    = page.getViewport({ scale: 1 });
  const scale = (dom.pdfContainer.clientWidth - 40) / vp.width;
  setZoom(parseFloat(scale.toFixed(2)));
});

/* ============================================
   WINDOW RESIZE — re-render at new width
   ============================================ */
let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    if (!state.pdfDoc) return;
    const containerWidth = dom.pdfContainer.clientWidth - 40;
    const page  = await state.pdfDoc.getPage(1);
    const baseVP = page.getViewport({ scale: 1 });
    const newScale = Math.min(containerWidth / baseVP.width, 2.0);
    state.scale = newScale;
    dom.zoomLevel.textContent = Math.round(newScale * 100) + '%';
    await renderAllPages();
  }, 300);
});

/* ============================================
   EXTRACT TEXT
   ============================================ */
async function extractPageText(pg) {
  if (state.textContent[pg]) return state.textContent[pg];
  try {
    const page    = await state.pdfDoc.getPage(pg);
    const content = await page.getTextContent();
    const text    = content.items
      .map(item => item.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    state.textContent[pg] = text;
    return text;
  } catch {
    return '';
  }
}

/* ============================================
   OUTLINE / TABLE OF CONTENTS
   ============================================ */
async function loadOutline() {
  try {
    const outline = await state.pdfDoc.getOutline();
    if (!outline?.length) {
      dom.tocList.innerHTML = `
        <div class="empty-state">
          <i class="bi bi-journal-x"></i>
          No outline available
        </div>`;
      return;
    }
    dom.tocList.innerHTML = '';
    renderOutlineItems(outline, dom.tocList, 0);
  } catch {
    dom.tocList.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-exclamation-circle"></i>
        Could not load outline
      </div>`;
  }
}

function renderOutlineItems(items, container, depth) {
  items.forEach(item => {
    const a       = document.createElement('a');
    a.href        = '#';
    a.textContent = item.title || 'Untitled';
    a.style.paddingLeft = (12 + depth * 16) + 'px';

    a.addEventListener('click', async e => {
      e.preventDefault();
      if (!item.dest) return;
      try {
        const dest  = typeof item.dest === 'string'
          ? await state.pdfDoc.getDestination(item.dest)
          : item.dest;
        if (dest) {
          const pgIdx = await state.pdfDoc.getPageIndex(dest[0]);
          setActivePage(pgIdx + 1);
          closeSidebarMobile();
        }
      } catch {}
    });

    container.appendChild(a);

    if (item.items?.length) {
      renderOutlineItems(item.items, container, depth + 1);
    }
  });
}

/* ============================================
   THUMBNAILS
   ============================================ */
async function generateThumbnails() {
  dom.thumbnailList.innerHTML = '';
  const limit      = Math.min(state.totalPages, 100);
  const thumbScale = 0.12;

  for (let i = 1; i <= limit; i++) {
    const page     = await state.pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: thumbScale });

    const item           = document.createElement('div');
    item.className       = 'thumbnail-item' + (i === 1 ? ' active' : '');
    item.dataset.page    = i;
    item.title           = `Go to page ${i}`;

    const canvas         = document.createElement('canvas');
    canvas.width         = viewport.width;
    canvas.height        = viewport.height;
    canvas.style.width   = '100%';
    canvas.style.height  = 'auto';
    canvas.style.display = 'block';

    const label          = document.createElement('div');
    label.className      = 'thumbnail-label';
    label.textContent    = `Page ${i}`;

    item.appendChild(canvas);
    item.appendChild(label);
    dom.thumbnailList.appendChild(item);

    // Render thumbnail async (non-blocking)
    page.render({ canvasContext: canvas.getContext('2d'), viewport });

    item.addEventListener('click', () => {
      setActivePage(i);
      syncThumbnails(i);
      closeSidebarMobile();
    });
  }
}

/* ============================================
   SIDEBAR
   ============================================ */
dom.menuBtn.addEventListener('click', () => {
  const isOpen = dom.sidebar.classList.contains('open');
  if (isOpen) {
    dom.sidebar.classList.remove('open');
    setTimeout(() => dom.sidebar.classList.add('d-none'), 300);
  } else {
    dom.sidebar.classList.remove('d-none');
    requestAnimationFrame(() => dom.sidebar.classList.add('open'));
  }
});

dom.closeSidebar.addEventListener('click', () => {
  dom.sidebar.classList.remove('open');
  setTimeout(() => dom.sidebar.classList.add('d-none'), 300);
});

function closeSidebarMobile() {
  if (window.innerWidth < 768) {
    dom.sidebar.classList.remove('open');
    setTimeout(() => dom.sidebar.classList.add('d-none'), 300);
  }
}

// Sidebar Tab Switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn')
      .forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    ['toc', 'bookmarks', 'thumbnails'].forEach(name => {
      const panel = $(name + 'Panel');
      panel.classList.toggle('d-none', name !== btn.dataset.tab);
    });
  });
});

/* ============================================
   SEARCH
   ============================================ */
dom.searchBtn.addEventListener('click', () => {
  dom.searchBar.classList.toggle('d-none');
  if (!dom.searchBar.classList.contains('d-none')) {
    dom.searchInput.focus();
  }
});

dom.searchClose.addEventListener('click', () => {
  dom.searchBar.classList.add('d-none');
  dom.searchInput.value       = '';
  dom.searchCount.textContent = '';
  state.searchResults         = [];
  state.searchIndex           = 0;
});

dom.searchInput.addEventListener('input', debounce(() => {
  performSearch(dom.searchInput.value.trim());
}, 400));

dom.searchNext.addEventListener('click', () => {
  if (!state.searchResults.length) return;
  state.searchIndex =
    (state.searchIndex + 1) % state.searchResults.length;
  jumpToSearch(state.searchIndex);
});

dom.searchPrev.addEventListener('click', () => {
  if (!state.searchResults.length) return;
  state.searchIndex =
    (state.searchIndex - 1 + state.searchResults.length)
    % state.searchResults.length;
  jumpToSearch(state.searchIndex);
});

async function performSearch(query) {
  state.searchResults = [];
  state.searchIndex   = 0;

  if (!query || !state.pdfDoc) {
    dom.searchCount.textContent = '';
    return;
  }

  const q = query.toLowerCase();

  for (let i = 1; i <= state.totalPages; i++) {
    const text = await extractPageText(i);
    if (text.toLowerCase().includes(q)) {
      state.searchResults.push(i);
    }
  }

  if (state.searchResults.length) {
    dom.searchCount.textContent =
      `${state.searchResults.length} page(s)`;
    jumpToSearch(0);
  } else {
    dom.searchCount.textContent = 'Not found';
  }
}

function jumpToSearch(idx) {
  const pg = state.searchResults[idx];
  if (!pg) return;
  setActivePage(pg);
  dom.searchCount.textContent =
    `${idx + 1} / ${state.searchResults.length} page(s)`;
}

/* ============================================
   BOOKMARKS
   ============================================ */
dom.bookmarkBtn.addEventListener('click', () => {
  if (!state.pdfDoc) {
    showToast('⚠️ Open a PDF first');
    return;
  }
  addBookmark(state.currentPage);
});

function addBookmark(pg) {
  if (state.bookmarks.find(b => b.page === pg)) {
    showToast('📌 Page already bookmarked');
    return;
  }
  state.bookmarks.push({
    page:      pg,
    label:     `Page ${pg}`,
    timestamp: new Date().toLocaleString()
  });
  saveLocal();
  renderBookmarks();
  showToast(`🔖 Page ${pg} bookmarked!`);
}

function renderBookmarks() {
  if (!state.bookmarks.length) {
    dom.bookmarkList.innerHTML = `
      <div class="empty-state">
        <i class="bi bi-bookmark"></i>
        No bookmarks yet
      </div>`;
    return;
  }

  dom.bookmarkList.innerHTML = '';

  state.bookmarks.forEach((bk, idx) => {
    const div     = document.createElement('div');
    div.className = 'bookmark-item';
    div.innerHTML = `
      <i class="bi bi-bookmark-fill text-primary"></i>
      <span class="bk-page">P.${bk.page}</span>
      <span class="bk-label">
        ${bk.label}
        <br>
        <small class="text-secondary" style="font-size:11px;">
          ${bk.timestamp}
        </small>
      </span>
      <button class="btn btn-sm bk-del"
              title="Remove bookmark"
              data-idx="${idx}">
        <i class="bi bi-trash"></i>
      </button>`;

    div.addEventListener('click', e => {
      if (!e.target.closest('.bk-del')) {
        setActivePage(bk.page);
        closeSidebarMobile();
      }
    });

    div.querySelector('.bk-del').addEventListener('click', e => {
      e.stopPropagation();
      state.bookmarks.splice(idx, 1);
      saveLocal();
      renderBookmarks();
      showToast('🗑️ Bookmark removed');
    });

    dom.bookmarkList.appendChild(div);
  });
}

/* ============================================
   SPEECH — Web Speech API (FREE)
   ============================================ */
let voices = [];

function loadVoices() {
  voices = window.speechSynthesis.getVoices();
  dom.voiceList.innerHTML = '';

  if (!voices.length) {
    dom.voiceList.innerHTML = '<option>Default Voice</option>';
    return;
  }

  voices.forEach((v, i) => {
    const opt       = document.createElement('option');
    opt.value       = i;
    opt.textContent = `${v.name} (${v.lang})`;
    if (v.default) opt.selected = true;
    dom.voiceList.appendChild(opt);
  });

  // Auto-select local English voice
  const enIdx = voices.findIndex(
    v => v.lang.startsWith('en') && v.localService
  );
  if (enIdx !== -1) {
    dom.voiceList.value       = enIdx;
    state.voiceSettings.voice = voices[enIdx];
  }
}

window.speechSynthesis.onvoiceschanged = loadVoices;
loadVoices();

dom.voiceList.addEventListener('change', () => {
  const idx = parseInt(dom.voiceList.value);
  state.voiceSettings.voice = voices[idx] || null;
});

dom.speedRange.addEventListener('input', () => {
  state.voiceSettings.rate = parseFloat(dom.speedRange.value);
  dom.speedVal.textContent = state.voiceSettings.rate.toFixed(1) + 'x';
});

dom.pitchRange.addEventListener('input', () => {
  state.voiceSettings.pitch = parseFloat(dom.pitchRange.value);
  dom.pitchVal.textContent  = state.voiceSettings.pitch.toFixed(1);
});

dom.volumeRange.addEventListener('input', () => {
  state.voiceSettings.volume = parseFloat(dom.volumeRange.value);
  dom.volumeVal.textContent  =
    Math.round(state.voiceSettings.volume * 100) + '%';
});

dom.testVoice.addEventListener('click', () => {
  stopSpeech();
  const u = new SpeechSynthesisUtterance(
    'Hello! This is a test of the AI PDF Reader voice. Page separation is now working correctly.'
  );
  applyVoiceSettings(u);
  window.speechSynthesis.speak(u);
});

function applyVoiceSettings(u) {
  if (state.voiceSettings.voice) u.voice = state.voiceSettings.voice;
  u.rate   = state.voiceSettings.rate;
  u.pitch  = state.voiceSettings.pitch;
  u.volume = state.voiceSettings.volume;
}

/* ---- Play Button ---- */
dom.playBtn.addEventListener('click', async () => {
  if (!state.pdfDoc) {
    showToast('⚠️ Please open a PDF first');
    return;
  }
  if (state.isSpeaking && !state.isPaused) {
    pauseSpeech(); return;
  }
  if (state.isPaused) {
    resumeSpeech(); return;
  }
  await readFromPage(state.currentPage);
});

/* ---- Read Current Page Only ---- */
dom.readPageBtn.addEventListener('click', async () => {
  if (!state.pdfDoc) {
    showToast('⚠️ Please open a PDF first');
    return;
  }
  stopSpeech();
  const text = await extractPageText(state.currentPage);
  if (!text?.trim()) {
    showToast('⚠️ No readable text on this page');
    return;
  }
  speakText(text, `📄 Reading page ${state.currentPage}...`);
});

/* ---- Read from page to end ---- */
async function readFromPage(startPage) {
  stopSpeech();
  state.speechQueue = [];
  showToast(`🎤 Reading from page ${startPage}...`);

  for (let i = startPage; i <= state.totalPages; i++) {
    const text = await extractPageText(i);
    if (text?.trim()) {
      state.speechQueue.push({ page: i, text });
    }
  }

  if (!state.speechQueue.length) {
    showToast('⚠️ No readable text found');
    return;
  }
  processQueue();
}

function processQueue() {
  if (!state.speechQueue.length) {
    onSpeechEnd(); return;
  }

  const item = state.speechQueue.shift();
  setActivePage(item.page);

  const u = new SpeechSynthesisUtterance(item.text);
  applyVoiceSettings(u);

  u.onstart = () => {
    state.isSpeaking = true;
    state.isPaused   = false;
    updateSpeechUI(true);
    showToast(`📖 Reading page ${item.page}`);
  };

  u.onend = () => {
    if (state.isSpeaking) processQueue();
  };

  u.onerror = e => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      showToast('⚠️ Speech error: ' + e.error);
      onSpeechEnd();
    }
  };

  window.speechSynthesis.speak(u);
}

function speakText(text, toastMsg = '') {
  stopSpeech();
  const chunks = splitIntoChunks(text, 200);
  state.speechQueue = chunks.map(chunk => ({
    page: state.currentPage,
    text: chunk
  }));

  if (toastMsg) showToast(toastMsg);
  state.isSpeaking = true;
  state.isPaused   = false;
  updateSpeechUI(true);
  speakChunkQueue();
}

function speakChunkQueue() {
  if (!state.speechQueue.length) {
    onSpeechEnd(); return;
  }

  const item = state.speechQueue.shift();
  const u    = new SpeechSynthesisUtterance(item.text);
  applyVoiceSettings(u);

  u.onend = () => {
    if (state.isSpeaking && !state.isPaused) speakChunkQueue();
  };

  u.onerror = e => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      console.error('Chunk error:', e.error);
    }
  };

  window.speechSynthesis.speak(u);
}

function pauseSpeech() {
  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.pause();
    state.isSpeaking = false;
    state.isPaused   = true;
    updateSpeechUI(false);
    showToast('⏸ Reading paused');
  }
}

function resumeSpeech() {
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    state.isSpeaking = true;
    state.isPaused   = false;
    updateSpeechUI(true);
    showToast('▶ Reading resumed');
  }
}

function stopSpeech() {
  window.speechSynthesis.cancel();
  state.isSpeaking  = false;
  state.isPaused    = false;
  state.speechQueue = [];
  updateSpeechUI(false);
}

dom.pauseBtn.addEventListener('click', () => {
  if (state.isPaused) resumeSpeech();
  else pauseSpeech();
});

dom.stopBtn.addEventListener('click', () => {
  stopSpeech();
  showToast('⏹ Reading stopped');
});

function onSpeechEnd() {
  state.isSpeaking  = false;
  state.isPaused    = false;
  state.speechQueue = [];
  updateSpeechUI(false);
  showToast('✅ Finished reading');
}

function updateSpeechUI(isReading) {
  if (isReading) {
    dom.playBtn.innerHTML = '<i class="bi bi-pause-fill"></i> Pause';
    dom.playBtn.classList.add('reading');
    dom.pauseBtn.classList.remove('d-none');
  } else {
    dom.playBtn.innerHTML = '<i class="bi bi-play-fill"></i> Read';
    dom.playBtn.classList.remove('reading');
    dom.pauseBtn.classList.add('d-none');
  }
}

function splitIntoChunks(text, wordsPerChunk = 200) {
  const words  = text.split(/\s+/).filter(Boolean);
  const chunks = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(' '));
  }
  return chunks;
}

/* ============================================
   NOTES
   ============================================ */
dom.saveNote.addEventListener('click', () => {
  const text = dom.notesInput.value.trim();
  if (!text) {
    showToast('⚠️ Please write a note first');
    return;
  }
  state.notes.push({
    page:      state.currentPage,
    text,
    timestamp: new Date().toLocaleString()
  });
  saveLocal();
  dom.notesInput.value = '';
  bootstrap.Offcanvas.getInstance($('notesOffcanvas'))?.hide();
  showToast(`💾 Note saved for page ${state.currentPage}`);
});

dom.clearNote.addEventListener('click', () => {
  dom.notesInput.value = '';
});

/* ============================================
   EXPORT TO PDF
   ============================================ */
function drawPdfHeader(doc, title, color) {
  doc.setFillColor(...color);
  doc.rect(0, 0, 210, 28, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(title, 15, 18);
}

function drawPdfFooters(doc, label) {
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.text(
      `${label} — Page ${i} of ${total}`,
      105, 290, { align: 'center' }
    );
  }
}

/* Export Notes */
dom.exportNotesPdf.addEventListener('click', async () => {
  exportModalBS.hide();
  if (!state.notes.length) {
    showToast('⚠️ No notes saved yet'); return;
  }
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    drawPdfHeader(doc, 'Reading Notes', [108, 99, 255]);

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Document: ${state.fileName}`, 15, 38);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 15, 45);
    doc.text(`Total Notes: ${state.notes.length}`, 15, 52);
    doc.setDrawColor(220, 220, 220);
    doc.line(15, 56, 195, 56);

    let y = 64;
    state.notes.forEach((note, idx) => {
      if (y > 265) { doc.addPage(); y = 20; }
      doc.setFillColor(240, 240, 252);
      doc.roundedRect(12, y - 5, 186, 10, 2, 2, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(108, 99, 255);
      doc.text(
        `Note #${idx + 1} — Page ${note.page} | ${note.timestamp}`,
        15, y + 2
      );
      y += 12;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      doc.splitTextToSize(note.text, 178).forEach(line => {
        if (y > 278) { doc.addPage(); y = 20; }
        doc.text(line, 15, y);
        y += 6;
      });
      y += 6;
    });

    drawPdfFooters(doc, 'AI PDF Reader — Notes');
    doc.save(`${state.fileName}_notes.pdf`);
    showToast('✅ Notes exported!');
  } catch (err) {
    showToast('❌ Export failed: ' + err.message);
  }
});

/* Export Text */
dom.exportTextPdf.addEventListener('click', async () => {
  exportModalBS.hide();
  showProgress('Extracting text...');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    drawPdfHeader(doc, 'Extracted Text', [67, 217, 140]);

    doc.setTextColor(50, 50, 50);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Source: ${state.fileName}`, 15, 36);
    doc.text(`Pages: ${state.totalPages}`, 15, 43);
    doc.text(`Exported: ${new Date().toLocaleString()}`, 15, 50);
    doc.line(15, 54, 195, 54);

    let y = 62;
    for (let i = 1; i <= state.totalPages; i++) {
      updateProgress(
        Math.round((i / state.totalPages) * 100),
        `Exporting page ${i}...`
      );
      const text = await extractPageText(i);
      if (y > 265) { doc.addPage(); y = 20; }

      doc.setFillColor(245, 245, 255);
      doc.roundedRect(12, y - 4, 186, 9, 2, 2, 'F');
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(108, 99, 255);
      doc.text(`Page ${i}`, 15, y + 2);
      y += 12;

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      doc.splitTextToSize(
        text || '[No readable text]', 180
      ).forEach(line => {
        if (y > 278) { doc.addPage(); y = 15; }
        doc.text(line, 15, y);
        y += 5;
      });
      y += 6;
    }

    drawPdfFooters(doc, 'AI PDF Reader — Extracted Text');
    doc.save(`${state.fileName}_text.pdf`);
    hideProgress();
    showToast('✅ Text exported!');
  } catch (err) {
    hideProgress();
    showToast('❌ Export failed: ' + err.message);
  }
});

/* Export Summary */
dom.exportSummaryPdf.addEventListener('click', async () => {
  exportModalBS.hide();
  showProgress('Generating summary...');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });

    let totalWords = 0, totalChars = 0;
    for (let i = 1; i <= state.totalPages; i++) {
      updateProgress(Math.round((i / state.totalPages) * 75),
        `Analysing page ${i}...`);
      const text = await extractPageText(i);
      if (text) {
        totalWords += text.split(/\s+/).filter(Boolean).length;
        totalChars += text.length;
      }
    }

    const avgWords = state.totalPages > 0
      ? Math.round(totalWords / state.totalPages) : 0;
    const readMins = Math.ceil(totalWords / 200);

    // Cover
    doc.setFillColor(15, 15, 26);
    doc.rect(0, 0, 210, 297, 'F');
    doc.setFillColor(108, 99, 255);
    doc.rect(0, 0, 7, 297, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(26);
    doc.setFont('helvetica', 'bold');
    doc.text('Document Summary', 18, 55);
    doc.setFontSize(13);
    doc.setTextColor(180, 180, 220);
    doc.setFont('helvetica', 'normal');
    doc.splitTextToSize(state.fileName, 170).forEach((l, i) =>
      doc.text(l, 18, 70 + i * 8));
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 160);
    doc.text('Generated by AI PDF Reader', 18, 98);
    doc.text(new Date().toLocaleString(), 18, 106);

    // Stats
    [
      { label: 'Total Pages',    value: state.totalPages,             color: [108,  99, 255] },
      { label: 'Total Words',    value: totalWords.toLocaleString(),  color: [ 67, 217, 140] },
      { label: 'Characters',     value: totalChars.toLocaleString(),  color: [255, 101, 132] },
      { label: 'Avg Words/Page', value: avgWords,                    color: [255, 184,  48] },
      { label: 'Est. Read Time', value: `${readMins} min`,           color: [ 64, 196, 255] },
      { label: 'Bookmarks',      value: state.bookmarks.length,      color: [200, 100, 255] },
    ].forEach((s, i) => {
      const x = 18 + (i % 2) * 96;
      const y = 128 + Math.floor(i / 2) * 36;
      doc.setFillColor(28, 28, 48);
      doc.roundedRect(x, y, 88, 28, 3, 3, 'F');
      doc.setDrawColor(...s.color);
      doc.setLineWidth(0.5);
      doc.roundedRect(x, y, 88, 28, 3, 3, 'S');
      doc.setTextColor(...s.color);
      doc.setFontSize(17);
      doc.setFont('helvetica', 'bold');
      doc.text(String(s.value), x + 44, y + 13, { align: 'center' });
      doc.setTextColor(180, 180, 220);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.text(s.label, x + 44, y + 22, { align: 'center' });
    });

    drawPdfFooters(doc, 'AI PDF Reader — Summary');
    doc.save(`${state.fileName}_summary.pdf`);
    hideProgress();
    showToast('✅ Summary exported!');
  } catch (err) {
    hideProgress();
    showToast('❌ Export failed: ' + err.message);
  }
});

/* ============================================
   LOCAL STORAGE
   ============================================ */
function saveLocal() {
  try {
    localStorage.setItem('pdf_bookmarks', JSON.stringify(state.bookmarks));
    localStorage.setItem('pdf_notes',     JSON.stringify(state.notes));
  } catch {}
}

function loadLocal() {
  try {
    const bk = localStorage.getItem('pdf_bookmarks');
    const nt = localStorage.getItem('pdf_notes');
    if (bk) state.bookmarks = JSON.parse(bk);
    if (nt) state.notes     = JSON.parse(nt);
    renderBookmarks();
  } catch {}
}

loadLocal();

/* ============================================
   KEYBOARD SHORTCUTS
   ============================================ */
document.addEventListener('keydown', e => {
  if (['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) return;

  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      setActivePage(state.currentPage + 1); break;
    case 'ArrowLeft':
    case 'ArrowUp':
      setActivePage(state.currentPage - 1); break;
    case ' ':
      e.preventDefault();
      if (state.isSpeaking)    pauseSpeech();
      else if (state.isPaused) resumeSpeech();
      break;
    case 'Escape':
      stopSpeech(); break;
    case '+': case '=':
      setZoom(state.scale + 0.25); break;
    case '-':
      setZoom(state.scale - 0.25); break;
    case 'f': case 'F':
      dom.searchBtn.click(); break;
    case 'b': case 'B':
      if (state.pdfDoc) addBookmark(state.currentPage); break;
  }
});

/* ============================================
   VISIBILITY & UNLOAD
   ============================================ */
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state.isSpeaking) pauseSpeech();
});

window.addEventListener('beforeunload', () => {
  stopSpeech();
  saveLocal();
});

/* ============================================
   UTILITY
   ============================================ */
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

/* ============================================
   SERVICE WORKER
   ============================================ */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(() => console.log('✅ SW registered'))
      .catch(err => console.warn('SW error:', err));
  });
}

console.log('%c🎤 AI PDF Reader Ready!',
  'color:#6C63FF;font-size:16px;font-weight:bold;');