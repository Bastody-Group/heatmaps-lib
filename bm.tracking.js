const BM_TRACKING_VERSION = '1.0.5';

const BM_TRACKING_ENDPOINT = 'https://siwvatcsucacrugbqmhh.supabase.co/functions/v1/heatmap-track';

function detectUserHash() {
  return new URLSearchParams(window.location.search).get('UserHash') || null;
}

function detectMainContents() {
  const el = document.querySelector('#fs-app');
  if (el) return el;
  if (!detectMainContents.alerted) {
    detectMainContents.alerted = true;
    alert('BM Tracking: #fs-app element not found on this page.');
  }
  return document.body;
}

function isLocalEnvironment() {
  if (window.BM_ALLOW_LOCAL_SUBMIT) return false;
  const { protocol, hostname } = window.location;
  return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '' || hostname === '[::1]';
}

const DEVICE_BREAKPOINTS = { phone: 560, tablet: 1080 };
const DEVICE_WIDTHS = { phone: '390px', tablet: '768px', desktop: '' };
const NON_CONTAINER_TAGS = ['IMG', 'VIDEO', 'INPUT', 'SELECT', 'TEXTAREA', 'IFRAME', 'CANVAS'];

function interpolateColor(percent, stops) {
  const clamped = Math.max(0, Math.min(1, percent));

  for (let i = 0; i < stops.length - 1; i++) {
    const [p0, c0] = stops[i];
    const [p1, c1] = stops[i + 1];
    if (clamped >= p0 && clamped <= p1) {
      const t = p1 === p0 ? 0 : (clamped - p0) / (p1 - p0);
      const c = c0.map((v, idx) => Math.round(v + (c1[idx] - v) * t));
      return `rgb(${c[0]},${c[1]},${c[2]})`;
    }
  }

  return `rgb(${stops[stops.length - 1][1].join(',')})`;
}

function classifyDevice(width) {
  if (!width) return null;
  if (width < DEVICE_BREAKPOINTS.phone) return 'phone';
  if (width < DEVICE_BREAKPOINTS.tablet) return 'tablet';
  return 'desktop';
}

const CLICK_HOT_THRESHOLD = 20;


window.BM_SET_PAGE = function bmSetPage(page) {
  window.MOCKUP_PAGE = page;
  document.dispatchEvent(new CustomEvent('mockup:page-change', { detail: page }));
};

document.addEventListener('bm:page', (event) => {
  window.BM_SET_PAGE(event.detail);
});

document.addEventListener('bm:submit', () => {
  if (!window.BM_TRACKER) return;
  window.BM_TRACKER.submit();
});

class ClickScrollTracker {
  constructor({ endpoint, userHash } = {}) {
    this.endpoint = endpoint || BM_TRACKING_ENDPOINT;
    this.userHash = userHash || detectUserHash();
    this.viewportWidth = window.innerWidth;

    this.scroll = {};
    this.click = {};
    this.submitted = false;
  }

  bindEvents(onUpdate) {
    this.onUpdate = onUpdate;

    let scrollTicking = false;
    let pendingTarget = null;
    const scrollHandler = (event) => {
      pendingTarget = event.target === document ? null : event.target;
      if (scrollTicking) return;
      scrollTicking = true;
      requestAnimationFrame(() => {
        this.calculateScrollPixels(pendingTarget);
        scrollTicking = false;
      });
    };

    document.addEventListener('scroll', scrollHandler, true);

    this.calculateScrollPixels();
    document.addEventListener('mockup:page-change', () => this.calculateScrollPixels());

    document.addEventListener('click', this.handleClick.bind(this), true);
  }

  getActivePage() {
    return window.MOCKUP_PAGE || 'home';
  }

