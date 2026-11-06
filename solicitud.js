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

const db = getFirestore(initializeApp(firebaseConfig));
let CAT = [], CENTROS = [];
const etq = p => `${p.n}`;
// Dos cuadros en la misma página: útiles de escritorio arriba y materiales de limpieza abajo
const BLOQUES = [...document.querySelectorAll('.bloque')];
const cuerpo = b => b.querySelector('[data-items]');
const dlDe = b => b.dataset.tipo === 'LIMPIEZA' ? 'dlCatL' : 'dlCatE';
// Materiales de cada tipo (k: E = escritorio, L = limpieza, vacío = ambos)
const catDe = tipo => { const k = tipo === 'LIMPIEZA' ? 'L' : 'E'; return CAT.filter(p => !p.k || p.k === k); };
const buscar = (txt, tipo) => { const t = norm(txt); return t ? catDe(tipo).find(p => norm(p.n) === t || norm(p.c) === t || norm(`${p.c} · ${p.n}`) === t) || null : null; };

function fila(b, i) {
  const q = b.dataset.tipo === 'LIMPIEZA' ? 'de limpieza ' : 'de escritorio ';
  return `<tr><td class="c">${i + 1}</td><td><input data-f="desc" list="${dlDe(b)}" maxlength="120" placeholder="Escribe o elige el material" aria-label="Material ${q}${i + 1}"></td>
    <td class="w-cant"><input data-f="cant" type="number" min="0" step="any" inputmode="decimal" aria-label="Cantidad ${q}${i + 1}"></td><td class="w-uni"><input data-f="uni" list="dlUni" maxlength="20" placeholder="Unidad" aria-label="Unidad ${q}${i + 1}"></td>
    <td><button type="button" class="x" data-quitar aria-label="Quitar material ${q}${i + 1}">×</button></td></tr>`;
}
function renumerar(b) { [...cuerpo(b).rows].forEach((r, i) => { r.cells[0].textContent = i + 1; }); }
function agregar(b, n = 1) { for (let k = 0; k < n; k++) cuerpo(b).insertAdjacentHTML('beforeend', fila(b, cuerpo(b).rows.length)); }
function limpiarBloques() { BLOQUES.forEach(b => { cuerpo(b).innerHTML = ''; agregar(b, 3); }); }

async function iniciar() {
  try {
    const s = await getDoc(doc(db, 'publico', 'catalogo'));
    const d = s.exists() ? s.data() : {};
    CAT = d.items || []; CENTROS = d.centros || [];
    // Si el catálogo todavía no tiene los centros de costo oficiales (código · sucursal), se usan los del sistema
    if (CENTROS.filter(c => /^\d+$/.test(c.v) && c.t !== c.v).length < 2) CENTROS = CENTROS_COSTO.map(c => ({ v: c.codigo, t: `${c.codigo} · ${c.nombre}` }));
  } catch (e) { $('carga').className = 'aviso error'; $('carga').textContent = 'No se pudo conectar. Revisa tu internet y vuelve a cargar la página.'; return; }
  $('sCentro').innerHTML = '<option value="">— Elegir —</option>' + CENTROS.map(c => `<option value="${esc(c.v)}">${esc(c.t)}</option>`).join('');
  $('dlCatE').innerHTML = catDe('ESCRITORIO').map(p => `<option value="${esc(etq(p))}">`).join('');
  $('dlCatL').innerHTML = catDe('LIMPIEZA').map(p => `<option value="${esc(etq(p))}">`).join('');
  try { const g = localStorage.getItem('solicitud-datos'); if (g) { const x = JSON.parse(g); if (x.centro) $('sCentro').value = x.centro; if (x.nombre) $('sNombre').value = x.nombre; } } catch (e) { }
  $('sFecha').value = hoy();
  limpiarBloques();
  $('carga').hidden = true; $('fSol').hidden = false;
}

