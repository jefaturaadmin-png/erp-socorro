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
// Materiales de cada tipo (k: E = escritorio, L = limpieza, vacío = ambos)
const catDe = tipo => { const k = tipo === 'LIMPIEZA' ? 'L' : 'E'; return CAT.filter(p => !p.k || p.k === k); };
const buscar = (txt, tipo) => { const t = norm(txt); return t ? catDe(tipo).find(p => norm(p.n) === t || norm(p.c) === t || norm(`${p.c} · ${p.n}`) === t) || null : null; };

function fila(b, i) {
  const q = b.dataset.tipo === 'LIMPIEZA' ? 'de limpieza ' : 'de escritorio ';
  return `<tr><td class="c">${i + 1}</td><td><input data-f="desc" autocomplete="off" maxlength="120" placeholder="Escribe para buscar el material" aria-label="Material ${q}${i + 1}"></td>
    <td class="w-cant"><input data-f="cant" autocomplete="off" type="number" min="0" step="any" inputmode="decimal" aria-label="Cantidad ${q}${i + 1}"></td><td class="w-uni"><input data-f="uni" autocomplete="off" maxlength="20" placeholder="Unidad" aria-label="Unidad ${q}${i + 1}"></td>
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
  try { const g = localStorage.getItem('solicitud-datos'); if (g) { const x = JSON.parse(g); if (x.centro) $('sCentro').value = x.centro; if (x.nombre) $('sNombre').value = x.nombre; } } catch (e) { }
  ponerFecha();
  limpiarBloques();
  $('carga').hidden = true; $('fSol').hidden = false;
}

BLOQUES.forEach(b => {
  b.querySelector('[data-add]').addEventListener('click', () => { agregar(b); cuerpo(b).lastElementChild.querySelector('input').focus(); });
  cuerpo(b).addEventListener('click', e => { if (e.target.closest('[data-quitar]')) { e.target.closest('tr').remove(); if (!cuerpo(b).rows.length) agregar(b); renumerar(b); } });
  cuerpo(b).addEventListener('input', e => {
    if (e.target.dataset.f === 'uni') { delete e.target.dataset.auto; abrirSug(e.target, b); return; }
    if (e.target.dataset.f !== 'desc') return;
    abrirSug(e.target, b);
    const p = buscar(e.target.value, b.dataset.tipo), u = e.target.closest('tr').querySelector('[data-f="uni"]');
    if (p && p.u && (!u.value || u.dataset.auto)) { u.value = p.u; u.dataset.auto = '1'; }
  });
});
// Fecha de solicitud: la del día, no se puede cambiar
function ponerFecha() { $('sFecha').value = hoy().split('-').reverse().join('/'); }

// Buscador: mientras se escribe aparecen solo los materiales (o unidades) que coinciden; no es una lista desplegable
const UNIDADES = ['UND', 'PAQUETE', 'CAJA', 'ROLLO', 'BOLSA', 'DOCENA', 'CIENTO', 'MILLAR', 'PAR', 'JUEGO', 'FRASCO', 'BOTELLA', 'GALÓN', 'LITRO', 'KG', 'METRO'];
const SUG = { el: null, inp: null, b: null, ops: [], act: -1 };
SUG.el = document.createElement('div'); SUG.el.className = 'sug'; SUG.el.hidden = true; SUG.el.setAttribute('role', 'listbox'); document.body.appendChild(SUG.el);
function cerrarSug() { SUG.el.hidden = true; SUG.inp = null; SUG.ops = []; SUG.act = -1; }
function abrirSug(inp, b) {
  const t = norm(inp.value), palabras = t.split(' ').filter(Boolean), esUni = inp.dataset.f === 'uni';
  if (!palabras.length) return cerrarSug();
  const base = esUni ? UNIDADES.map(u => ({ n: u })) : catDe(b.dataset.tipo);
  const ops = base.filter(p => { const n = norm(p.n); return palabras.every(w => n.includes(w)); })
    .sort((x, y) => (norm(y.n).startsWith(t) - norm(x.n).startsWith(t)) || x.n.localeCompare(y.n, 'es')).slice(0, 10);
  if (ops.length === 1 && norm(ops[0].n) === t) return cerrarSug(); // ya está escrito completo
  Object.assign(SUG, { inp, b, ops, act: ops.length ? 0 : -1 });
  // resalta en negrita lo que coincide con lo escrito
  const marca = n => {
    const nn = norm(n); if (nn.length !== n.length) return esc(n);
    const on = Array(n.length).fill(false);
    palabras.forEach(w => { const i = nn.indexOf(w); if (i >= 0) for (let k = i; k < i + w.length; k++) on[k] = true; });
    let h = '', ab = false;
    for (let k = 0; k < n.length; k++) { if (on[k] !== ab) { h += ab ? '</b>' : '<b>'; ab = on[k]; } h += esc(n[k]); }
    return h + (ab ? '</b>' : '');
  };
  SUG.el.innerHTML = ops.length ? ops.map((p, i) => `<div role="option" data-i="${i}" class="${i === SUG.act ? 'act' : ''}"><span>${marca(p.n)}</span>${p.u ? `<small>${esc(p.u)}</small>` : ''}</div>`).join('')
    : (esUni ? '' : '<div class="vacia">No está en la lista: se enviará tal como lo escribiste</div>');
  if (!SUG.el.innerHTML) return cerrarSug();
  const r = inp.getBoundingClientRect();
  Object.assign(SUG.el.style, { left: (r.left + scrollX) + 'px', top: (r.bottom + scrollY + 2) + 'px', width: Math.max(r.width, esUni ? 140 : 280) + 'px' });
  SUG.el.hidden = false;
}
function elegirSug(i) {
  const p = SUG.ops[i], inp = SUG.inp; if (!p || !inp) return;
  inp.value = p.n;
  if (inp.dataset.f === 'uni') delete inp.dataset.auto;
  else { const u = inp.closest('tr').querySelector('[data-f="uni"]'); if (p.u && (!u.value || u.dataset.auto)) { u.value = p.u; u.dataset.auto = '1'; } }
  cerrarSug();
  inp.closest('tr').querySelector('[data-f="cant"]').focus(); // sigue con la cantidad
}
function sugTeclado(e, inp) {
  if (SUG.el.hidden || SUG.inp !== inp) return false;
  if (e.key === 'Escape') { e.preventDefault(); cerrarSug(); return true; }
  if (!SUG.ops.length) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); SUG.act = (SUG.act + (e.key === 'ArrowDown' ? 1 : -1) + SUG.ops.length) % SUG.ops.length;
    [...SUG.el.children].forEach((d, i) => d.classList.toggle('act', i === SUG.act)); SUG.el.children[SUG.act]?.scrollIntoView({ block: 'nearest' });
    return true;
  }
  if ((e.key === 'Enter' || e.key === 'Tab') && SUG.act >= 0) { e.preventDefault(); elegirSug(SUG.act); return true; }
  return false;
}
SUG.el.addEventListener('mousedown', e => { const d = e.target.closest('[data-i]'); e.preventDefault(); if (d) elegirSug(+d.dataset.i); });
document.addEventListener('focusin', e => { if (SUG.inp && e.target !== SUG.inp) cerrarSug(); });
window.addEventListener('resize', cerrarSug);

// Teclado como en Excel: ↑ ↓ (o Enter) pasan a la misma columna de la fila de arriba o de abajo, también entre cuadros
const todasLasFilas = () => BLOQUES.flatMap(b => [...cuerpo(b).rows]);
$('fSol').addEventListener('keydown', e => {
  const inp = e.target.closest('[data-items] input');
  if (!inp) { if (e.key === 'Enter' && e.target.tagName === 'INPUT') e.preventDefault(); return; } // Enter no envía sin querer
  if (sugTeclado(e, inp)) return;
  if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  const filas = todasLasFilas(), i = filas.indexOf(inp.closest('tr')), j = e.key === 'ArrowUp' ? i - 1 : i + 1;
  if (j < 0) return;
  if (j >= filas.length) { const b = inp.closest('.bloque'); agregar(b); }
  const destino = todasLasFilas()[j].querySelector(`[data-f="${inp.dataset.f}"]`);
  destino.focus(); destino.select?.();
});
const leerBloque = b => [...cuerpo(b).rows].map(r => {
  const desc = limpio(r.querySelector('[data-f="desc"]').value).toUpperCase(), cant = Number(r.querySelector('[data-f="cant"]').value) || 0, p = buscar(desc, b.dataset.tipo);
  const unidad = limpio(r.querySelector('[data-f="uni"]').value).toUpperCase();
  return { desc: p ? p.n : desc, prodId: p ? p.i : null, codigo: p ? p.c : '', unidad, cant };
}).filter(x => x.desc || x.cant);

$('fSol').addEventListener('submit', async e => {
  e.preventDefault();
  const msg = t => { $('sMsg').hidden = !t; $('sMsg').textContent = t || ''; };
  const centro = $('sCentro').value, nombre = limpio($('sNombre').value).toUpperCase(), fecha = hoy(); // siempre la fecha del día en que se envía
  const pedidos = BLOQUES.map(b => ({ tipo: b.dataset.tipo, items: leerBloque(b) })).filter(x => x.items.length);
  if (!centro) return msg('Elige tu sucursal o centro de costo.');
  if (nombre.length < 3) return msg('Escribe tu nombre.');
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
    $('sNota').value = ''; ponerFecha();
  } catch (err) { msg('No se pudo enviar' + (hechos.length ? ' todo' : '') + ': ' + (err?.message || err) + '. Inténtalo de nuevo.'); }
  if (hechos.length) {
    try {
      localStorage.setItem('solicitud-datos', JSON.stringify({ centro, nombre }));
    } catch (e2) { }
    $('sOk').hidden = false;
    $('sOk').innerHTML = `<b>${hechos.map(h => `Solicitud N.º ${h.numero} (${h.tipo === 'LIMPIEZA' ? 'limpieza' : 'escritorio'})`).join(' y ')} enviada${hechos.length > 1 ? 's' : ''}.</b> Administración ya la${hechos.length > 1 ? 's' : ''} puede ver. Guarda ${hechos.length > 1 ? 'estos números' : 'este número'} para cualquier consulta.`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  b.disabled = false; b.textContent = 'Enviar solicitud';
});

iniciar();
