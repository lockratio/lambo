/* ═══════════════════════════════════════════════════════════════
   HUD — everything DOM. Reads app state, never owns it.
   ═══════════════════════════════════════════════════════════════ */
import { CONFIG, ZONES, RAIL_ORDER, PALETTE } from './config.js';
import { heatCss } from './paint.js';
import { drawSticker } from './campaigns.js';

const $ = (s, r = document) => r.querySelector(s);
export const money = n => '$' + Math.round(n).toLocaleString('en-AU');
export const moneyShort = n => n >= 1e6 ? '$' + (n/1e6).toFixed(n % 1e6 ? 1 : 0) + 'M' : n >= 1000 ? '$' + (n/1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : '$' + Math.round(n);
const cm2 = m2 => Math.round(m2 * 1e4).toLocaleString('en-AU') + ' cm²';
const zoneLabel = z => ZONES[z]?.label ?? z;

/* ── loading screen ───────────────────────────────────────── */
export function createLoader(){
  const el = $('#loader'), bar = $('#loader .bar i'), txt = $('#loader .t'), pct = $('#loader .pct');
  const phases = { download: [0, 0.55], measure: [0.55, 0.7], partition: [0.7, 0.9], price: [0.9, 1], cache: [0.55, 1] };
  const labels = { download: 'Downloading the car', measure: 'Measuring panels', partition: 'Laying out slots', price: 'Pricing slots', cache: 'Restoring slot table' };
  let shown = 0;
  return {
    set(phase, v){
      const [a, b] = phases[phase] ?? [0, 1];
      shown = Math.max(shown, a + (b - a) * Math.min(1, Math.max(0, v)));
      bar.style.transform = `scaleX(${shown.toFixed(3)})`;
      txt.textContent = labels[phase] ?? phase;
      pct.textContent = Math.round(shown * 100) + '%';
    },
    done(){ bar.style.transform = 'scaleX(1)'; el.classList.add('gone'); setTimeout(() => el.remove(), 900); },
    fail(msg){ txt.textContent = msg; pct.textContent = ''; el.classList.add('failed'); },
  };
}

/* ── main HUD ─────────────────────────────────────────────── */
export function createHUD(app, ix){
  const { cells, campaigns, share, flight, modeAnim, sfx } = app;
  const tip = $('#tip'), toastEl = $('#toast');
  let toastT;

  /* mode buttons */
  $('#mLook').onclick = () => { ix.setMode('look'); sfx?.click(); };
  $('#mSelect').onclick = () => { ix.setMode('select'); sfx?.click(); };
  function reflectMode(m){
    $('#mLook').setAttribute('aria-pressed', m === 'look');
    $('#mSelect').setAttribute('aria-pressed', m === 'select');
    $('#brushGroup').classList.toggle('dim', m !== 'select');
    $('#hint').innerHTML = m === 'select'
      ? 'Drag to paint · drag over a selection to erase · scroll sizes the brush · <kbd>right-drag</kbd> moves · <kbd>Ctrl+Z</kbd> undo · <kbd>esc</kbd> to look'
      : 'Drag to orbit · scroll to zoom · <kbd>right-drag</kbd> to move · <kbd>click</kbd> a panel to start selecting';
    if (m === 'select'){ app.viewctl?.setPan(false); if (modeAnim.mode !== 'market') setView('market'); }
  }

  /* brush */
  const slider = $('#brushSlider');
  const DETENTS = 12, STEP = 1 / DETENTS;
  let lastDetent = 0;
  function reflectBrush(){
    slider.value = Math.round(ix.state.brush * 100);
    $('#brushVal').textContent = ix.singleBrush() ? '1 slot' : `⌀ ${(ix.brushRadius() * 200).toFixed(0)} cm`;
    const d = Math.round(ix.state.brush * DETENTS);
    if (d !== lastDetent){ lastDetent = d; sfx?.tick(); }
  }
  slider.oninput = e => { if (ix.mode !== 'select') ix.setMode('select'); ix.setBrush(+e.target.value / 100); reflectBrush(); };
  const stepBrush = (dir) => { if (ix.mode !== 'select') ix.setMode('select'); ix.setBrush(Math.round((ix.state.brush + dir * STEP) * DETENTS) / DETENTS); reflectBrush(); };
  $('#brushDown').onclick = () => stepBrush(-1);
  $('#brushUp').onclick = () => stepBrush(+1);
  ix.onBrushChange = reflectBrush;

  /* interface sounds */
  const sfxBtn = $('#sfxBtn');
  sfxBtn.setAttribute('aria-pressed', String(!!sfx?.enabled));
  sfxBtn.onclick = () => sfxBtn.setAttribute('aria-pressed', String(sfx.toggle()));

  /* showroom / market */
  const setView = (m) => {
    modeAnim.set(m);
    $('#vShowroom').setAttribute('aria-pressed', m === 'showroom');
    $('#vMarket').setAttribute('aria-pressed', m === 'market');
    document.body.dataset.view = m;
  };
  $('#vShowroom').onclick = () => { setView('showroom'); sfx?.click(); };
  $('#vMarket').onclick = () => { setView('market'); sfx?.click(); };
  addEventListener('keydown', e => { if (e.key === 'm' || e.key === 'M') setView(modeAnim.mode === 'market' ? 'showroom' : 'market'); });

  /* legend */
  const prices = cells.map(c => c.price);
  $('#legMin').textContent = moneyShort(Math.min(...prices));
  $('#legMax').textContent = moneyShort(Math.max(...prices));
  $('#legendBar').style.background = `linear-gradient(90deg, ${PALETTE.heat.join(',')})`;

  /* ── cart ─────────────────────────────────────────────────── */
  let lastCount = 0;
  function updateCart(){
    const sel = cells.filter(c => c.state === 2);
    const total = sel.reduce((a, c) => a + c.price, 0);
    if (sel.length > lastCount) sfx?.pop(); else if (sel.length < lastCount) sfx?.drop();
    lastCount = sel.length;
    $('#cartCount').textContent = sel.length.toLocaleString('en-AU');
    $('#cartTotal').textContent = money(total);
    $('#cartGst').textContent = sel.length ? `incl. ${money(total - total / (1 + CONFIG.GST))} GST` : 'Nothing selected yet';
    $('#reserve').disabled = sel.length === 0;
    $('#undoBtn').disabled = !ix.canUndo;
    $('#cart').classList.toggle('has', sel.length > 0);
    document.body.classList.toggle('has-sel', sel.length > 0);
    $('#artLabel').setAttribute('aria-disabled', sel.length ? 'false' : 'true');
    artSpecLine(sel.length);

    const groups = new Map();
    for (const c of sel){
      const g = groups.get(c.zone) ?? { zone: c.zone, ids: [], sum: 0 };
      g.ids.push(c.id); g.sum += c.price; groups.set(c.zone, g);
    }
    const list = $('#cartGroups'); list.innerHTML = '';
    [...groups.values()].sort((a, b) => b.sum - a.sum).forEach(g => {
      const row = document.createElement('div'); row.className = 'crow';
      row.innerHTML = `<span class="cz"><i class="swatch" style="background:${heatCss(cells[g.ids[0]].t)}"></i>${zoneLabel(g.zone)}</span>
        <span class="cn num">×${g.ids.length}</span><span class="cp num">${money(g.sum)}</span>
        <button class="cx" aria-label="Remove ${zoneLabel(g.zone)} from selection" title="Remove">×</button>`;
      row.querySelector('.cx').onclick = () => ix.deselectCells(g.ids);
      row.querySelector('.cz').onclick = () => flight.frameCells(g.ids.map(i => cells[i]));
      list.appendChild(row);
    });
    share.remember();
  }
  $('#clear').onclick = () => ix.clear();
  $('#undoBtn').onclick = () => ix.undo();
  $('#reserve').onclick = () => {
    const sel = cells.filter(c => c.state === 2);
    const total = sel.reduce((a, c) => a + c.price, 0);
    toast(`<b>${sel.length} slots held for ${CONFIG.HOLD_MINUTES} minutes.</b> ${money(total)} AUD incl. GST. Preview build — no payment is taken and nothing is stored.`);
  };

  /* ── funding ──────────────────────────────────────────────── */
  function updateFunding(){
    const total = cells.reduce((a, c) => a + c.price, 0);
    const soldCells = cells.filter(c => c.state === 1);
    const sold = soldCells.reduce((a, c) => a + c.price, 0);
    const pct = sold / total * 100;
    $('#fundRaised').textContent = money(sold);
    $('#fundEyebrow').textContent = `of ${moneyShort(total)} AUD`;
    $('#fundSold').textContent = soldCells.length.toLocaleString('en-AU');
    $('#fundTotal').textContent = cells.length.toLocaleString('en-AU');
    $('#fundPct').textContent = pct.toFixed(1) + '%';
    $('#fundBrands').textContent = campaigns.filter(c => c.slots).length;
    $('#heroSlots').textContent = cells.length.toLocaleString('en-AU');
    $('#heroFrom').textContent = money(Math.min(...cells.map(c => c.price)));
    $('#heroPct').textContent = pct.toFixed(0) + '%';
    setTimeout(() => { $('#fundFill').style.width = pct.toFixed(2) + '%'; }, 50);
  }

  /* ── panel rail ───────────────────────────────────────────── */
  function buildRail(){
    const list = $('#zoneList'), chips = $('#zoneChips');
    list.innerHTML = ''; chips.innerHTML = '';
    for (const z of RAIL_ORDER){
      const inZone = cells.filter(c => c.zone === z); if (!inZone.length) continue;
      const free = inZone.filter(c => c.state !== 1);
      const from = Math.min(...inZone.map(c => c.price));
      const avgT = inZone.reduce((a, c) => a + c.t, 0) / inZone.length;
      const b = document.createElement('button');
      b.className = 'zrow';
      b.innerHTML = `<span class="zl"><i class="swatch" style="background:${heatCss(avgT)}"></i>${zoneLabel(z)}</span>
        <span class="zm num">${free.length ? 'from ' + moneyShort(from) : 'sold out'}</span>
        <span class="zadd" role="button" tabindex="0" title="Select every available slot on this panel" aria-label="Select all of ${zoneLabel(z)}">+</span>`;
      const fly = () => { flight.frameCells(inZone); if (ix.mode !== 'select') ix.setMode('select'); sfx?.click(); };
      b.onclick = fly;
      const add = b.querySelector('.zadd');
      add.onclick = (e) => { e.stopPropagation(); ix.selectZone(z); flight.frameCells(inZone); };
      add.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); add.onclick(e); } };
      list.appendChild(b);

      const chip = document.createElement('button');
      chip.className = 'chip'; chip.textContent = zoneLabel(z);
      chip.onclick = () => { ix.selectZone(z); flight.frameCells(inZone); sfx?.click(); };
      chips.appendChild(chip);
    }
  }

  /* ── tooltip ──────────────────────────────────────────────── */
  function showTip(ids, e){
    if (!ids.length || !e || app.mobile){ hideTip(); return; }
    const sel = ids.map(i => cells[i]);
    const sum = sel.reduce((a, c) => a + c.price, 0);
    const allSold = sel.every(c => c.state === 1);
    const zone = sel[0].zone, zones = new Set(sel.map(c => c.zone));
    const area = sel.reduce((a, c) => a + c.area, 0);
    $('.zn', tip).textContent = zones.size > 1 ? `${zoneLabel(zone)} +${zones.size - 1} more` : zoneLabel(zone);
    $('.swatch', tip).style.background = allSold ? PALETTE.sold : heatCss(sel[0].t);
    $('.p', tip).textContent = money(sum);
    const soldN = sel.filter(c => c.state === 1).length;
    let s;
    if (allSold){
      const o = sel[0].owner;
      s = o ? `Sold · <a href="${o.url}" target="_blank" rel="noopener">${o.name} ↗</a>` : 'Sold';
    } else if (sel.length > 1) s = `${sel.length} slots${soldN ? ` · ${soldN} already sold` : ''}`;
    else s = sel[0].state === 2 ? 'In your selection' : 'Available';
    $('.s', tip).innerHTML = s;
    $('.why', tip).textContent = `${cm2(area)} × ${ZONES[zone]?.mult.toFixed(1)} visibility${zones.size > 1 ? ' (avg)' : ''}`;
    tip.classList.toggle('is-sold', allSold);
    tip.classList.add('on');
    const x = Math.min(e.clientX + 16, innerWidth - tip.offsetWidth - 12);
    tip.style.transform = `translate(${x}px, ${e.clientY}px) translateY(-50%)`;
  }
  function hideTip(){ tip.classList.remove('on'); }
  tip.addEventListener('pointerenter', () => tip.classList.add('on'));

  /* ── toast ────────────────────────────────────────────────── */
  function toast(html, ms = 5200){
    toastEl.innerHTML = html; toastEl.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), ms);
  }

  /* ── share ────────────────────────────────────────────────── */
  $('#shareBtn').onclick = async () => {
    const ok = await share.copy();
    toast(ok ? '<b>Link copied.</b> It opens on this exact view with your selection painted in.' : '<b>Link is in the address bar.</b> Copy it from there to share this view.');
  };

  /* ── table view (a11y + transparency) ─────────────────────── */
  const dlg = $('#tableDlg');
  $('#tableBtn').onclick = () => { refreshTable(); dlg.showModal(); };
  $('#tableClose').onclick = () => dlg.close();
  function refreshTable(){
    const body = $('#tableBody'); body.innerHTML = '';
    const total = cells.reduce((a, c) => a + c.price, 0);
    const keys = Object.keys(ZONES).filter(z => cells.some(c => c.zone === z));
    for (const z of keys){
      const inZone = cells.filter(c => c.zone === z);
      const free = inZone.filter(c => c.state !== 1), mine = inZone.filter(c => c.state === 2);
      const ps = inZone.map(c => c.price);
      const tr = document.createElement('tr');
      tr.innerHTML = `<th scope="row">${zoneLabel(z)}<div class="blurb">${ZONES[z].blurb}</div></th>
        <td class="num">×${ZONES[z].mult.toFixed(1)}</td>
        <td class="num">${inZone.length}</td>
        <td class="num">${free.length}</td>
        <td class="num">${money(Math.min(...ps))} – ${money(Math.max(...ps))}</td>
        <td class="num">${money(inZone.reduce((a, c) => a + c.price, 0))}</td>
        <td><button class="mini" ${free.length ? '' : 'disabled'}>${mine.length ? 'Add rest' : 'Select all'}</button></td>`;
      tr.querySelector('button').onclick = () => { ix.selectZone(z); dlg.close(); flight.frameCells(inZone); };
      body.appendChild(tr);
    }
    $('#tableFoot').textContent = `${cells.length.toLocaleString('en-AU')} slots · ${money(total)} AUD incl. GST · price = area × visibility × $${Math.round(app.slotMeta.rate).toLocaleString('en-AU')}/m²`;
  }

  /* ── onboarding hand ──────────────────────────────────────── */
  function onboard(){
    let seen = false; try { seen = !!localStorage.getItem('lambo.onboarded'); } catch {}
    if (seen || app.mobile) return;
    const el = $('#onboard'); el.classList.add('on');
    const off = () => { el.classList.remove('on'); try { localStorage.setItem('lambo.onboarded', '1'); } catch {} };
    setTimeout(off, 6500);
    ['pointerdown', 'keydown', 'wheel'].forEach(ev => addEventListener(ev, off, { once: true, passive: true }));
  }

  function dismissHint(){ $('#hint').classList.add('gone'); }
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => setTimeout(dismissHint, 4000), { once: true }));
  setTimeout(dismissHint, 16000);

  /* ── artwork upload ───────────────────────────────────────── */
  let art = null;
  function artSpecLine(n){
    const el = $('#artSpec');
    if (!art || !n){ el.textContent = ''; return; }
    const spec = art.specFor();
    el.textContent = spec ? `Print spec for this patch: ${spec.text}.` : '';
  }
  function wireArtwork(artwork){
    art = artwork;
    $('#artFile').onchange = async (e) => { await art.fromFile(e.target.files?.[0]); e.target.value = ''; $('#artClear').hidden = !art.placed; };
    $('#artClear').onclick = () => { art.clear(); $('#artClear').hidden = true; };
    $('#artLabel').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); $('#artFile').click(); } };
  }

  /* mobile cart sheet */
  $('#cartHead').onclick = () => $('#cart').classList.toggle('open');

  /* ── info pages: the bits that need live data ─────────────── */
  function buildPages(){
    const total = cells.reduce((a, c) => a + c.price, 0);
    $('#priceTarget').textContent = moneyShort(total);
    $('#priceRate').textContent = `$${Math.round(app.slotMeta.rate).toLocaleString('en-AU')} / m²`;
    const grid = $('#priceGrid'); grid.innerHTML = '';
    const zs = Object.keys(ZONES).filter(z => cells.some(c => c.zone === z)).sort((a, b) => ZONES[b].mult - ZONES[a].mult);
    zs.forEach((z, i) => {
      const inZone = cells.filter(c => c.zone === z), free = inZone.filter(c => c.state !== 1);
      const ps = inZone.map(c => c.price);
      const b = document.createElement('button');
      b.className = 'pcard r' + (free.length ? '' : ' sold'); b.style.setProperty('--i', 3 + Math.min(i, 6));
      b.innerHTML = `<span class="pz">${zoneLabel(z)}<span class="pm">×${ZONES[z].mult.toFixed(1)}</span></span>
        <span class="pp num">${money(Math.min(...ps))} – ${money(Math.max(...ps))} per slot</span>
        <span class="pb">${ZONES[z].blurb} ${free.length ? `${free.length} of ${inZone.length} available.` : 'Sold out.'}</span>`;
      b.onclick = () => { location.hash = '#/'; setTimeout(() => { flight.frameCells(inZone); ix.setMode('select'); }, 250); sfx?.click(); };
      grid.appendChild(b);
    });
    $('#priceTable').onclick = () => { refreshTable(); dlg.showModal(); sfx?.click(); };

    const ag = $('#advGrid'); ag.innerHTML = '';
    campaigns.filter(c => c.slots).sort((a, b) => b.value - a.value).forEach((camp, i) => {
      const a = document.createElement('a');
      a.className = 'acard r'; a.style.setProperty('--i', 3 + Math.min(i, 6));
      a.href = camp.url; a.target = '_blank'; a.rel = 'noopener';
      const c = drawSticker(camp, 384, 192); c.className = 'sticker';
      a.appendChild(c);
      const t = document.createElement('div');
      t.innerHTML = `<div class="an">${camp.name}</div><div class="az">${zoneLabel(camp.zone)} · ${camp.slots} slots · ${money(camp.value)}</div>`;
      a.appendChild(t); ag.appendChild(a);
    });
    const you = document.createElement('a'); you.className = 'acard you r'; you.style.setProperty('--i', 8); you.href = '#/'; you.textContent = '+ Your brand here';
    ag.appendChild(you);
  }

  return { reflectMode, reflectBrush, setView, updateCart, updateFunding, buildRail, showTip, hideTip, toast, refreshTable, onboard, wireArtwork, buildPages };
}