BLOQUES.forEach(b => {
  b.querySelector('[data-add]').addEventListener('click', () => { agregar(b); cuerpo(b).lastElementChild.querySelector('input').focus(); });
  cuerpo(b).addEventListener('click', e => { if (e.target.closest('[data-quitar]')) { e.target.closest('tr').remove(); if (!cuerpo(b).rows.length) agregar(b); renumerar(b); } });
  cuerpo(b).addEventListener('input', e => {
    if (e.target.dataset.f === 'uni') { delete e.target.dataset.auto; return; }
    if (e.target.dataset.f !== 'desc') return;
    const p = buscar(e.target.value, b.dataset.tipo), u = e.target.closest('tr').querySelector('[data-f="uni"]');
    if (p && p.u && (!u.value || u.dataset.auto)) { u.value = p.u; u.dataset.auto = '1'; }
  });
});
const leerBloque = b => [...cuerpo(b).rows].map(r => {
  const desc = limpio(r.querySelector('[data-f="desc"]').value).toUpperCase(), cant = Number(r.querySelector('[data-f="cant"]').value) || 0, p = buscar(desc, b.dataset.tipo);
  const unidad = limpio(r.querySelector('[data-f="uni"]').value).toUpperCase();
  return { desc: p ? p.n : desc, prodId: p ? p.i : null, codigo: p ? p.c : '', unidad, cant };
}).filter(x => x.desc || x.cant);

$('fSol').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = t => { $('sMsg').hidden = !t; $('sMsg').textContent = t || ''; };
  const centro = $('sCentro').value, nombre = limpio($('sNombre').value).toUpperCase(), fecha = $('sFecha').value;
  const pedidos = BLOQUES.map(b => ({ tipo: b.dataset.tipo, items: leerBloque(b) })).filter(x => x.items.length);
  if (!centro) return msg('Elige tu sucursal o centro de costo.');
  if (nombre.length < 3) return msg('Escribe tu nombre.');
  if (!fecha) return msg('Falta la fecha de solicitud.');
  if (!pedidos.length) return msg('Escribe al menos un material en útiles de escritorio o en materiales de limpieza.');
  for (const x of pedidos) {
    const q = x.tipo === 'LIMPIEZA' ? 'En materiales de limpieza' : 'En útiles de escritorio';
    if (x.items.some(i => !i.desc)) return msg(`${q} hay una cantidad sin descripción del material.`);
    if (x.items.some(i => !(i.cant > 0))) return msg(`${q} falta la cantidad de algún material.`);
    if (x.items.length > 40) return msg(`${q} hay más de 40 materiales.`);
  }
  msg('');
  const b = $('sEnviar'); b.disabled = true; b.textContent = 'Enviando…';
  const hechos = [];
  try {
    const cNombre = CENTROS.find(c => c.v === centro)?.t || centro, nota = limpio($('sNota').value);
    for (const x of pedidos) { // cada cuadro es su propia solicitud, con su número
      const ref = doc(collection(db, 'solicitudes'));
      const numero = await runTransaction(db, async tx => {
        const cRef = doc(db, 'publico', 'contador'), c = await tx.get(cRef);
        const n = (c.exists() ? c.data().n || 0 : 0) + 1;
        tx.set(cRef, { n });
        tx.set(ref, { numero: n, tipo: x.tipo, fecha, mes: fecha.slice(0, 7), centro, centroNombre: cNombre, solicitante: nombre, nota, items: x.items, estado: 'PENDIENTE', creadoMs: Date.now(), creado: serverTimestamp() });
        return n;
      });
      hechos.push({ ...x, numero, id: ref.id });
      const bl = BLOQUES.find(y => y.dataset.tipo === x.tipo); cuerpo(bl).innerHTML = ''; agregar(bl, 3); // ya enviado: se vacía ese cuadro
    }
    $('sNota').value = ''; $('sFecha').value = hoy();
  } catch (err) { msg('No se pudo enviar' + (hechos.length ? ' todo' : '') + ': ' + (err?.message || err) + '. Inténtalo de nuevo.'); }
  if (hechos.length) {
    try {
      localStorage.setItem('solicitud-datos', JSON.stringify({ centro, nombre }));
    } catch (e2) { }
    $('sOk').hidden = false;
    $('sOk').innerHTML = `<b>${hechos.map(h => `Solicitud N.º ${h.numero} (${h.tipo === 'LIMPIEZA' ? 'limpieza' : 'escritorio'})`).join(' y ')} enviada${hechos.length > 1 ? 's' : ''}.</b> Logística ya la${hechos.length > 1 ? 's' : ''} puede ver. Guarda ${hechos.length > 1 ? 'estos números' : 'este número'} para cualquier consulta.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  b.disabled = false; b.textContent = 'Enviar solicitud';
});

iniciar();