  calculateScrollPixels(target) {
    const scrollTop = target ? target.scrollTop : (window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0);
    const clientHeight = target ? target.clientHeight : (window.innerHeight || document.documentElement.clientHeight || document.body.clientHeight);
    const pixelsScrolled = scrollTop + clientHeight;

    const page = this.getActivePage();
    if (!this.scroll[page] || pixelsScrolled > this.scroll[page]) {
      this.scroll[page] = pixelsScrolled;
    }

    if (this.onUpdate) this.onUpdate();

    return this.scroll;
  }

  getScrollJSON() {
    return JSON.stringify(this.scroll);
  }

  handleClick(event) {
    if (!(event.target instanceof Element)) return;
    if (event.target === document.documentElement || event.target === document.body) return;

    const rect = event.target.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const selector = this.getSelector(event.target);
    const page = this.getActivePage();

    const container = detectMainContents();
    const containerRect = container.getBoundingClientRect();
    const absX = (event.clientX - containerRect.left) + container.scrollLeft;
    const absY = (event.clientY - containerRect.top) + container.scrollTop;
    const absXPct = containerRect.width ? (absX / containerRect.width) * 100 : 0;
    const absYPct = containerRect.height ? (absY / containerRect.height) * 100 : 0;

    if (!this.click[page]) this.click[page] = [];

    const existing = this.click[page].find(item => item.selector === selector);

    if (existing) {
      existing.clicks += 1;
      existing.xPx = x;
      existing.yPx = y;
      existing.x = `${((x / rect.width) * 100).toFixed(2)}%`;
      existing.y = `${((y / rect.height) * 100).toFixed(2)}%`;
      existing.absXPct = absXPct;
      existing.absYPct = absYPct;
    } else {
      this.click[page].push({
        selector,
        clicks: 1,
        x: `${((x / rect.width) * 100).toFixed(2)}%`,
        y: `${((y / rect.height) * 100).toFixed(2)}%`,
        xPx: x,
        yPx: y,
        absXPct,
        absYPct
      });
    }

    if (this.onUpdate) this.onUpdate();
  }

  getClickJSON() {
    return JSON.stringify(this.click);
  }

  getSelector(element) {
    if (!element.parentElement) {
      return element.tagName.toLowerCase();
    }

    const parent = element.parentElement;
    const siblings = Array.from(parent.children);
    const nth = siblings.indexOf(element) + 1;
    const tagName = element.tagName.toLowerCase();
    const ownPart = `${tagName}${siblings.length > 1 ? `:nth-child(${nth})` : ''}`;

    if (parent.tagName.toLowerCase() === 'body') {
      return `body > ${ownPart}`;
    }

    return `${this.getSelector(parent)} > ${ownPart}`;
  }

  getPayload() {
    return {
      userHash: this.userHash,
      click: this.click,
      scroll: this.scroll,
      url: window.location.href,
      viewportWidth: this.viewportWidth,
    };
  }

  submit() {
    if (this.submitted) return Promise.resolve({ success: false, reason: 'already-submitted' });

    if (isLocalEnvironment()) {
      console.warn('ClickScrollTracker: local environment detected, submit() skipped');
      return Promise.resolve({ success: false, reason: 'local-environment' });
    }

    if (!this.endpoint) {
      console.warn('ClickScrollTracker: no endpoint configured, submit() skipped');
      return Promise.resolve({ success: false, reason: 'no-endpoint' });
    }

    if (!this.userHash) {
      console.warn('ClickScrollTracker: no UserHash in URL, submit() skipped');
      return Promise.resolve({ success: false, reason: 'no-user-hash' });
    }

    return fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.getPayload()),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.submitted = true;
        return { success: true };
      })
      .catch((error) => {
        console.warn('ClickScrollTracker: submit failed', error);
        return { success: false, reason: 'request-failed', error };
      });
  }
}

