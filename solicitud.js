// Solicitud de materiales — página pública para las sucursales (sin usuario ni contraseña).
// Solo lee el catálogo público (nombres de materiales y sucursales) y crea solicitudes; las reglas de Firestore lo limitan a eso.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, collection, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { CENTROS_COSTO } from './centros.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const limpio = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const norm = s => limpio(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtF = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const CLAVE_MIS = 'solicitudes-enviadas';

const db = getFirestore(initializeApp(firebaseConfig));
let CAT = [], CENTROS = [];
const etq = p => `${p.n}`;
const tipoSel = () => document.querySelector('input[name="sTipo"]:checked')?.value || 'ESCRITORIO';
// Materiales del tipo elegido (k: E = escritorio, L = limpieza, vacío = ambos)
const catTipo = () => { const k = tipoSel() === 'LIMPIEZA' ? 'L' : 'E'; return CAT.filter(p => !p.k || p.k === k); };
function aplicarTipo() {
  const lim = tipoSel() === 'LIMPIEZA';
  $('sTit').textContent = `FORMATO DE CONSUMO DE MATERIALES DE ${lim ? 'LIMPIEZA' : 'ESCRITORIO'}`;
  $('sNota').placeholder = lim ? 'Ej.: lejía en galonera, bolsas grandes' : 'Ej.: plumón delgado, vasos pequeños';
  $('dlCat').innerHTML = catTipo().map(p => `<option value="${esc(etq(p))}">`).join('');
}
const buscar = txt => { const t = norm(txt); return t ? catTipo().find(p => norm(p.n) === t || norm(p.c) === t || norm(`${p.c} · ${p.n}`) === t) || null : null; };

function fila(i) {
  return `<tr><td class="c">${i + 1}</td><td><input data-f="desc" list="dlCat" maxlength="120" placeholder="Escribe o elige el material" aria-label="Material ${i + 1}"></td>
    <td class="w-cant"><input data-f="cant" type="number" min="0" step="any" inputmode="decimal" aria-label="Cantidad ${i + 1}"></td><td class="w-uni"><input data-f="uni" list="dlUni" maxlength="20" placeholder="Unidad" aria-label="Unidad ${i + 1}"></td>
    <td><button type="button" class="x" data-quitar aria-label="Quitar material ${i + 1}">×</button></td></tr>`;
}
function renumerar() { [...$('sItems').rows].forEach((r, i) => { r.cells[0].textContent = i + 1; }); }
function agregar(n = 1) { for (let k = 0; k < n; k++) $('sItems').insertAdjacentHTML('beforeend', fila($('sItems').rows.length)); }

async function iniciar() {
  try {
    const s = await getDoc(doc(db, 'publico', 'catalogo'));
    const d = s.exists() ? s.data() : {};
    CAT = d.items || []; CENTROS = d.centros || [];
    // Si el catálogo todavía no tiene los centros de costo oficiales (código · sucursal), se usan los del sistema
    if (CENTROS.filter(c => /^\d+$/.test(c.v) && c.t !== c.v).length < 2) CENTROS = CENTROS_COSTO.map(c => ({ v: c.codigo, t: `${c.codigo} · ${c.nombre}` }));
  } catch (e) { $('carga').className = 'aviso error'; $('carga').textContent = 'No se pudo conectar. Revisa tu internet y vuelve a cargar la página.'; return; }
  $('sCentro').innerHTML = '<option value="">— Elegir —</option>' + CENTROS.map(c => `<option value="${esc(c.v)}">${esc(c.t)}</option>`).join('');
  const pedido = new URLSearchParams(location.search).get('tipo');
  if (pedido && /limpieza/i.test(pedido)) document.querySelector('input[value="LIMPIEZA"]').checked = true;
  aplicarTipo();
  document.querySelectorAll('input[name="sTipo"]').forEach(r => r.addEventListener('change', () => { aplicarTipo(); [...$('sItems').rows].forEach(tr => { const p = buscar(tr.querySelector('[data-f="desc"]').value), u = tr.querySelector('[data-f="uni"]'); if (p && p.u && (!u.value || u.dataset.auto)) { u.value = p.u; u.dataset.auto = '1'; } }); }));
  try { const g = localStorage.getItem('solicitud-datos'); if (g) { const x = JSON.parse(g); if (x.centro) $('sCentro').value = x.centro; if (x.nombre) $('sNombre').value = x.nombre; } } catch (e) { }
  $('sFecha').value = hoy();
  agregar(5);
  $('carga').hidden = true; $('fSol').hidden = false;
  pintarMis();
}

