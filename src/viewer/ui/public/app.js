/* global document */
/**
 * Code-Synapse Index Viewer - Client Application
 *
 * Pure vanilla JavaScript - no frameworks required.
 * Communicates with the viewer REST API.
 */

// =============================================================================
// Configuration
// =============================================================================

const API_BASE = '/api';

// =============================================================================
// State
// =============================================================================

const state = {
  selectedFile: null,
  selectedFunction: null,
  searchResults: [],
  overview: null,
};

// =============================================================================
// API Client
// =============================================================================

async function fetchAPI(endpoint) {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error);
    return null;
  }
}

const api = {
  // Statistics
  getOverview: () => fetchAPI('/stats/overview'),
  getEntityCounts: () => fetchAPI('/stats/entities'),
  getRelationshipCounts: () => fetchAPI('/stats/relationships'),
  getLanguages: () => fetchAPI('/stats/languages'),
  getComplexity: () => fetchAPI('/stats/complexity'),

  // Lists
  getFiles: (limit = 100) => fetchAPI(`/files?limit=${limit}`),
  getFunctions: (limit = 50) => fetchAPI(`/functions?limit=${limit}`),
  getMostCalled: (limit = 10) => fetchAPI(`/functions/most-called?limit=${limit}`),

  // Single entities
  getFile: (id) => fetchAPI(`/files/${encodeURIComponent(id)}`),
  getFunction: (id) => fetchAPI(`/functions/${encodeURIComponent(id)}`),

  // Relationships
  getCallers: (id) => fetchAPI(`/functions/${encodeURIComponent(id)}/callers`),
  getCallees: (id) => fetchAPI(`/functions/${encodeURIComponent(id)}/callees`),
  getImports: (id) => fetchAPI(`/files/${encodeURIComponent(id)}/imports`),
  getImporters: (id) => fetchAPI(`/files/${encodeURIComponent(id)}/importers`),

  // Search
  search: (query, type = 'all') => fetchAPI(`/search?q=${encodeURIComponent(query)}&type=${type}`),

  // Health
  getHealth: () => fetchAPI('/health'),
};

// =============================================================================
// DOM Helpers
// =============================================================================

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

function setHTML(selector, html) {
  const el = $(selector);
  if (el) el.innerHTML = html;
}

function show(selector) {
  const el = $(selector);
  if (el) el.classList.remove('hidden');
}

function hide(selector) {
  const el = $(selector);
  if (el) el.classList.add('hidden');
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// =============================================================================
// UI Updates
// =============================================================================

async function updateStats() {
  const overview = await api.getOverview();
  if (!overview) return;

  state.overview = overview;

  // Update stat cards
  setText('#files-count', formatNumber(overview.totalFiles));
  setText('#files-detail', `${overview.languages?.length || 0} languages`);

  setText('#functions-count', formatNumber(overview.totalFunctions));
  const embeddingPct = Math.round(overview.embeddingCoverage * 100);
  setText('#functions-detail', `${embeddingPct}% with embeddings`);

  setText('#classes-count', formatNumber(overview.totalClasses));
  setText('#classes-detail', `${overview.totalInterfaces || 0} interfaces`);

  setText('#relationships-count', formatNumber(overview.totalRelationships));
  setText('#relationships-detail', 'total connections');
}

async function updateFileList() {
  const files = await api.getFiles(200);
  if (!files) return;

  setText('#file-list-count', `${files.length} files`);

  // Build file tree structure
  const tree = buildFileTree(files);
  const html = renderFileTree(tree);
  setHTML('#file-list', html);

  // Add click handlers
  $$('#file-list li').forEach(li => {
    li.addEventListener('click', () => selectFile(li.dataset.id));
  });
}

function buildFileTree(files) {
  const root = { children: {}, files: [] };

  files.forEach(file => {
    const parts = file.relativePath.split('/');
    let current = root;

    // Navigate/create directories
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current.children[part]) {
        current.children[part] = { children: {}, files: [] };
      }
      current = current.children[part];
    }

    // Add file
    current.files.push({
      id: file.id,
      name: parts[parts.length - 1],
      ...file,
    });
  });

  return root;
}