class HeatmapOverlay {
  constructor({ endpoint, userHash } = {}) {
    this.urlParams = new URLSearchParams(window.location.search);

    this.endpoint = endpoint || BM_TRACKING_ENDPOINT;
    this.userHash = userHash || detectUserHash();

    const hasDemoData = Boolean(Array.isArray(window.BM_HEATMAP_DEMO_DATA) || (window.BM_HEATMAP_DEMO_DATA && typeof window.BM_HEATMAP_DEMO_DATA === 'object'));

    this.state = {
      click: this.urlParams.get('clickmaps') === 'true' || hasDemoData,
      scroll: this.urlParams.get('scrollmaps') === 'true' || hasDemoData,
    };

    const urlDevice = this.urlParams.get('device');
    this.device = ['phone', 'tablet', 'desktop'].includes(urlDevice)
      ? urlDevice
      : classifyDevice(window.innerWidth) || 'desktop';

    this.records = hasDemoData ? this.normalizeRecords(window.BM_HEATMAP_DEMO_DATA) : [];
    this.currentPage = window.MOCKUP_PAGE || 'home';
    this.container = detectMainContents();

    this.buildOverlay();
    this.buildPanel();
    this.bindWatchers();
    this.syncUrlParams();

    if (hasDemoData) {
      this.updateStatus(`${this.records.length} ${this.pluralize(this.records.length, 'session', 'sessions')} loaded (demo)`);
      this.refreshDeviceAvailability();
    } else if (this.endpoint) {
      this.loadFromEndpoint();
    }

    this.render();
  }

  loadFromEndpoint() {
    this.updateStatus('Loading...');

    const query = this.userHash
      ? `userHash=${encodeURIComponent(this.userHash)}`
      : `path=${encodeURIComponent(window.location.pathname)}`;
    const url = `${this.endpoint}?${query}`;

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((data) => {
        this.records = this.normalizeRecords(data);
        this.updateStatus(`${this.records.length} ${this.pluralize(this.records.length, 'session', 'sessions')} loaded`);
        this.refreshDeviceAvailability();
        this.render();
      })
      .catch((error) => {
        console.warn('HeatmapOverlay: failed to load data from endpoint', error);
        this.updateStatus('Error: failed to load data from endpoint');
      });
  }

  getAvailableDevices() {
    if (!this.records.length) return ['phone', 'tablet', 'desktop'];
    if (this.records.some(record => !record.viewportWidth)) return ['phone', 'tablet', 'desktop'];

    const present = new Set(this.records.map(record => classifyDevice(record.viewportWidth)).filter(Boolean));
    return ['phone', 'tablet', 'desktop'].filter(device => present.has(device));
  }

  refreshDeviceAvailability() {
    const available = this.getAvailableDevices();

    this.deviceButtons.forEach(button => {
      button.hidden = !available.includes(button.dataset.device);
    });

    if (!available.includes(this.device)) {
      const fallback = available[0] || 'desktop';
      this.device = fallback;
      this.deviceButtons.forEach(button => button.classList.toggle('on', button.dataset.device === fallback));
      this.applyDeviceWidth();
      this.syncUrlParams();
      setTimeout(() => {
        this.resizeOverlay();
        this.render();
      }, 50);
    }
  }

  applyDeviceWidth() {
    this.container.style.maxWidth = DEVICE_WIDTHS[this.device] ?? '';
    // this.container.style.marginLeft = this.device === 'desktop' ? '' : 'auto';
    // this.container.style.marginRight = this.device === 'desktop' ? '' : 'auto';
  }

  buildOverlay() {
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }

    this.applyDeviceWidth();

    this.overlayRoot = document.createElement('div');
    this.overlayRoot.id = 'bm-heatmap-overlay-root';
    this.overlayRoot.style.cssText = 'position:absolute; top:0; left:0; overflow:hidden; pointer-events:none; z-index:2147483000;';

    this.scrollLayer = document.createElement('div');
    this.scrollLayer.style.cssText = 'position:absolute; inset:0; mix-blend-mode:multiply; transition:opacity .2s;';

    this.fallbackPointsLayer = document.createElement('div');
    this.fallbackPointsLayer.id = 'bm-heatmap-fallback-points';
    this.fallbackPointsLayer.style.cssText = 'position:absolute; top:0; left:0;';