$('sAdd').addEventListener('click', () => { agregar(); $('sItems').lastElementChild.querySelector('input').focus(); });
$('sItems').addEventListener('click', e => { if (e.target.closest('[data-quitar]')) { e.target.closest('tr').remove(); if (!$('sItems').rows.length) agregar(); renumerar(); } });
$('sItems').addEventListener('input', e => {
  if (e.target.dataset.f === 'uni') { delete e.target.dataset.auto; return; }
  if (e.target.dataset.f !== 'desc') return;
  const p = buscar(e.target.value), u = e.target.closest('tr').querySelector('[data-f="uni"]');
  if (p && p.u && (!u.value || u.dataset.auto)) { u.value = p.u; u.dataset.auto = '1'; }
});

$('fSol').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = t => { $('sMsg').hidden = !t; $('sMsg').textContent = t || ''; };
  const centro = $('sCentro').value, nombre = limpio($('sNombre').value).toUpperCase(), fecha = $('sFecha').value;
  const items = [...$('sItems').rows].map(r => {
    const desc = limpio(r.querySelector('[data-f="desc"]').value).toUpperCase(), cant = Number(r.querySelector('[data-f="cant"]').value) || 0, p = buscar(desc);
    const unidad = limpio(r.querySelector('[data-f="uni"]').value).toUpperCase();
    return { desc: p ? p.n : desc, prodId: p ? p.i : null, codigo: p ? p.c : '', unidad, cant };
  }).filter(x => x.desc || x.cant);
  if (!centro) return msg('Elige tu sucursal o centro de costo.');
  if (nombre.length < 3) return msg('Escribe tu nombre.');
  if (!fecha) return msg('Falta la fecha de solicitud.');
  if (!items.length) return msg('Agrega al menos un material.');
  if (items.some(x => !x.desc)) return msg('Hay una cantidad sin descripción del material.');
  if (items.some(x => !(x.cant > 0))) return msg('Escribe la cantidad de cada material.');
  if (items.some(x => !x.unidad)) return msg('Escribe la unidad de cada material (UND, PAQUETE, CAJA…).');
  if (items.length > 40) return msg('Máximo 40 materiales por solicitud.');
  msg('');
  const b = $('sEnviar'); b.disabled = true; b.textContent = 'Enviando…';
  try {
    const ref = doc(collection(db, 'solicitudes'));
    const cNombre = CENTROS.find(c => c.v === centro)?.t || centro;
    const numero = await runTransaction(db, async tx => {
      const cRef = doc(db, 'publico', 'contador'), c = await tx.get(cRef);
      const n = (c.exists() ? c.data().n || 0 : 0) + 1;
      tx.set(cRef, { n });
      tx.set(ref, { numero: n, tipo: tipoSel(), fecha, mes: fecha.slice(0, 7), centro, centroNombre: cNombre, solicitante: nombre, nota: limpio($('sNota').value), items, estado: 'PENDIENTE', creadoMs: Date.now(), creado: serverTimestamp() });
      return n;
    });
    try {
      localStorage.setItem('solicitud-datos', JSON.stringify({ centro, nombre }));
      const mis = JSON.parse(localStorage.getItem(CLAVE_MIS) || '[]'); mis.unshift(ref.id); localStorage.setItem(CLAVE_MIS, JSON.stringify(mis.slice(0, 15)));
    } catch (e2) { }
    $('sOk').hidden = false;
    $('sOk').innerHTML = `<b>Solicitud N.º ${numero} (${tipoSel() === 'LIMPIEZA' ? 'limpieza' : 'escritorio'}) enviada.</b> Logística ya la puede ver. Guarda este número para cualquier consulta.`;
    $('sItems').innerHTML = ''; agregar(5); $('sNota').value = ''; $('sFecha').value = hoy();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    pintarMis();
  } catch (err) { msg('No se pudo enviar: ' + (err?.message || err) + '. Inténtalo de nuevo.'); }
  b.disabled = false; b.textContent = 'Enviar solicitud';
});

async function pintarMis() {
  let ids = []; try { ids = JSON.parse(localStorage.getItem(CLAVE_MIS) || '[]'); } catch (e) { }
  if (!ids.length) return;
  const docs = (await Promise.all(ids.map(id => getDoc(doc(db, 'solicitudes', id)).catch(() => null)))).filter(s => s && s.exists()).map(s => s.data());
  if (!docs.length) return;
  $('misBox').hidden = false;
  $('misFilas').innerHTML = docs.map(s => `<tr><td><b>${s.numero}</b></td><td>${fmtF(s.fecha)}</td><td>${s.tipo === 'LIMPIEZA' ? 'Limpieza' : 'Escritorio'}</td><td>${esc(s.centroNombre || s.centro)}</td><td>${(s.items || []).length}</td><td><span class="pill ${esc(s.estado)}">${esc(s.estado === 'ATENDIDA' ? 'ENTREGADA' : s.estado)}</span>${s.estado === 'ATENDIDA' && s.fechaEntrega ? ` <small class="nota">${fmtF(s.fechaEntrega)}</small>` : ''}${s.estado === 'RECHAZADA' && s.motivo ? `<br><small class="nota">${esc(s.motivo)}</small>` : ''}</td></tr>`).join('');
}

iniciar();