function renderFileTree(node, indent = 0) {
  let html = '';

  // Render directories first
  Object.keys(node.children).sort().forEach(name => {
    html += `<li class="folder" style="padding-left: ${indent * 16}px">${name}</li>`;
    html += renderFileTree(node.children[name], indent + 1);
  });

  // Then render files
  node.files.sort((a, b) => a.name.localeCompare(b.name)).forEach(file => {
    html += `<li class="file" data-id="${file.id}" style="padding-left: ${indent * 16}px">${file.name}</li>`;
  });

  return html;
}

async function updateLanguageChart() {
  const languages = await api.getLanguages();
  if (!languages || languages.length === 0) return;

  const total = languages.reduce((sum, l) => sum + l.fileCount, 0);

  const html = languages.slice(0, 5).map(lang => {
    const pct = (lang.fileCount / total * 100).toFixed(1);
    return `
      <div class="chart-bar">
        <span class="chart-bar-label">${lang.language}</span>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width: ${pct}%"></div>
        </div>
        <span class="chart-bar-value">${lang.fileCount}</span>
      </div>
    `;
  }).join('');

  setHTML('#language-chart', html);
}

async function updateComplexityChart() {
  const complexity = await api.getComplexity();
  if (!complexity) return;

  const html = complexity.buckets.map(bucket => {
    const label = `${bucket.min}-${bucket.max}`;
    return `
      <div class="chart-bar">
        <span class="chart-bar-label">${label}</span>
        <div class="chart-bar-track">
          <div class="chart-bar-fill" style="width: ${bucket.percentage}%"></div>
        </div>
        <span class="chart-bar-value">${bucket.count}</span>
      </div>
    `;
  }).join('');

  setHTML('#complexity-chart', html);
}

async function updateMostCalled() {
  const functions = await api.getMostCalled(10);
  if (!functions) return;

  const html = functions.map(fn => `
    <tr data-id="${fn.id}">
      <td class="mono">${fn.name}()</td>
      <td>${fn.filePath}</td>
      <td class="mono">${fn.callCount}</td>
    </tr>
  `).join('');

  setHTML('#most-called-table tbody', html);

  // Add click handlers
  $$('#most-called-table tbody tr').forEach(tr => {
    tr.addEventListener('click', () => selectFunction(tr.dataset.id));
  });
}

async function updateHealth() {
  const health = await api.getHealth();
  if (!health) return;

  const dot = $('.health-dot');
  dot.className = `health-dot ${health.status}`;

  setText('#health-status', health.isHealthy ? 'Healthy' : health.status);
  setText('#coverage-info', `Coverage: ${health.coverage.percentage}%`);
  setText('#embedding-info', `Embeddings: ${health.embeddings.percentage}%`);
}

// =============================================================================
// Selection Handlers
// =============================================================================

