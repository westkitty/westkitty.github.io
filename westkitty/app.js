(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const body = document.body;
  const canvas = $('#field');
  const quietToggle = $('#quietToggle');
  const repoStream = $('#repoStream');
  const repoHealth = $('#repoHealth');
  const refreshRepos = $('#refreshRepos');
  const metrics = $('#metrics');
  const languageBars = $('#languageBars');
  const debugPanel = $('#debugPanel');
  const debugFps = $('#debugFps');
  const debugX = $('#debugX');
  const debugY = $('#debugY');
  const debugSection = $('#debugSection');
  const debugRepos = $('#debugRepos');
  const header = $('.site-header');
  const footerYear = $('#footerYear');

  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const touchLike = window.matchMedia('(pointer: coarse)').matches;
  const username = 'westkitty';

  const principleCopy = {
    local: 'Own the machinery when you reasonably can. Dependency is a cost, not a personality trait.',
    repairable: 'A system should leave a trail back from failure. Recovery is part of the feature, not an apology after it breaks.',
    accessible: 'A spectacular interface that locks people out is not spectacular. It is unfinished.',
    weird: 'Useful does not require generic. The strange idea earns its place by doing a real job.',
    finished: 'Ship the boring parts too: failure states, cleanup, handoff, documentation, and the route back from a bad day.'
  };

  const fallbackRepos = [
    { name: 'DexDictate_MacOS', html_url: 'https://github.com/westkitty/DexDictate_MacOS', language: 'Swift', pushed_at: null },
    { name: 'Gay_Cast_PWA', html_url: 'https://github.com/westkitty/Gay_Cast_PWA', language: 'JavaScript', pushed_at: null },
    { name: 'AtlasOfOne', html_url: 'https://github.com/westkitty/AtlasOfOne', language: 'TypeScript', pushed_at: null },
    { name: 'DexFoundry', html_url: 'https://github.com/westkitty/DexFoundry', language: 'TypeScript', pushed_at: null },
    { name: 'DexGen', html_url: 'https://github.com/westkitty/DexGen', language: 'Python', pushed_at: null },
    { name: 'DexTilt', html_url: 'https://github.com/westkitty/DexTilt', language: null, pushed_at: null }
  ];

  const state = {
    quiet: false,
    debug: false,
    repoCount: 0,
    pointer: { x: innerWidth / 2, y: innerHeight / 2, down: false, active: false },
    fps: 0,
    section: 'TOP'
  };

  function safeStorageGet(key) {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function safeStorageSet(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage can be blocked. Quiet mode still works for this visit.
    }
  }

  function setQuiet(next, persist = true) {
    state.quiet = Boolean(next);
    body.classList.toggle('quiet', state.quiet);
    quietToggle?.setAttribute('aria-pressed', String(state.quiet));
    if (persist) safeStorageSet('westkitty-quiet', state.quiet ? '1' : '0');
    field.setMotionState();
  }

  function initQuietMode() {
    const stored = safeStorageGet('westkitty-quiet');
    setQuiet(stored === '1', false);
    quietToggle?.addEventListener('click', () => setQuiet(!state.quiet));
    motionQuery.addEventListener?.('change', () => field.setMotionState());
  }

  function initHeader() {
    const update = () => header?.classList.toggle('is-scrolled', scrollY > 18);
    update();
    addEventListener('scroll', update, { passive: true });
  }

  function initPrinciples() {
    const tabs = $$('[role="tab"][data-principle]');
    const copy = $('#principle-copy');

    const activate = (tab, focus = false) => {
      const key = tab.dataset.principle;
      tabs.forEach((item) => {
        const selected = item === tab;
        item.setAttribute('aria-selected', String(selected));
        item.tabIndex = selected ? 0 : -1;
      });
      if (copy) copy.textContent = principleCopy[key] || '';
      if (focus) tab.focus();
    };

    tabs.forEach((tab, index) => {
      tab.tabIndex = index === 0 ? 0 : -1;
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        let next = index;
        if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
        if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = tabs.length - 1;
        activate(tabs[next], true);
      });
    });
  }

  function initProjectCards() {
    $$('.project-card').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        if (touchLike || state.quiet || motionQuery.matches) return;
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--mx', `${event.clientX - rect.left}px`);
        card.style.setProperty('--my', `${event.clientY - rect.top}px`);
      });
    });
  }

  function initSectionObserver() {
    const sections = [
      ['TOP', $('#top')],
      ['THESIS', $('#thesis')],
      ['WORK', $('#work')],
      ['PRINCIPLES', $('#principles')],
      ['TELEMETRY', $('.telemetry')]
    ].filter(([, el]) => el);

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      const found = sections.find(([, el]) => el === visible.target);
      if (!found) return;
      state.section = found[0];
      if (debugSection) debugSection.textContent = state.section;
    }, { threshold: [0.15, 0.35, 0.6] });

    sections.forEach(([, el]) => observer.observe(el));

    const axiomObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        entry.target.classList.toggle('is-active', entry.isIntersecting && entry.intersectionRatio > 0.45);
      });
    }, { threshold: [0.45] });

    $$('.axiom').forEach((axiom) => axiomObserver.observe(axiom));
  }

  function formatAge(iso) {
    if (!iso) return 'PUBLIC';
    const diff = Date.now() - new Date(iso).getTime();
    if (!Number.isFinite(diff) || diff < 0) return 'RECENT';
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) return 'JUST NOW';
    if (hours < 24) return `${hours}H AGO`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}D AGO`;
    const months = Math.floor(days / 30);
    return `${months}MO AGO`;
  }

  function escapeHTML(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function renderRepoStream(repos, fallback = false) {
    if (!repoStream) return;
    const featuredNames = new Set(['westkitty', 'westkitty.github.io']);
    const selected = repos.filter((repo) => !featuredNames.has(repo.name)).slice(0, 7);

    repoStream.innerHTML = selected.map((repo, index) => `
      <a class="repo-row" href="${escapeHTML(repo.html_url)}" target="_blank" rel="noreferrer">
        <span class="repo-index">${String(index + 1).padStart(2, '0')}</span>
        <strong>${escapeHTML(repo.name)}</strong>
        <span class="repo-language">${escapeHTML(repo.language || 'MIXED')}</span>
        <span class="repo-age">${fallback ? 'PUBLIC' : formatAge(repo.pushed_at)}</span>
        <span class="repo-arrow" aria-hidden="true">↗</span>
      </a>
    `).join('');
  }

  function renderMetrics(profile, repos, degraded = false) {
    const publicRepos = degraded ? '—' : (Number(profile?.public_repos ?? repos.length) || repos.length);
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const active = degraded ? '—' : repos.filter((repo) => new Date(repo.pushed_at || 0).getTime() >= monthAgo).length;
    const languages = [...new Set(repos.map((repo) => repo.language).filter(Boolean))];

    if (metrics) {
      metrics.innerHTML = `
        <div class="metric"><strong>${publicRepos}</strong><span>PUBLIC REPOS</span></div>
        <div class="metric"><strong>${active}</strong><span>ACTIVE / LATEST 100</span></div>
        <div class="metric"><strong>${languages.length}</strong><span>LANGS / LATEST 100</span></div>
      `;
    }

    if (languageBars) {
      const counts = repos.reduce((acc, repo) => {
        if (!repo.language) return acc;
        acc[repo.language] = (acc[repo.language] || 0) + 1;
        return acc;
      }, {});
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
      const max = sorted[0]?.[1] || 1;
      languageBars.innerHTML = sorted.map(([language, count]) => `
        <div class="language-row">
          <strong>${escapeHTML(language)}</strong>
          <div class="language-track" aria-hidden="true"><span class="language-fill" style="width:${Math.max(8, Math.round((count / max) * 100))}%"></span></div>
          <span>${count}</span>
        </div>
      `).join('');
    }

    state.repoCount = publicRepos;
    if (debugRepos) debugRepos.textContent = String(publicRepos);
  }

  function setRepoHealth(kind, label) {
    if (!repoHealth) return;
    repoHealth.dataset.state = kind;
    const text = $('span:last-child', repoHealth);
    if (text) text.textContent = label;
  }

  async function loadRepos() {
    setRepoHealth('loading', 'CONNECTING TO PUBLIC REPOS');
    if (refreshRepos) {
      refreshRepos.disabled = true;
      refreshRepos.textContent = 'SYNCING…';
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);

    try {
      const [repoResponse, profileResponse] = await Promise.all([
        fetch(`https://api.github.com/users/${username}/repos?per_page=100&sort=pushed&direction=desc`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal
        }),
        fetch(`https://api.github.com/users/${username}`, {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal
        })
      ]);

      if (!repoResponse.ok || !profileResponse.ok) throw new Error('GitHub public API unavailable');

      const [allRepos, profile] = await Promise.all([repoResponse.json(), profileResponse.json()]);
      const repos = allRepos.filter((repo) => !repo.fork && !repo.archived && repo.visibility === 'public');

      renderRepoStream(repos);
      renderMetrics(profile, repos);
      setRepoHealth('ok', 'PUBLIC REPOS LIVE');
    } catch {
      renderRepoStream(fallbackRepos, true);
      renderMetrics(null, fallbackRepos, true);
      setRepoHealth('degraded', 'LIVE FEED DEGRADED / STATIC FALLBACK');
    } finally {
      clearTimeout(timeout);
      if (refreshRepos) {
        refreshRepos.disabled = false;
        refreshRepos.textContent = 'REFRESH';
      }
    }
  }

  function initDebug() {
    addEventListener('keydown', (event) => {
      if (event.key.toLowerCase() !== 'd' || event.metaKey || event.ctrlKey || event.altKey) return;
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      state.debug = !state.debug;
      if (debugPanel) debugPanel.hidden = !state.debug;
    });
  }

  function initPointerTelemetry() {
    const update = (event) => {
      state.pointer.x = event.clientX;
      state.pointer.y = event.clientY;
      state.pointer.active = true;
      if (debugX) debugX.textContent = String(Math.round(event.clientX));
      if (debugY) debugY.textContent = String(Math.round(event.clientY));
    };

    addEventListener('pointermove', update, { passive: true });
    addEventListener('pointerdown', (event) => {
      update(event);
      state.pointer.down = true;
      field.compress(event.clientX, event.clientY);
    }, { passive: true });
    addEventListener('pointerup', (event) => {
      update(event);
      state.pointer.down = false;
      field.release(event.clientX, event.clientY);
    }, { passive: true });
    addEventListener('pointercancel', () => {
      state.pointer.down = false;
    });
    document.addEventListener('mouseleave', () => {
      state.pointer.active = false;
      state.pointer.down = false;
    });
  }

  function createField() {
    if (!canvas) {
      return { init() {}, compress() {}, release() {}, setMotionState() {} };
    }

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) {
      return { init() {}, compress() {}, release() {}, setMotionState() {} };
    }

    const palette = ['#00d4ff', '#a78bfa', '#ffb020'];
    let points = [];
    let waves = [];
    let width = innerWidth;
    let height = innerHeight;
    let dpr = 1;
    let raf = 0;
    let running = false;
    let last = performance.now();
    let fpsAccumulator = 0;
    let fpsFrames = 0;
    let fpsLastReport = performance.now();
    let seed = 0x5eeda11;

    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    function pointCount() {
      const area = Math.max(1, width * height);
      const base = touchLike ? 34 : 54;
      const scaled = Math.floor(area / 26000);
      return Math.max(base, Math.min(touchLike ? 60 : 88, base + scaled));
    }

    function resetPoints() {
      seed = 0x5eeda11;
      points = Array.from({ length: pointCount() }, (_, index) => {
        const x = rand() * width;
        const y = rand() * height;
        return {
          x,
          y,
          ox: x,
          oy: y,
          vx: 0,
          vy: 0,
          size: 0.7 + rand() * 1.4,
          drift: 0.08 + rand() * 0.24,
          phase: rand() * Math.PI * 2,
          color: palette[index % palette.length]
        };
      });
    }

    function resize() {
      width = innerWidth;
      height = innerHeight;
      dpr = Math.min(devicePixelRatio || 1, touchLike ? 1.25 : 1.5);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      resetPoints();
      drawStatic();
    }

    function compress(x, y) {
      if (state.quiet || motionQuery.matches) return;
      points.forEach((p) => {
        const dx = x - p.x;
        const dy = y - p.y;
        const distance = Math.hypot(dx, dy) || 1;
        const strength = Math.max(0, 1 - distance / 520) * 1.8;
        p.vx += (dx / distance) * strength;
        p.vy += (dy / distance) * strength;
      });
    }

    function release(x, y) {
      if (state.quiet || motionQuery.matches) return;
      waves.push({ x, y, radius: 0, alpha: 0.8 });
      points.forEach((p) => {
        const dx = p.x - x;
        const dy = p.y - y;
        const distance = Math.hypot(dx, dy) || 1;
        const strength = Math.max(0, 1 - distance / 360) * 4.2;
        p.vx += (dx / distance) * strength;
        p.vy += (dy / distance) * strength;
      });
    }

    function updatePoint(point, now, dt) {
      const time = now * 0.0002;
      point.ox += Math.cos(time + point.phase) * point.drift * dt * 0.02;
      point.oy += Math.sin(time * 0.9 + point.phase) * point.drift * dt * 0.02;

      const springX = point.ox - point.x;
      const springY = point.oy - point.y;
      point.vx += springX * 0.0027 * dt;
      point.vy += springY * 0.0027 * dt;

      if (state.pointer.active && !touchLike) {
        const dx = state.pointer.x - point.x;
        const dy = state.pointer.y - point.y;
        const distance = Math.hypot(dx, dy) || 1;
        const radius = state.pointer.down ? 310 : 185;
        if (distance < radius) {
          const falloff = 1 - distance / radius;
          const direction = state.pointer.down ? 1 : -0.42;
          point.vx += (dx / distance) * falloff * direction * 0.035 * dt;
          point.vy += (dy / distance) * falloff * direction * 0.035 * dt;
        }
      }

      point.vx *= Math.pow(0.984, dt / 16.67);
      point.vy *= Math.pow(0.984, dt / 16.67);
      point.x += point.vx * dt * 0.04;
      point.y += point.vy * dt * 0.04;

      if (point.x < -40) point.x = width + 40;
      if (point.x > width + 40) point.x = -40;
      if (point.y < -40) point.y = height + 40;
      if (point.y > height + 40) point.y = -40;
    }

    function drawConnections() {
      const maxDistance = touchLike ? 92 : 125;
      for (let i = 0; i < points.length; i += 1) {
        const a = points[i];
        for (let j = i + 1; j < points.length; j += 1) {
          const b = points[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const distance2 = dx * dx + dy * dy;
          if (distance2 > maxDistance * maxDistance) continue;
          const distance = Math.sqrt(distance2);
          const alpha = (1 - distance / maxDistance) * 0.14;
          ctx.strokeStyle = `rgba(148,163,184,${alpha})`;
          ctx.lineWidth = 0.65;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }

    function drawPoints(now) {
      points.forEach((point) => {
        const pulse = 0.65 + Math.sin(now * 0.001 + point.phase) * 0.22;
        ctx.globalAlpha = pulse;
        ctx.fillStyle = point.color;
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.size, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function drawWaves(dt) {
      waves = waves.filter((wave) => wave.alpha > 0.015 && wave.radius < Math.max(width, height));
      waves.forEach((wave) => {
        wave.radius += dt * 0.26;
        wave.alpha *= Math.pow(0.974, dt / 16.67);
        ctx.strokeStyle = `rgba(0,212,255,${wave.alpha * 0.32})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(wave.x, wave.y, wave.radius, 0, Math.PI * 2);
        ctx.stroke();
      });
    }

    function render(now, update = true) {
      const dt = Math.min(42, Math.max(0, now - last || 16.67));
      last = now;
      ctx.clearRect(0, 0, width, height);

      if (update) points.forEach((point) => updatePoint(point, now, dt));
      drawConnections();
      drawPoints(now);
      if (update) drawWaves(dt);

      if (update) {
        fpsFrames += 1;
        fpsAccumulator += dt;
        if (now - fpsLastReport > 600) {
          state.fps = Math.round((fpsFrames * 1000) / Math.max(1, fpsAccumulator));
          if (debugFps) debugFps.textContent = String(state.fps);
          fpsFrames = 0;
          fpsAccumulator = 0;
          fpsLastReport = now;
        }
      }
    }

    function frame(now) {
      if (!running) return;
      render(now, true);
      raf = requestAnimationFrame(frame);
    }

    function drawStatic() {
      last = performance.now();
      render(last, false);
    }

    function start() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      cancelAnimationFrame(raf);
      drawStatic();
    }

    function setMotionState() {
      const shouldAnimate = !state.quiet && !motionQuery.matches && document.visibilityState !== 'hidden';
      if (shouldAnimate) start();
      else stop();
    }

    function init() {
      resize();
      addEventListener('resize', resize, { passive: true });
      document.addEventListener('visibilitychange', setMotionState);
      setMotionState();
    }

    return { init, compress, release, setMotionState };
  }

  const field = createField();

  function init() {
    if (footerYear) footerYear.textContent = new Date().getFullYear();
    initHeader();
    initQuietMode();
    initPrinciples();
    initProjectCards();
    initSectionObserver();
    initDebug();
    initPointerTelemetry();
    field.init();
    loadRepos();
    refreshRepos?.addEventListener('click', loadRepos);
  }

  init();
})();
