// Solicitud de materiales — página pública para las sucursales (sin usuario ni contraseña).
// Solo lee el catálogo público (nombres de materiales y sucursales) y crea solicitudes; las reglas de Firestore lo limitan a eso.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getFirestore, doc, getDoc, collection, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

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
const buscar = txt => { const t = norm(txt); return t ? CAT.find(p => norm(p.n) === t || norm(p.c) === t || norm(`${p.c} · ${p.n}`) === t) || null : null; };

function fila(i) {
  return `<tr><td class="c">${i + 1}</td><td><input data-f="desc" list="dlCat" maxlength="120" placeholder="Escribe o elige el material" aria-label="Material ${i + 1}"></td>
    <td class="w-cant"><input data-f="cant" type="number" min="0" step="any" inputmode="decimal" aria-label="Cantidad ${i + 1}"></td><td class="w-uni" data-c="uni"></td>
    <td><button type="button" class="x" data-quitar aria-label="Quitar material ${i + 1}">×</button></td></tr>`;
}
function renumerar() { [...$('sItems').rows].forEach((r, i) => { r.cells[0].textContent = i + 1; }); }
function agregar(n = 1) { for (let k = 0; k < n; k++) $('sItems').insertAdjacentHTML('beforeend', fila($('sItems').rows.length)); }

async function iniciar() {
  try {
    const s = await getDoc(doc(db, 'publico', 'catalogo'));
    const d = s.exists() ? s.data() : {};
    CAT = d.items || []; CENTROS = d.centros || [];
  } catch (e) { $('carga').className = 'aviso error'; $('carga').textContent = 'No se pudo conectar. Revisa tu internet y vuelve a cargar la página.'; return; }
  $('sCentro').innerHTML = '<option value="">— Elegir —</option>' + CENTROS.map(c => `<option value="${esc(c.v)}">${esc(c.t)}</option>`).join('');
  $('dlCat').innerHTML = CAT.map(p => `<option value="${esc(etq(p))}">`).join('');
  try { const g = localStorage.getItem('solicitud-datos'); if (g) { const x = JSON.parse(g); if (x.centro) $('sCentro').value = x.centro; if (x.nombre) $('sNombre').value = x.nombre; } } catch (e) { }
  $('sFecha').value = hoy();
  agregar(5);
  $('carga').hidden = true; $('fSol').hidden = false;
  pintarMis();
}

$('sAdd').addEventListener('click', () => { agregar(); $('sItems').lastElementChild.querySelector('input').focus(); });
$('sItems').addEventListener('click', e => { if (e.target.closest('[data-quitar]')) { e.target.closest('tr').remove(); if (!$('sItems').rows.length) agregar(); renumerar(); } });
$('sItems').addEventListener('input', e => {
  if (e.target.dataset.f !== 'desc') return;
  const p = buscar(e.target.value); e.target.closest('tr').querySelector('[data-c="uni"]').textContent = p ? p.u : '';
});

$('fSol').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = t => { $('sMsg').hidden = !t; $('sMsg').textContent = t || ''; };
  const centro = $('sCentro').value, nombre = limpio($('sNombre').value).toUpperCase(), fecha = $('sFecha').value;
  const items = [...$('sItems').rows].map(r => {
    const desc = limpio(r.querySelector('[data-f="desc"]').value).toUpperCase(), cant = Number(r.querySelector('[data-f="cant"]').value) || 0, p = buscar(desc);
    return { desc: p ? p.n : desc, prodId: p ? p.i : null, codigo: p ? p.c : '', unidad: p ? p.u : '', cant };
  }).filter(x => x.desc || x.cant);
  if (!centro) return msg('Elige tu sucursal o centro de costo.');
  if (nombre.length < 3) return msg('Escribe tu nombre.');
  if (!fecha) return msg('Falta la fecha de solicitud.');
  if (!items.length) return msg('Agrega al menos un material.');
  if (items.some(x => !x.desc)) return msg('Hay una cantidad sin descripción del material.');
  if (items.some(x => !(x.cant > 0))) return msg('Escribe la cantidad de cada material.');
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
      tx.set(ref, { numero: n, fecha, mes: fecha.slice(0, 7), centro, centroNombre: cNombre, solicitante: nombre, nota: limpio($('sNota').value), items, estado: 'PENDIENTE', creadoMs: Date.now(), creado: serverTimestamp() });
      return n;
    });
    try {
      localStorage.setItem('solicitud-datos', JSON.stringify({ centro, nombre }));
      const mis = JSON.parse(localStorage.getItem(CLAVE_MIS) || '[]'); mis.unshift(ref.id); localStorage.setItem(CLAVE_MIS, JSON.stringify(mis.slice(0, 15)));
    } catch (e2) { }
    $('sOk').hidden = false;
    $('sOk').innerHTML = `<b>Solicitud N.º ${numero} enviada.</b> Logística ya la puede ver. Guarda este número para cualquier consulta.`;
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
  $('misFilas').innerHTML = docs.map(s => `<tr><td><b>${s.numero}</b></td><td>${fmtF(s.fecha)}</td><td>${esc(s.centroNombre || s.centro)}</td><td>${(s.items || []).length}</td><td><span class="pill ${esc(s.estado)}">${esc(s.estado === 'ATENDIDA' ? 'ENTREGADA' : s.estado)}</span>${s.estado === 'ATENDIDA' && s.fechaEntrega ? ` <small class="nota">${fmtF(s.fechaEntrega)}</small>` : ''}${s.estado === 'RECHAZADA' && s.motivo ? `<br><small class="nota">${esc(s.motivo)}</small>` : ''}</td></tr>`).join('');
}

iniciar();
