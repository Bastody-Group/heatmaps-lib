const BM_TRACKING_VERSION = '1.0.1';

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

const DEVICE_BREAKPOINTS = { phone: 560, tablet: 1080 };
const DEVICE_WIDTHS = { phone: '390px', tablet: '768px', desktop: '' };

function isLocalEnvironment() {
  if (window.BM_ALLOW_LOCAL_SUBMIT) return false;
  const { protocol, hostname } = window.location;
  return protocol === 'file:' || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '' || hostname === '[::1]';
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
  constructor({ mainContents, endpoint, userHash } = {}) {
    this.mainContents = mainContents || detectMainContents();
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

    (this.mainContents || document).addEventListener('click', this.handleClick.bind(this), true);
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

    const rect = event.target.getBoundingClientRect();

    if (rect.width === 0 || rect.height === 0) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const selector = this.getSelector(event.target);
    const page = this.getActivePage();

    if (!this.click[page]) this.click[page] = [];

    const existing = this.click[page].find(item => item.selector === selector);

    if (existing) {
      existing.clicks += 1;
      existing.xPx = x;
      existing.yPx = y;
      existing.x = `${((x / rect.width) * 100).toFixed(2)}%`;
      existing.y = `${((y / rect.height) * 100).toFixed(2)}%`;
    } else {
      this.click[page].push({
        selector,
        clicks: 1,
        x: `${((x / rect.width) * 100).toFixed(2)}%`,
        y: `${((y / rect.height) * 100).toFixed(2)}%`,
        xPx: x,
        yPx: y
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
    this.container.style.marginLeft = this.device === 'desktop' ? '' : 'auto';
    this.container.style.marginRight = this.device === 'desktop' ? '' : 'auto';
  }

  buildOverlay() {
    if (getComputedStyle(this.container).position === 'static') {
      this.container.style.position = 'relative';
    }

    this.applyDeviceWidth();

    this.overlayRoot = document.createElement('div');
    this.overlayRoot.id = 'bm-heatmap-overlay-root';
    this.overlayRoot.style.cssText = 'position:absolute; top:0; left:0; pointer-events:none; z-index:2147483000;';

    this.scrollLayer = document.createElement('div');
    this.scrollLayer.style.cssText = 'position:absolute; inset:0; mix-blend-mode:multiply; transition:opacity .2s;';

    this.clickCanvas = document.createElement('canvas');
    this.clickCanvas.style.cssText = 'position:absolute; inset:0;';

    this.overlayRoot.append(this.scrollLayer, this.clickCanvas);
    this.container.appendChild(this.overlayRoot);

    this.resizeOverlay();
  }

  resizeOverlay() {
    const deviceWidth = DEVICE_WIDTHS[this.device];
    const width = deviceWidth ? parseInt(deviceWidth, 10) : this.container.scrollWidth;
    const height = this.container.scrollHeight;
    const dpr = window.devicePixelRatio || 1;

    [this.overlayRoot, this.scrollLayer, this.clickCanvas].forEach(el => {
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
    });

    this.clickCanvas.width = width * dpr;
    this.clickCanvas.height = height * dpr;
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
      const isOwnOverlayChange = mutations.every(m => this.overlayRoot.contains(m.target));
      if (isOwnOverlayChange) return;
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
    document.body.appendChild(this.tooltip);
  }

  handleHover(event) {
    if (!this.state.click || !this.currentPoints || !this.currentPoints.length) {
      this.hideTooltip();
      return;
    }

    const containerRect = this.container.getBoundingClientRect();
    const mouseX = (event.clientX - containerRect.left) + this.container.scrollLeft;
    const mouseY = (event.clientY - containerRect.top) + this.container.scrollTop;

    const HOVER_RADIUS = 24;
    const nearby = this.currentPoints.filter(point => Math.hypot(point.x - mouseX, point.y - mouseY) <= HOVER_RADIUS);

    if (!nearby.length) {
      this.hideTooltip();
      return;
    }

    const totalClicks = nearby.reduce((sum, point) => sum + point.value, 0);
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
        <div class="bm-hm-status" data-role="status">No data loaded</div>
      </div>
    `;
    document.body.appendChild(panel);
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

  getClickPoints(page) {
    const containerRect = this.container.getBoundingClientRect();
    const points = [];

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

        if (!element) return;

        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        const xPct = parseFloat(item.x) / 100;
        const yPct = parseFloat(item.y) / 100;
        const x = (rect.left - containerRect.left) + this.container.scrollLeft + xPct * rect.width;
        const y = (rect.top - containerRect.top) + this.container.scrollTop + yPct * rect.height;

        points.push({ x, y, value: item.clicks, recordIndex, selector: item.selector });
      });
    });

    return points;
  }

  renderClickHeatmap() {
    const ctx = this.clickCanvas.getContext('2d');
    ctx.clearRect(0, 0, this.clickCanvas.width, this.clickCanvas.height);

    this.currentPoints = [];
    if (!this.state.click) return;

    const points = this.getClickPoints(this.currentPage);
    if (!points.length) return;
    this.currentPoints = points;

    const dpr = window.devicePixelRatio || 1;

    const mask = document.createElement('canvas');
    mask.width = this.clickCanvas.width;
    mask.height = this.clickCanvas.height;
    const maskCtx = mask.getContext('2d');
    maskCtx.globalCompositeOperation = 'lighter';

    points.forEach(point => {
      const radius = Math.min(30, 9 + 5 * Math.sqrt(point.value)) * dpr;
      const x = point.x * dpr;
      const y = point.y * dpr;
      const intensity = Math.min(1, point.value / CLICK_HOT_THRESHOLD);
      const peakAlpha = 0.4 + intensity * 0.6;

      const gradient = maskCtx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(0,0,0,${peakAlpha})`);
      gradient.addColorStop(0.6, `rgba(0,0,0,${peakAlpha * 0.75})`);
      gradient.addColorStop(1, 'rgba(0,0,0,0)');

      maskCtx.fillStyle = gradient;
      maskCtx.beginPath();
      maskCtx.arc(x, y, radius, 0, Math.PI * 2);
      maskCtx.fill();
    });

    const blurred = document.createElement('canvas');
    blurred.width = mask.width;
    blurred.height = mask.height;
    const blurredCtx = blurred.getContext('2d');
    blurredCtx.filter = `blur(${6 * dpr}px)`;
    blurredCtx.drawImage(mask, 0, 0);

    const imageData = blurredCtx.getImageData(0, 0, blurred.width, blurred.height);
    const lut = this.getColorLUT();
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const rawAlpha = data[i + 3];
      if (rawAlpha === 0) continue;

      const boosted = Math.min(255, rawAlpha + 30);
      const lutIndex = boosted * 4;
      data[i] = lut[lutIndex];
      data[i + 1] = lut[lutIndex + 1];
      data[i + 2] = lut[lutIndex + 2];
      data[i + 3] = Math.min(230, boosted + 20);
    }

    ctx.putImageData(imageData, 0, 0);
  }

  getColorLUT() {
    if (this.colorLUT) return this.colorLUT;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');

    const gradient = ctx.createLinearGradient(0, 0, 256, 0);
    gradient.addColorStop(0.0, 'rgba(0,80,255,1)');
    gradient.addColorStop(0.2, 'rgba(0,140,255,1)');
    gradient.addColorStop(0.45, 'rgba(0,220,120,1)');
    gradient.addColorStop(0.65, 'rgba(255,235,0,1)');
    gradient.addColorStop(0.85, 'rgba(255,140,0,1)');
    gradient.addColorStop(1.0, 'rgba(255,0,0,1)');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 1);

    this.colorLUT = ctx.getImageData(0, 0, 256, 1).data;
    return this.colorLUT;
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
    const stops = [
      [0, [220, 40, 40]],
      [0.25, [240, 140, 40]],
      [0.5, [230, 210, 40]],
      [0.75, [140, 200, 60]],
      [1, [40, 180, 90]],
    ];

    for (let i = 0; i < stops.length - 1; i++) {
      const [p0, c0] = stops[i];
      const [p1, c1] = stops[i + 1];
      if (percent >= p0 && percent <= p1) {
        const t = (percent - p0) / (p1 - p0);
        const c = c0.map((v, idx) => Math.round(v + (c1[idx] - v) * t));
        return `rgb(${c[0]},${c[1]},${c[2]})`;
      }
    }

    return 'rgb(40,180,90)';
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