    this.overlayRoot.append(this.scrollLayer, this.fallbackPointsLayer);
    this.container.appendChild(this.overlayRoot);

    this.pointElements = [];

    this.resizeOverlay();
  }

  resizeOverlay() {
    const deviceWidth = DEVICE_WIDTHS[this.device];
    const width = deviceWidth ? parseInt(deviceWidth, 10) : this.container.scrollWidth;
    const height = this.container.scrollHeight;

    [this.overlayRoot, this.scrollLayer, this.fallbackPointsLayer].forEach(el => {
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    });
  }

  bindWatchers() {
    window.addEventListener('resize', () => {
      this.resizeOverlay();
      this.render();
    });

    document.addEventListener('mockup:page-change', (event) => {
      this.currentPage = event.detail || window.MOCKUP_PAGE || 'home';
      setTimeout(() => {
        this.resizeOverlay();
        this.render();
      }, 50);
    });

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.resizeOverlay();
        this.renderScrollmap();
      });
      this.resizeObserver.observe(this.container);
    }

    let mutationRenderTimeout = null;
    this.mutationObserver = new MutationObserver((mutations) => {
      const isRelevant = mutations.some(m => {
        if (this.overlayRoot.contains(m.target)) return false;
        if (m.type === 'attributes' && m.attributeName === 'style') return false;
        if (m.target instanceof Element && m.target.closest('.swiper')) return false;
        return true;
      });
      if (!isRelevant) return;
      clearTimeout(mutationRenderTimeout);
      mutationRenderTimeout = setTimeout(() => this.render(), 100);
    });
    this.mutationObserver.observe(this.container, { childList: true, subtree: true, attributes: true });

    this.buildTooltip();
    this.container.addEventListener('mousemove', (event) => this.handleHover(event));
    this.container.addEventListener('mouseleave', () => this.hideTooltip());
  }

  buildTooltip() {
    this.tooltip = document.createElement('div');
    this.tooltip.id = 'bm-heatmap-tooltip';
    this.tooltip.style.cssText = 'position:fixed; z-index:2147483647; pointer-events:none; background:rgba(18,21,26,.95); color:#fff; font:12px/1.4 -apple-system,Arial,sans-serif; padding:6px 10px; border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,.35); display:none; white-space:nowrap;';
    document.documentElement.appendChild(this.tooltip);
  }

  handleHover(event) {
    if (!this.state.click || !this.currentPoints || !this.currentPoints.length) {
      this.hideTooltip();
      return;
    }

    const HOVER_RADIUS = 24;
    const nearby = this.currentPoints.filter(point => {
      const rect = point.element.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      return Math.hypot(event.clientX - cx, event.clientY - cy) <= HOVER_RADIUS;
    });

    if (!nearby.length) {
      this.hideTooltip();
      return;
    }

    const totalClicks = nearby.reduce((sum, point) => sum + point.item.clicks, 0);
    const respondents = new Set(nearby.map(point => point.recordIndex)).size;

    this.tooltip.textContent = `${totalClicks} ${this.pluralize(totalClicks, 'click', 'clicks')} · ${respondents} ${this.pluralize(respondents, 'respondent', 'respondents')}`;
    this.tooltip.style.display = 'block';

    const OFFSET = 14;
    const tooltipWidth = this.tooltip.getBoundingClientRect().width;
    const overflowsRight = event.clientX + OFFSET + tooltipWidth > window.innerWidth;

    this.tooltip.style.left = overflowsRight
      ? `${event.clientX - OFFSET - tooltipWidth}px`
      : `${event.clientX + OFFSET}px`;
    this.tooltip.style.top = `${event.clientY + OFFSET}px`;
  }

  hideTooltip() {
    if (this.tooltip) this.tooltip.style.display = 'none';
  }

  pluralize(count, singular, plural) {
    return count === 1 ? singular : plural;
  }

  buildPanel() {
    const style = document.createElement('style');
    style.textContent = `
      #bm-heatmap-panel { position: fixed; bottom: 16px; right: 16px; z-index: 2147483647; font-family: -apple-system, Arial, sans-serif; background: #1b1f24; color: #fff; border-radius: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.35); width: 224px; overflow: hidden; font-size: 13px; }
      #bm-heatmap-panel * { box-sizing: border-box; }
      #bm-heatmap-panel .bm-hm-header { display:flex; align-items:center; justify-content:space-between; padding:10px 12px; background:#12151a; cursor:pointer; user-select:none; }
      #bm-heatmap-panel .bm-hm-header .bm-hm-title { font-weight:600; letter-spacing:.2px; }
      #bm-heatmap-panel .bm-hm-body { padding:12px; display:flex; flex-direction:column; gap:10px; }
      #bm-heatmap-panel.collapsed .bm-hm-body { display:none; }
      #bm-heatmap-panel .bm-hm-row { display:flex; align-items:center; justify-content:space-between; gap:8px; }
      #bm-heatmap-panel .bm-hm-switch { position:relative; width:34px; height:18px; border-radius:20px; background:#3a3f47; cursor:pointer; transition:background .15s; flex-shrink:0; }
      #bm-heatmap-panel .bm-hm-switch.on { background:#2f9e63; }
      #bm-heatmap-panel .bm-hm-switch::after { content:''; position:absolute; top:2px; left:2px; width:14px; height:14px; border-radius:50%; background:#fff; transition:left .15s; }
      #bm-heatmap-panel .bm-hm-switch.on::after { left:18px; }
      #bm-heatmap-panel .bm-hm-status { font-size:11px; color:#9aa4af; line-height:1.4; }
      #bm-heatmap-panel .bm-hm-page { font-size:11px; color:#7fd1a0; text-transform:uppercase; letter-spacing:.4px; }
      #bm-heatmap-panel .bm-hm-device { display:flex; gap:4px; }
      #bm-heatmap-panel .bm-hm-device button { flex:1; background:#2a2f36; color:#9aa4af; border:none; border-radius:6px; padding:5px 0; font-size:11px; cursor:pointer; font-family:inherit; }
      #bm-heatmap-panel .bm-hm-device button.on { background:#2f9e63; color:#fff; }
      #bm-heatmap-panel .bm-hm-screenshot-btn { background:#2a2f36; color:#fff; border:none; border-radius:6px; padding:7px 0; font-size:12px; cursor:pointer; font-family:inherit; }
      #bm-heatmap-panel .bm-hm-screenshot-btn:hover { background:#343a42; }
    `;
    document.head.appendChild(style);

    const panel = document.createElement('div');
    panel.id = 'bm-heatmap-panel';
    panel.innerHTML = `
      <div class="bm-hm-header">
        <span class="bm-hm-title">Heatmaps</span>
        <span class="bm-hm-toggle-icon">▾</span>
      </div>
      <div class="bm-hm-body">
        <div class="bm-hm-page">Page: <span data-role="page"></span></div>
        <div class="bm-hm-row">
          <span>Click heatmap</span>
          <div class="bm-hm-switch" data-role="click-switch"></div>
        </div>
        <div class="bm-hm-row">
          <span>Scroll map</span>
          <div class="bm-hm-switch" data-role="scroll-switch"></div>
        </div>
        <div class="bm-hm-device" data-role="device-switch">
          <button type="button" data-device="phone">Phone</button>
          <button type="button" data-device="tablet">Tablet</button>
          <button type="button" data-device="desktop">Desktop</button>
        </div>
        <button type="button" class="bm-hm-screenshot-btn" data-role="screenshot-btn">Screenshot</button>
        <div class="bm-hm-status" data-role="status">No data loaded</div>
      </div>
    `;
    document.documentElement.appendChild(panel);
    this.panel = panel;

    panel.querySelector('.bm-hm-header').addEventListener('click', () => panel.classList.toggle('collapsed'));

    this.clickSwitch = panel.querySelector('[data-role="click-switch"]');
    this.scrollSwitch = panel.querySelector('[data-role="scroll-switch"]');

    this.clickSwitch.classList.toggle('on', this.state.click);
    this.scrollSwitch.classList.toggle('on', this.state.scroll);

    this.clickSwitch.addEventListener('click', () => {
      this.state.click = !this.state.click;
      this.clickSwitch.classList.toggle('on', this.state.click);
      this.syncUrlParams();
      this.render();
    });

    this.scrollSwitch.addEventListener('click', () => {
      this.state.scroll = !this.state.scroll;
      this.scrollSwitch.classList.toggle('on', this.state.scroll);
      this.syncUrlParams();
      this.render();
    });

    this.deviceButtons = Array.from(panel.querySelectorAll('[data-role="device-switch"] button'));
    this.deviceButtons.forEach(button => {
      button.classList.toggle('on', button.dataset.device === this.device);
      button.addEventListener('click', () => {
        this.device = button.dataset.device;
        this.deviceButtons.forEach(b => b.classList.toggle('on', b === button));
        this.applyDeviceWidth();
        this.syncUrlParams();
        setTimeout(() => {
          this.resizeOverlay();
          this.render();
        }, 50);
      });
    });

    panel.querySelector('[data-role="screenshot-btn"]').addEventListener('click', () => this.captureScreenshot());
  }

  loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve();
    if (this.html2canvasPromise) return this.html2canvasPromise;

    this.html2canvasPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load html2canvas'));
      document.head.appendChild(script);
    });

    return this.html2canvasPromise;
  }

  captureScreenshot() {
    const target = document.querySelector('#fs-app') || document.body;
    const targetSelector = target.id ? `#${target.id}` : 'body';
    const fullWidth = Math.round(target.getBoundingClientRect().width);
    const fullHeight = target.scrollHeight;
    this.updateStatus('Capturing screenshot...');

    this.loadHtml2Canvas()
      .then(() => window.html2canvas(target, {
        useCORS: true,
        allowTaint: true,
        width: fullWidth,
        height: fullHeight,
        windowWidth: fullWidth,
        windowHeight: fullHeight,
        onclone: (clonedDoc) => {
          const clonedTarget = clonedDoc.querySelector(targetSelector) || clonedDoc.body;
          clonedTarget.style.position = 'static';
          clonedTarget.style.inset = 'auto';
          clonedTarget.style.top = 'auto';
          clonedTarget.style.left = 'auto';
          clonedTarget.style.width = `${fullWidth}px`;
          clonedTarget.style.height = `${fullHeight}px`;
          clonedTarget.style.maxHeight = 'none';
          clonedTarget.style.overflow = 'visible';
          clonedDoc.documentElement.style.height = 'auto';
          clonedDoc.documentElement.style.overflow = 'visible';
          clonedDoc.body.style.height = 'auto';
          clonedDoc.body.style.overflow = 'visible';
        },
      }))
      .then(canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png')))
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `heatmap-screenshot-${Date.now()}.png`;
        link.click();
        URL.revokeObjectURL(url);
        this.updateStatus('Screenshot saved');
      })
      .catch(error => {
        console.warn('HeatmapOverlay: screenshot failed', error);
        this.updateStatus('Error: screenshot failed');
      });
  }

  syncUrlParams() {
    const params = new URLSearchParams(window.location.search);
    params.set('clickmaps', String(this.state.click));
    params.set('scrollmaps', String(this.state.scroll));
    params.set('device', this.device);

    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    history.replaceState(history.state, '', newUrl);
  }

  updateStatus(text) {
    this.panel.querySelector('[data-role="status"]').textContent = text;
  }

  normalizeRecords(parsed) {
    const raw = Array.isArray(parsed) ? parsed : [parsed];
    return raw
      .map(item => ({
        click: this.parseMaybeJSON(item.Click ?? item.click),
        scroll: this.parseMaybeJSON(item.Scroll ?? item.scroll),
        viewportWidth: item.viewportWidth ?? item.viewport_width ?? item.ViewportWidth ?? null,
      }))
      .filter(record => record.click || record.scroll);
  }

  recordMatchesDevice(record) {
    return !record.viewportWidth || classifyDevice(record.viewportWidth) === this.device;
  }

  parseMaybeJSON(value) {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      return null;
    }
  }

  render() {
    this.renderClickHeatmap();
    this.renderScrollmap();

    const pageLabel = this.panel.querySelector('[data-role="page"]');
    if (pageLabel) pageLabel.textContent = this.currentPage;
  }

  collectClickItems(page) {
    const items = [];

    this.records.filter(record => this.recordMatchesDevice(record)).forEach((record, recordIndex) => {
      const clicksOnPage = record.click && record.click[page];
      if (!Array.isArray(clicksOnPage)) return;

      clicksOnPage.forEach(item => {
        let element;
        try {
          element = document.querySelector(item.selector);
        } catch (error) {
          element = null;
        }

        if (element === document.documentElement || element === document.body) element = null;

        const rect = element ? element.getBoundingClientRect() : null;
        const isHidden = rect && rect.width === 0 && rect.height === 0;

        items.push({ item, element: isHidden ? null : element, skipFallback: isHidden, recordIndex });
      });
    });

    return items;
  }

  pointParentFor(element) {
    let parent = element;

    while (
      (parent.namespaceURI === 'http://www.w3.org/2000/svg' || NON_CONTAINER_TAGS.includes(parent.tagName))
      && parent.parentElement
    ) {
      parent = parent.parentElement;
    }

    if (getComputedStyle(parent).position === 'static') {
      parent.style.position = 'relative';
    }

    return parent;
  }

  clearClickPoints() {
    (this.pointElements || []).forEach(el => el.remove());
    this.pointElements = [];
  }

  renderClickHeatmap() {
    this.clearClickPoints();
    this.currentPoints = [];
    if (!this.state.click) return;

    const CLUSTER_RADIUS = 24;
    const placements = this.collectClickItems(this.currentPage)
      .map(({ item, element, skipFallback, recordIndex }) => this.computePlacement(item, element, skipFallback, recordIndex))
      .filter(Boolean);

    placements.forEach(placement => {
      placement.clusterClicks = placements.reduce((sum, other) => (
        Math.hypot(placement.pageX - other.pageX, placement.pageY - other.pageY) <= CLUSTER_RADIUS
          ? sum + other.item.clicks
          : sum
      ), 0);
    });

    const hottest = Math.max(CLICK_HOT_THRESHOLD, ...placements.map(p => p.clusterClicks));
    placements.forEach(placement => this.placeClickPoint(placement, hottest));
  }

  computePlacement(item, element, skipFallback, recordIndex) {
    if (skipFallback) return null;

    if (element) {
      const parent = this.pointParentFor(element);
      const parentRect = parent.getBoundingClientRect();
      const elRect = element.getBoundingClientRect();
      const xPct = parseFloat(item.x) / 100;
      const yPct = parseFloat(item.y) / 100;
      const pageX = elRect.left + xPct * elRect.width;
      const pageY = elRect.top + yPct * elRect.height;

      return {
        item,
        recordIndex,
        parent,
        left: (pageX - parentRect.left) + parent.scrollLeft,
        top: (pageY - parentRect.top) + parent.scrollTop,
        pageX,
        pageY,
      };
    }

    const containerRect = this.container.getBoundingClientRect();

    if (typeof item.absXPct === 'number' && typeof item.absYPct === 'number') {
      const left = (item.absXPct / 100) * containerRect.width;
      const top = (item.absYPct / 100) * containerRect.height;

      return {
        item,
        recordIndex,
        parent: this.fallbackPointsLayer,
        left,
        top,
        pageX: containerRect.left + left - this.container.scrollLeft,
        pageY: containerRect.top + top - this.container.scrollTop,
      };
    }

    if (typeof item.absX === 'number' && typeof item.absY === 'number') {
      const width = this.container.scrollWidth;
      const height = this.container.scrollHeight;
      if (item.absX < 0 || item.absX > width || item.absY < 0 || item.absY > height) return null;

      return {
        item,
        recordIndex,
        parent: this.fallbackPointsLayer,
        left: item.absX,
        top: item.absY,
        pageX: containerRect.left + item.absX - this.container.scrollLeft,
        pageY: containerRect.top + item.absY - this.container.scrollTop,
      };
    }

    return null;
  }

  placeClickPoint(placement, hottest) {
    const { item, recordIndex, parent, left, top, clusterClicks } = placement;
    const totalClicks = clusterClicks || item.clicks;
    const intensity = Math.min(1, totalClicks / hottest);
    const size = Math.min(60, 18 + 10 * Math.sqrt(totalClicks));
    const opacity = 0.35 + intensity * 0.3;
    const color = this.colorForIntensity(intensity);

    const point = document.createElement('div');
    point.className = 'bm-hm-point';
    point.style.cssText = `position:absolute; width:${size}px; height:${size}px; border-radius:50%; transform:translate(-50%,-50%); pointer-events:none; filter:blur(4px); background:radial-gradient(circle, ${color} 0%, ${color} 45%, transparent 100%); opacity:${opacity}; left:${left}px; top:${top}px;`;

    parent.appendChild(point);
    this.pointElements.push(point);
    this.currentPoints.push({ element: point, item, recordIndex });
  }

  colorForIntensity(intensity) {
    return interpolateColor(intensity, [
      [0.0, [0, 80, 255]],
      [0.2, [0, 140, 255]],
      [0.45, [0, 220, 120]],
      [0.65, [255, 235, 0]],
      [0.85, [255, 140, 0]],
      [1.0, [255, 0, 0]],
    ]);
  }

  getScrollDepths(page) {
    return this.records
      .filter(record => this.recordMatchesDevice(record))
      .map(record => record.scroll && record.scroll[page])
      .filter(value => typeof value === 'number');
  }

  renderScrollmap() {
    if (!this.state.scroll) {
      this.scrollLayer.style.background = 'none';
      return;
    }

    const depths = this.getScrollDepths(this.currentPage);
    if (!depths.length) {
      this.scrollLayer.style.background = 'none';
      return;
    }

    const totalHeight = this.container.scrollHeight || 1;
    const bands = 40;
    const stops = [];

    for (let i = 0; i <= bands; i++) {
      const y = (i / bands) * totalHeight;
      const reached = depths.filter(depth => depth >= y).length;
      const percent = reached / depths.length;
      stops.push(`${this.scrollColor(percent)} ${(i / bands) * 100}%`);
    }

    this.scrollLayer.style.background = `linear-gradient(to bottom, ${stops.join(', ')})`;
    this.scrollLayer.style.opacity = '0.4';
  }

  scrollColor(percent) {
    return interpolateColor(percent, [
      [0, [220, 40, 40]],
      [0.25, [240, 140, 40]],
      [0.5, [230, 210, 40]],
      [0.75, [140, 200, 60]],
      [1, [40, 180, 90]],
    ]);
  }
}

function shouldShowHeatmapOverlay() {
  const params = new URLSearchParams(window.location.search);
  return params.has('scrollmaps') || params.has('clickmaps');
}

function initBmTracking() {
  if (shouldShowHeatmapOverlay()) {
    window.BM_HEATMAP = new HeatmapOverlay();
    return;
  }

  if (!window.BM_TRACKER) window.BM_TRACKER = new ClickScrollTracker();
  window.BM_TRACKER.bindEvents();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initBmTracking);
} else {
  initBmTracking();
}

window.BM_TRACKING_VERSION = BM_TRACKING_VERSION;