async function selectFile(id) {
  state.selectedFile = id;
  state.selectedFunction = null;

  // Update file list selection
  $$('#file-list li.selected').forEach(el => el.classList.remove('selected'));
  const selectedLi = $(`#file-list li[data-id="${id}"]`);
  if (selectedLi) selectedLi.classList.add('selected');

  // Get file details
  const file = await api.getFile(id);
  if (!file) return;

  // Show file details
  setText('#detail-title', file.relativePath);
  hide('#overview-section');
  hide('#search-results');
  show('#entity-details');

  // Get functions in file
  const functions = file.functions || [];

  setHTML('#entity-details', `
    <div class="entity-meta">
      <p><strong>Language:</strong> ${file.language}</p>
      <p><strong>Size:</strong> ${formatNumber(file.size)} bytes</p>
      <p><strong>Functions:</strong> ${functions.length}</p>
    </div>

    <h3>Functions in this file</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Lines</th>
          <th>Complexity</th>
        </tr>
      </thead>
      <tbody>
        ${functions.map(fn => `
          <tr data-id="${fn.id}">
            <td class="mono">${fn.name}()</td>
            <td>${fn.startLine}-${fn.endLine}</td>
            <td>${fn.complexity}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `);

  // Add click handlers for functions
  $$('#entity-details tbody tr').forEach(tr => {
    tr.addEventListener('click', () => selectFunction(tr.dataset.id));
  });

  // Update import relationships
  await updateImportRelationships(id);
}

async function selectFunction(id) {
  state.selectedFunction = id;

  const fn = await api.getFunction(id);
  if (!fn) return;

  setText('#detail-title', `${fn.name}()`);
  hide('#overview-section');
  hide('#search-results');
  show('#entity-details');

  setHTML('#entity-details', `
    <div class="entity-meta">
      <p><strong>File:</strong> ${fn.filePath}</p>
      <p><strong>Lines:</strong> ${fn.startLine}-${fn.endLine}</p>
      <p><strong>Signature:</strong> <code class="mono">${fn.signature}</code></p>
      <p><strong>Complexity:</strong> ${fn.complexity}</p>
      <p><strong>Exported:</strong> ${fn.isExported ? 'Yes' : 'No'}</p>
      <p><strong>Async:</strong> ${fn.isAsync ? 'Yes' : 'No'}</p>
      ${fn.docComment ? `<p><strong>Doc:</strong> ${fn.docComment}</p>` : ''}
    </div>
  `);

  // Update call relationships
  await updateCallRelationships(id);
}

async function updateCallRelationships(functionId) {
  hide('#no-selection');
  hide('#import-graph-section');
  show('#call-graph-section');

  const [callers, callees] = await Promise.all([
    api.getCallers(functionId),
    api.getCallees(functionId),
  ]);

  setHTML('#callers-list', (callers || []).map(fn => `
    <li data-id="${fn.id}"><span class="arrow">←</span> ${fn.name}()</li>
  `).join('') || '<li class="empty-state">No callers</li>');

  setHTML('#callees-list', (callees || []).map(fn => `
    <li data-id="${fn.id}"><span class="arrow">→</span> ${fn.name}()</li>
  `).join('') || '<li class="empty-state">No callees</li>');

  // Add click handlers
  $$('#callers-list li[data-id], #callees-list li[data-id]').forEach(li => {
    li.addEventListener('click', () => selectFunction(li.dataset.id));
  });
}

async function updateImportRelationships(fileId) {
  hide('#no-selection');
  hide('#call-graph-section');
  show('#import-graph-section');

  const [imports, importers] = await Promise.all([
    api.getImports(fileId),
    api.getImporters(fileId),
  ]);

  setHTML('#imports-list', (imports || []).map(file => `
    <li data-id="${file.id}"><span class="arrow">→</span> ${file.relativePath}</li>
  `).join('') || '<li class="empty-state">No imports</li>');

  setHTML('#importers-list', (importers || []).map(file => `
    <li data-id="${file.id}"><span class="arrow">←</span> ${file.relativePath}</li>
  `).join('') || '<li class="empty-state">No importers</li>');

  // Add click handlers
  $$('#imports-list li[data-id], #importers-list li[data-id]').forEach(li => {
    li.addEventListener('click', () => selectFile(li.dataset.id));
  });
}

// =============================================================================
// Search
// =============================================================================

async function performSearch() {
  const query = $('#search-input').value.trim();
  const type = $('#search-type').value;

  if (!query) return;

  const results = await api.search(query, type);
  if (!results) return;

  state.searchResults = results;

  // Show search results
  setText('#detail-title', `Search: "${query}"`);
  hide('#overview-section');
  hide('#entity-details');
  show('#search-results');

  setText('#search-results-count', `${results.length} results`);

  const html = results.map(result => `
    <li class="result-item" data-id="${result.id}" data-type="${result.entityType}">
      <div class="result-item-title">
        ${result.name}
        <span class="result-item-badge">${result.entityType}</span>
      </div>
      <div class="result-item-path">${result.filePath}${result.line ? `:${result.line}` : ''}</div>
    </li>
  `).join('');

  setHTML('#search-results-list', html || '<li class="empty-state">No results found</li>');

  // Add click handlers
  $$('#search-results-list .result-item').forEach(li => {
    li.addEventListener('click', () => {
      if (li.dataset.type === 'file') {
        selectFile(li.dataset.id);
      } else {
        selectFunction(li.dataset.id);
      }
    });
  });
}

// =============================================================================
// Event Listeners
// =============================================================================

function setupEventListeners() {
  // Search
  $('#search-btn').addEventListener('click', performSearch);
  $('#search-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') performSearch();
  });

  // Refresh
  $('#refresh-btn').addEventListener('click', initApp);
}

// =============================================================================
// Initialization
// =============================================================================

async function initApp() {
  console.log('Initializing Code-Synapse Index Viewer...');

  // Load all data in parallel
  await Promise.all([
    updateStats(),
    updateFileList(),
    updateLanguageChart(),
    updateComplexityChart(),
    updateMostCalled(),
    updateHealth(),
  ]);

  console.log('Viewer initialized');
}

// Start the app
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initApp();
});
