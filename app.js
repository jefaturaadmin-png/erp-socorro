// ERP Socorro — Farmacia Socorro
// GitHub Pages + Firebase (Auth + Firestore). Lectura de comprobantes con Google Gemini.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, runTransaction, writeBatch, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ================= Configuración fija ================= */
const DOMINIO = '@erp-socorro.example.com'; // los usuarios solo escriben su nombre de usuario
const SHEET_UNIFORMES = '1VG8CztNg3nO1oB1tIUCTnVIEm0_qPuwUVl7hoVF9WWA';
const IGV = 0.18;
const ROLES = ['ADMIN', 'LOGISTICA', 'COMPRAS', 'ALMACEN', 'RRHH', 'GERENCIA', 'CONSULTA'];
const MODULOS = [
  { id: 'inicio', nombre: 'Inicio', grupo: 'General' },
  { id: 'servicios', nombre: 'Ingreso de servicios', grupo: 'Logística' },
  { id: 'compras', nombre: 'Ingreso de materiales', grupo: 'Logística' },
  { id: 'kardex', nombre: 'Kardex', grupo: 'Logística' },
  { id: 'rrhh', nombre: 'Personal', grupo: 'RR. HH.' },
  { id: 'cargo', nombre: 'Cargo de útiles', grupo: 'RR. HH.' },
  { id: 'usuarios', nombre: 'Usuarios', grupo: 'Administración' },
  { id: 'config', nombre: 'Configuración', grupo: 'Administración' }
];
const ACCESO = {
  ADMIN: MODULOS.map(m => m.id),
  LOGISTICA: ['inicio', 'servicios', 'compras', 'kardex', 'cargo'],
  COMPRAS: ['inicio', 'servicios', 'compras', 'kardex'],
  ALMACEN: ['inicio', 'compras', 'kardex'],
  RRHH: ['inicio', 'rrhh', 'cargo'],
  GERENCIA: ['inicio', 'servicios', 'compras', 'kardex', 'rrhh', 'cargo'],
  CONSULTA: ['inicio', 'servicios', 'compras', 'kardex']
};
const PERMISO = {
  comprobantes: ['ADMIN', 'LOGISTICA', 'COMPRAS'],
  kardex: ['ADMIN', 'LOGISTICA', 'COMPRAS', 'ALMACEN'],
  personal: ['ADMIN', 'RRHH'],
  aprobar: ['ADMIN', 'GERENCIA']
};
const DESC_ROL = {
  ADMIN: 'Todo, incluidos usuarios y configuración',
  LOGISTICA: 'Registra servicios y compras, mueve el kardex, imprime cargos',
  COMPRAS: 'Registra servicios y compras, mueve el kardex',
  ALMACEN: 'Ve compras y registra salidas y ajustes del kardex',
  RRHH: 'Registra personal e imprime cargos de útiles',
  GERENCIA: 'Ve todo y aprueba o rechaza comprobantes',
  CONSULTA: 'Solo mira servicios, compras y kardex'
};
const TIPOS_DOC = ['FACTURA', 'BOLETA', 'RECIBO POR HONORARIOS', 'NOTA DE CREDITO', 'NOTA DE DEBITO', 'TICKET', 'OTRO'];
const DEF_LISTAS = {
  empresas: [{ nombre: 'FS SOCORRO S.A.C.', ruc: '20486562341' }, { nombre: 'FS INNOVA SOCORRO', ruc: '' }, { nombre: 'HEALTH PREVENTIVE', ruc: '' }],
  areas: ['ADMINISTRACIÓN', 'LOGÍSTICA', 'DROGUERÍA FS', 'REAL', 'MERCADO', 'TUPAC', 'ORTEGA', 'HUANCAS', 'HEROES', 'MCDO. TAMBO', 'PARRA', 'SUMAR', 'PUNO', 'PIOPATA', 'CONCEPCIÓN', 'LIBERTAD', 'ANDALUZ'],
  gastos: ['MATERIALES', 'ACTIVOS MENORES', 'SERVICIOS', 'MANTENIMIENTO', 'ÚTILES DE OFICINA', 'LIMPIEZA', 'UNIFORMES', 'TRANSPORTE', 'PUBLICIDAD', 'ALQUILERES', 'OTROS'],
  formas: ['TRANSFERENCIA BCP', 'TRANSFERENCIA BBVA', 'TRANSFERENCIA INTERBANK', 'EFECTIVO', 'YAPE / PLIN', 'CHEQUE'],
  condiciones: ['CONTADO', '7 DIAS CREDITO', '15 DIAS CREDITO', '30 DIAS CREDITO', '45 DIAS CREDITO', '60 DIAS CREDITO'],
  unidades: ['UND', 'CAJA', 'PAQUETE', 'BOLSA', 'KG', 'LITRO', 'GALÓN', 'METRO', 'PAR', 'JUEGO', 'ROLLO', 'MILLAR'],
  cargos: ['QUÍMICO FARMACÉUTICO', 'TÉCNICO EN FARMACIA', 'CAJERO(A)', 'ALMACENERO', 'ASISTENTE ADMINISTRATIVO', 'ASISTENTE DE LOGÍSTICA', 'JEFE DE LOGÍSTICA', 'CONTADOR(A)', 'GERENTE']
};
const PROMPT_IA = `Eres un asistente contable en Perú. Lee este comprobante de pago (factura, boleta, recibo por honorarios, nota de crédito, etc.) y devuelve SOLO un objeto JSON con esta forma exacta:
{"tipo":"FACTURA|BOLETA|RECIBO POR HONORARIOS|NOTA DE CREDITO|NOTA DE DEBITO|TICKET|OTRO","serie":"F001","numero":"20538","fechaEmision":"YYYY-MM-DD","fechaVencimiento":"YYYY-MM-DD o null","moneda":"PEN o USD","proveedorRuc":"RUC del emisor","proveedorRazon":"razón social del emisor","clienteRuc":"RUC del cliente o null","clienteRazon":"razón social del cliente o null","condicionPago":"CONTADO o 'N DIAS CREDITO' o null","items":[{"codigo":null,"descripcion":"","unidad":"UND","cantidad":1,"valorUnitario":0,"subtotal":0,"lote":null,"vencimiento":"YYYY-MM-DD o null"}],"subtotal":0,"igv":0,"total":0,"detraccion":false,"porcentajeDetraccion":0}
Reglas: valorUnitario y subtotal de cada ítem van SIN IGV; si el comprobante solo muestra precios con IGV, divídelos entre 1.18. Números sin separador de miles y con punto decimal. El emisor (proveedor) es quien emite el comprobante, no el cliente. Si un dato no aparece, usa null. No inventes datos.`;

/* ================= Utilidades ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
const limpio = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const r2 = v => Math.round((Number(v) || 0) * 100) / 100;
const r4 = v => Math.round((Number(v) || 0) * 10000) / 10000;
const n2 = v => (Number(v) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nq = v => (Number(v) || 0).toLocaleString('es-PE', { maximumFractionDigits: 4 });
const num = v => { if (v === null || v === undefined || v === '') return 0; if (typeof v === 'number') return v; const s = String(v).replace(/[^\d.,-]/g, ''); return Number(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, '')) || 0; };
const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const mesISO = () => hoyISO().slice(0, 7);
const fmtF = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const mon = m => m === 'USD' ? 'US$' : 'S/';
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const nombreMes = ym => { const [y, m] = ym.split('-'); return MESES[+m - 1] + ' de ' + y; };
const puede = p => !!YO && PERMISO[p].includes(YO.rol);
const sumarDias = (iso, d) => { const f = new Date(iso + 'T12:00:00'); f.setDate(f.getDate() + d); return f.toISOString().slice(0, 10); };

let toastT;
function toast(t, error = false) {
  const el = $('toast'); el.textContent = t; el.className = 'ver' + (error ? ' error' : '');
  clearTimeout(toastT); toastT = setTimeout(() => el.className = '', error ? 6000 : 3200);
}
function ocupado(btn, on, texto) {
  if (!btn) return;
  if (on) { btn.dataset.t = btn.textContent; btn.disabled = true; if (texto) btn.textContent = texto; }
  else { btn.disabled = false; if (btn.dataset.t) btn.textContent = btn.dataset.t; }
}
function errorTexto(e) {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Usuario o contraseña incorrectos.';
  if (c.includes('email-already-in-use')) return 'Ese usuario ya existe.';
  if (c.includes('weak-password')) return 'La contraseña debe tener al menos 6 caracteres.';
  if (c.includes('too-many-requests')) return 'Demasiados intentos. Espera unos minutos.';
  if (c.includes('permission-denied')) return 'No tienes permiso para esta acción.';
  if (c.includes('requires-recent-login')) return 'Por seguridad, sal y vuelve a entrar antes de cambiar la contraseña.';
  if (c.includes('unavailable') || c.includes('network')) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.';
  return e?.message || String(e);
}
function opciones(sel, lista, valor, vacio) {
  const vals = [...lista];
  if (valor && !vals.includes(valor)) vals.push(valor);
  sel.innerHTML = (vacio !== undefined ? `<option value="">${esc(vacio)}</option>` : '') + vals.map(v => `<option${v === valor ? ' selected' : ''}>${esc(v)}</option>`).join('');
  if (valor !== undefined && valor !== null) sel.value = valor;
}
function descargarCSV(nombre, filas) {
  const txt = '﻿' + filas.map(f => f.map(v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
  a.download = nombre; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
const numCSV = v => (Number(v) || 0).toFixed(2).replace('.', ',');
function mostrarVista(id) { ['vCarga', 'vSinConfig', 'vInicio', 'vLogin', 'vApp'].forEach(v => $(v).hidden = v !== id); }
function cerrarAlClickFuera(dlg) { dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); }

/* ================= Arranque ================= */
if (!firebaseConfig || !firebaseConfig.apiKey) { mostrarVista('vSinConfig'); throw new Error('Falta firebase-config.js'); }
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let YO = null, LISTAS = structuredClone(DEF_LISTAS), IA = null, arranque = false;
const PRODUCTOS = new Map();
let PERSONAL = new Map(), PROVEEDORES = new Map();
let unsubProd = null, modActual = null;

onAuthStateChanged(auth, async user => {
  if (arranque) return;
  if (!user) {
    YO = null; if (unsubProd) { unsubProd(); unsubProd = null; }
    try { const ini = await getDoc(doc(db, 'config', 'inicio')); mostrarVista(ini.exists() ? 'vLogin' : 'vInicio'); }
    catch (e) { mostrarVista('vLogin'); $('loginMsg').textContent = 'No se pudo leer la base de datos: ' + errorTexto(e); }
    return;
  }
  await entrar(user);
});

async function entrar(user) {
  try {
    const u = await getDoc(doc(db, 'usuarios', user.uid));
    if (!u.exists() || u.data().activo !== true) { await signOut(auth); $('loginMsg').textContent = 'Tu usuario está desactivado. Habla con el administrador.'; return; }
    YO = { uid: user.uid, ...u.data() };
    $('yoNombre').textContent = YO.nombre; $('yoRol').textContent = YO.usuario + ' · ' + YO.rol;
    await cargarBase();
    armarMenu();
    mostrarVista('vApp');
    const pedido = location.hash.slice(1);
    irA(ACCESO[YO.rol].includes(pedido) ? pedido : 'inicio');
  } catch (e) { mostrarVista('vLogin'); $('loginMsg').textContent = errorTexto(e); }
}

async function cargarBase() {
  const [l, ia] = await Promise.all([getDoc(doc(db, 'config', 'listas')).catch(() => null), getDoc(doc(db, 'config', 'ia')).catch(() => null)]);
  LISTAS = structuredClone(DEF_LISTAS);
  if (l && l.exists()) Object.assign(LISTAS, l.data());
  IA = ia && ia.exists() ? ia.data() : null;
  $('dlUni').innerHTML = LISTAS.unidades.map(u => `<option value="${esc(u)}">`).join('');
  $('dlCargos').innerHTML = LISTAS.cargos.map(u => `<option value="${esc(u)}">`).join('');
  if (unsubProd) unsubProd();
  unsubProd = onSnapshot(collection(db, 'productos'), s => {
    PRODUCTOS.clear(); s.forEach(d => PRODUCTOS.set(d.id, { id: d.id, ...d.data() }));
    $('dlProd').innerHTML = [...PRODUCTOS.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(p => `<option value="${esc(etiquetaProd(p))}">`).join('');
    if (modActual === 'kardex') pintarKardex();
  }, e => console.warn('productos', e));
}

/* ================= Sesión ================= */
$('fLogin').addEventListener('submit', async e => {
  e.preventDefault(); const b = e.submitter; $('loginMsg').textContent = ''; ocupado(b, true, 'Ingresando…');
  try { await signInWithEmailAndPassword(auth, limpio($('lu').value).toLowerCase() + DOMINIO, $('lc').value); $('lc').value = ''; }
  catch (err) { $('loginMsg').textContent = errorTexto(err); }
  ocupado(b, false);
});
$('fIni').addEventListener('submit', async e => {
  e.preventDefault(); const b = e.submitter;
  const usuario = limpio($('iUsr').value).toLowerCase(), nombre = limpio($('iNom').value);
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return $('iniMsg').textContent = 'El usuario debe tener de 3 a 30 letras o números, sin espacios.';
  if ($('iClave').value !== $('iClave2').value) return $('iniMsg').textContent = 'Las contraseñas no coinciden.';
  ocupado(b, true, 'Creando…'); arranque = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, usuario + DOMINIO, $('iClave').value);
    const lote = writeBatch(db);
    lote.set(doc(db, 'usuarios', cred.user.uid), { usuario, nombre, rol: 'ADMIN', activo: true, creado: serverTimestamp() });
    lote.set(doc(db, 'config', 'inicio'), { creado: serverTimestamp(), uid: cred.user.uid });
    await lote.commit();
    arranque = false; await entrar(cred.user);
  } catch (err) { arranque = false; $('iniMsg').textContent = errorTexto(err); if (auth.currentUser) await signOut(auth); }
  ocupado(b, false);
});
$('bSalir').addEventListener('click', () => signOut(auth));
$('bClave').addEventListener('click', async () => {
  const n = prompt('Nueva contraseña (mínimo 6 caracteres):');
  if (!n) return;
  try { await updatePassword(auth.currentUser, n); toast('Contraseña cambiada.'); } catch (e) { toast(errorTexto(e), true); }
});

/* ================= Menú ================= */
function armarMenu() {
  let grupo = '', h = '';
  MODULOS.filter(m => ACCESO[YO.rol].includes(m.id)).forEach(m => {
    if (m.grupo !== grupo) { grupo = m.grupo; h += `<div class="grupo">${esc(grupo)}</div>`; }
    h += `<button type="button" data-mod="${m.id}">${esc(m.nombre)}</button>`;
  });
  $('menu').innerHTML = h;
}
$('menu').addEventListener('click', e => { const b = e.target.closest('[data-mod]'); if (b) irA(b.dataset.mod); });
function irA(id) {
  if (!ACCESO[YO.rol].includes(id)) id = 'inicio';
  modActual = id;
  document.querySelectorAll('.mod').forEach(s => s.hidden = s.id !== 'm-' + id);
  document.querySelectorAll('#menu [data-mod]').forEach(b => b.classList.toggle('act', b.dataset.mod === id));
  history.replaceState(null, '', '#' + id);
  ({ inicio: abrirInicio, servicios: () => abrirComps('SERVICIO'), compras: () => abrirComps('COMPRA'), kardex: abrirKardex, rrhh: abrirRRHH, cargo: abrirCargo, usuarios: abrirUsuarios, config: abrirConfig })[id]();
}

/* ================= Inicio ================= */
$('iniSelMes').addEventListener('change', abrirInicio);
async function abrirInicio() {
  const m = $('iniSelMes').value || mesISO(); $('iniSelMes').value = m;
  $('iniMes').textContent = 'Comprobantes con fecha de emisión en ' + nombreMes(m) + '.';
  $('iniTarjetas').innerHTML = '<div class="nota">Cargando…</div>';
  try {
    const s = await getDocs(query(collection(db, 'comprobantes'), where('mes', '==', m)));
    const l = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.estado !== 'ANULADO');
    const tot = (cl) => { const x = l.filter(c => c.clase === cl); return { n: x.length, pen: r2(x.filter(c => c.moneda !== 'USD').reduce((a, c) => a + c.total, 0)), usd: r2(x.filter(c => c.moneda === 'USD').reduce((a, c) => a + c.total, 0)) }; };
    const sv = tot('SERVICIO'), cp = tot('COMPRA');
    const pend = l.filter(c => c.aprobacion?.estado === 'PENDIENTE').length;
    let valInv = 0; PRODUCTOS.forEach(p => valInv += p.valor || 0);
    const usd = x => x.usd ? ` · US$ ${n2(x.usd)}` : '';
    $('iniTarjetas').innerHTML = [
      ['Servicios del mes', 'S/ ' + n2(sv.pen), sv.n + ' comprobantes' + usd(sv)],
      ['Compras de materiales', 'S/ ' + n2(cp.pen), cp.n + ' comprobantes' + usd(cp)],
      ['Pendientes de aprobación', pend, 'comprobantes del mes', pend ? 'alerta' : ''],
      ['Productos en kardex', PRODUCTOS.size, 'con stock: ' + [...PRODUCTOS.values()].filter(p => p.stock > 0).length],
      ['Valor del inventario', 'S/ ' + n2(valInv), 'sin IGV, hoy']
    ].map(t => `<div class="tarjeta ${t[3] || ''}"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');
    const ult = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.creadoMs || 0) - (a.creadoMs || 0)).slice(0, 12);
    $('iniUlt').innerHTML = ult.length ? ult.map(c => `<tr class="${c.estado === 'ANULADO' ? 'anulado' : ''}"><td>${new Date(c.creadoMs).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</td><td>${c.clase === 'COMPRA' ? 'Materiales' : 'Servicio'}</td><td>${esc(c.tipo)} ${esc(c.serie)}-${esc(c.numero)}</td><td>${esc(c.razon)}</td><td class="num">${mon(c.moneda)} ${n2(c.total)}</td><td>${pill(c)}</td><td>${esc(c.creadoPor?.nombre || '')}</td></tr>`).join('') : '<tr><td colspan="7" class="vacio">Todavía no hay comprobantes este mes.</td></tr>';
  } catch (e) { $('iniTarjetas').innerHTML = `<div class="aviso error">${esc(errorTexto(e))}</div>`; }
}
const pill = c => c.estado === 'ANULADO' ? '<span class="pill ANULADO">ANULADO</span>' : `<span class="pill ${esc(c.aprobacion?.estado || 'PENDIENTE')}">${esc(c.aprobacion?.estado || 'PENDIENTE')}</span>`;

/* ================= Comprobantes (servicios y compras) ================= */
const EST = { SERVICIO: { mes: '', lista: [], armado: false }, COMPRA: { mes: '', lista: [], armado: false } };
const secComp = clase => $(clase === 'SERVICIO' ? 'm-servicios' : 'm-compras');

function abrirComps(clase) {
  const st = EST[clase], sec = secComp(clase);
  if (!st.armado) {
    st.armado = true; st.mes = mesISO();
    const serv = clase === 'SERVICIO';
    sec.innerHTML = `
      <div class="cab"><div><h2>${serv ? 'Ingreso de servicios' : 'Ingreso de materiales (compras)'}</h2>
        <p class="nota">${serv ? 'Facturas y recibos de servicios, gastos y activos menores. No mueven el kardex.' : 'Facturas de compra de materiales. Cada ítem entra al kardex con su costo sin IGV.'}</p></div>
        <div class="acc">${puede('comprobantes') ? '<button class="btn" type="button" data-a="nuevo">+ Nuevo ingreso</button>' : ''}<button class="btn sec" type="button" data-a="csv">Exportar Excel</button></div></div>
      <div class="filtros">
        <label>Mes de emisión<input type="month" data-f="mes" value="${st.mes}"></label>
        <label>Empresa<select data-f="empresa"></select></label>
        <label>Aprobación<select data-f="aprob"><option value="">Todas</option><option>PENDIENTE</option><option>APROBADO</option><option>RECHAZADO</option><option>ANULADO</option></select></label>
        <label class="crece">Buscar<input type="search" data-f="q" placeholder="Proveedor, RUC, serie, número o concepto"></label>
      </div>
      <div class="resumen" data-r="res"></div>
      <div class="tabla"><table><thead><tr><th>Emisión</th><th>Documento</th><th>Proveedor</th><th>Empresa</th><th>${serv ? 'Tipo de gasto · C. costos' : 'Ítems'}</th><th class="num">Total</th><th>Vence</th><th>Aprobación</th><th></th></tr></thead><tbody data-r="filas"><tr><td colspan="9" class="vacio">Cargando…</td></tr></tbody></table></div>`;
    sec.addEventListener('click', e => accionComp(clase, e));
    sec.querySelector('[data-f="mes"]').addEventListener('change', e => { st.mes = e.target.value; cargarComps(clase); });
    ['empresa', 'aprob', 'q'].forEach(f => sec.querySelector(`[data-f="${f}"]`).addEventListener('input', () => pintarComps(clase)));
  }
  opciones(sec.querySelector('[data-f="empresa"]'), LISTAS.empresas.map(e => e.nombre), sec.querySelector('[data-f="empresa"]').value || '', 'Todas');
  cargarComps(clase);
}
async function cargarComps(clase) {
  const st = EST[clase], sec = secComp(clase);
  try {
    const q = st.mes ? query(collection(db, 'comprobantes'), where('mes', '==', st.mes)) : query(collection(db, 'comprobantes'), orderBy('creadoMs', 'desc'), limit(300));
    const s = await getDocs(q);
    st.lista = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(c => c.clase === clase)
      .sort((a, b) => (b.fechaEmision || '').localeCompare(a.fechaEmision || '') || (b.creadoMs || 0) - (a.creadoMs || 0));
    pintarComps(clase);
  } catch (e) { sec.querySelector('[data-r="filas"]').innerHTML = `<tr><td colspan="9"><div class="aviso error">${esc(errorTexto(e))}</div></td></tr>`; }
}
function filtrarComps(clase) {
  const sec = secComp(clase), f = n => sec.querySelector(`[data-f="${n}"]`).value;
  const emp = f('empresa'), ap = f('aprob'), q = norm(f('q'));
  return EST[clase].lista.filter(c => (!emp || c.empresa === emp)
    && (!ap || (ap === 'ANULADO' ? c.estado === 'ANULADO' : c.estado !== 'ANULADO' && c.aprobacion?.estado === ap))
    && (!q || norm([c.razon, c.ruc, c.serie, c.numero, c.serie + '-' + c.numero, c.notas, ...(c.lineas || []).map(l => l.desc)].join(' ')).includes(q)));
}
function pintarComps(clase) {
  const sec = secComp(clase), l = filtrarComps(clase), serv = clase === 'SERVICIO';
  const vig = l.filter(c => c.estado !== 'ANULADO');
  const pen = r2(vig.filter(c => c.moneda !== 'USD').reduce((a, c) => a + c.total, 0));
  const usd = r2(vig.filter(c => c.moneda === 'USD').reduce((a, c) => a + c.total, 0));
  sec.querySelector('[data-r="res"]').innerHTML = `<span><b>${l.length}</b> comprobantes</span><span>Total: <b>S/ ${n2(pen)}</b>${usd ? ` · <b>US$ ${n2(usd)}</b>` : ''}</span><span>Pendientes de aprobación: <b>${vig.filter(c => c.aprobacion?.estado === 'PENDIENTE').length}</b></span>`;
  sec.querySelector('[data-r="filas"]').innerHTML = l.length ? l.map(c => {
    const anul = c.estado === 'ANULADO', pendiente = c.aprobacion?.estado === 'PENDIENTE';
    const acc = [`<button class="btn sec chico" data-a="ver" data-id="${esc(c.id)}">Ver</button>`];
    if (serv && !anul && pendiente && puede('comprobantes')) acc.push(`<button class="btn sec chico" data-a="editar" data-id="${esc(c.id)}">Editar</button>`);
    if (!anul && pendiente && puede('aprobar')) acc.push(`<button class="btn chico" data-a="aprobar" data-id="${esc(c.id)}">Aprobar</button><button class="btn peligro chico" data-a="rechazar" data-id="${esc(c.id)}">Rechazar</button>`);
    if (!anul && puede('comprobantes')) acc.push(`<button class="btn peligro chico" data-a="anular" data-id="${esc(c.id)}">Anular</button>`);
    const det = serv ? `${esc(c.gasto || '')}<br><small class="nota">${esc(c.centro || '')}</small>` : `${(c.lineas || []).length} ítem(s)<br><small class="nota">${esc((c.lineas || []).slice(0, 2).map(x => x.desc).join(', '))}${(c.lineas || []).length > 2 ? '…' : ''}</small>`;
    return `<tr class="${anul ? 'anulado' : ''}"><td>${fmtF(c.fechaEmision)}</td><td>${esc(c.tipo)}<br><b>${esc(c.serie)}-${esc(c.numero)}</b></td><td>${esc(c.razon)}<br><small class="nota">${esc(c.ruc)}</small></td><td>${esc(c.empresa)}</td><td>${det}</td><td class="num">${mon(c.moneda)} ${n2(c.total)}${c.detMonto ? `<br><small class="nota">Detr. ${n2(c.detMonto)}</small>` : ''}</td><td>${fmtF(c.fechaVence)}</td><td>${pill(c)}${c.aprobacion?.usuario ? `<br><small class="nota">${esc(c.aprobacion.usuario)}</small>` : ''}</td><td><div class="acciones">${acc.join('')}</div></td></tr>`;
  }).join('') : `<tr><td colspan="9" class="vacio">No hay comprobantes con este filtro.${puede('comprobantes') ? ' Usa “+ Nuevo ingreso” para registrar el primero.' : ''}</td></tr>`;
}
async function accionComp(clase, e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, c = EST[clase].lista.find(x => x.id === b.dataset.id);
  if (a === 'nuevo') return abrirEditor(clase, null, 'nuevo');
  if (a === 'csv') return exportarComps(clase);
  if (!c) return;
  if (a === 'ver') return abrirEditor(clase, c, 'ver');
  if (a === 'editar') return abrirEditor(clase, c, 'editar');
  if (a === 'aprobar' || a === 'rechazar') {
    const estado = a === 'aprobar' ? 'APROBADO' : 'RECHAZADO';
    let motivo = '';
    if (estado === 'RECHAZADO') { motivo = prompt('Motivo del rechazo:'); if (motivo === null) return; }
    ocupado(b, true);
    try { await updateDoc(doc(db, 'comprobantes', c.id), { aprobacion: { estado, fecha: hoyISO(), usuario: YO.nombre, uid: YO.uid, motivo: limpio(motivo) } }); toast(estado === 'APROBADO' ? 'Comprobante aprobado.' : 'Comprobante rechazado.'); cargarComps(clase); }
    catch (err) { toast(errorTexto(err), true); ocupado(b, false); }
    return;
  }
  if (a === 'anular') {
    const extra = clase === 'COMPRA' ? '\n\nSe sacarán del kardex las cantidades que ingresó.' : '';
    if (!confirm(`¿Anular ${c.tipo} ${c.serie}-${c.numero} de ${c.razon}?${extra}`)) return;
    ocupado(b, true);
    try { await anularComp(c); toast('Comprobante anulado.'); cargarComps(clase); }
    catch (err) { toast(errorTexto(err), true); ocupado(b, false); }
  }
}
function exportarComps(clase) {
  const l = filtrarComps(clase), filas = [['Fecha emisión', 'Tipo', 'Serie', 'Número', 'RUC', 'Proveedor', 'Empresa', 'Condición', 'Vencimiento', 'Forma de pago', 'Tipo de gasto', 'Centro de costos', 'Destino', 'Moneda', 'Ítem', 'Producto / concepto', 'Código', 'Unidad', 'Cantidad', 'P. unit sin IGV', 'Subtotal', 'IGV', 'Total ítem', 'Total comprobante', 'Detracción', 'Total a pagar', 'Aprobación', 'Estado', 'Registró', 'N.º solicitud', 'Anotaciones']];
  l.forEach(c => (c.lineas || []).forEach((x, i) => filas.push([fmtF(c.fechaEmision), c.tipo, c.serie, c.numero, c.ruc, c.razon, c.empresa, c.condicion, fmtF(c.fechaVence), c.forma, c.gasto, c.centro, c.destino, c.moneda, i + 1, x.desc, x.codigo || '', x.unidad || '', String(x.cant).replace('.', ','), numCSV(x.vu), numCSV(x.sub), numCSV(x.igv), numCSV(x.tot), i === 0 ? numCSV(c.total) : '', i === 0 ? numCSV(c.detMonto) : '', i === 0 ? numCSV(c.totalPagar) : '', c.aprobacion?.estado || '', c.estado, c.creadoPor?.nombre || '', c.solicitud || '', c.notas || ''])));
  descargarCSV(`${clase === 'SERVICIO' ? 'servicios' : 'compras'}_${EST[clase].mes || 'ultimos'}.csv`, filas);
}

/* ---------- Editor de comprobante ---------- */
let ED = null;
const lineaVacia = () => ({ desc: '', prodId: null, codigo: '', unidad: 'UND', cant: 1, vu: 0, lote: '', vence: '' });
const etiquetaProd = p => `${p.codigo} · ${p.nombre}`;
function buscarProd(txt) {
  const t = norm(txt); if (!t) return null;
  for (const p of PRODUCTOS.values()) if (norm(etiquetaProd(p)) === t || norm(p.nombre) === t || norm(p.codigo) === t) return p;
  return null;
}
const CAMPOS_BLOQ_EDIT = ['cTipo', 'cSerie', 'cNum', 'cRuc'];
const CAMPOS = ['cTipo', 'cSerie', 'cNum', 'cFecha', 'cRuc', 'cRazon', 'cCond', 'cVence', 'cForma', 'cMoneda', 'cGasto', 'cCentro', 'cIgv', 'cCont', 'cDet', 'cDetPct', 'cEmpresa', 'cDestino', 'cSol', 'cNotas'];

async function abrirEditor(clase, c, modo) {
  ED = { clase, modo, id: c?.id || null, archivo: null, adjuntoId: c?.adjuntoId || null, lineas: c ? structuredClone(c.lineas || []) : [lineaVacia()], iaTotal: null };
  const compra = clase === 'COMPRA', ro = modo === 'ver';
  $('cTit').textContent = (modo === 'nuevo' ? 'Nuevo ingreso de ' : modo === 'editar' ? 'Editar ingreso de ' : '') + (compra ? 'materiales' : 'servicio') + (c ? ` · ${c.tipo} ${c.serie}-${c.numero}` : '');
  opciones($('cTipo'), TIPOS_DOC, c?.tipo || 'FACTURA');
  opciones($('cCond'), LISTAS.condiciones, c?.condicion || 'CONTADO');
  opciones($('cForma'), LISTAS.formas, c?.forma || LISTAS.formas[0]);
  opciones($('cGasto'), LISTAS.gastos, c?.gasto || (compra ? 'MATERIALES' : ''), '— Elegir —');
  opciones($('cCentro'), LISTAS.areas, c?.centro || '', '— Elegir —');
  opciones($('cDestino'), LISTAS.areas, c?.destino || 'LOGÍSTICA', '— Elegir —');
  opciones($('cEmpresa'), LISTAS.empresas.map(e => e.nombre), c?.empresa || LISTAS.empresas[0]?.nombre);
  $('cSerie').value = c?.serie || ''; $('cNum').value = c?.numero || ''; $('cFecha').value = c?.fechaEmision || hoyISO();
  $('cRuc').value = c?.ruc || ''; $('cRazon').value = c?.razon || ''; $('cVence').value = c?.fechaVence || '';
  $('cMoneda').value = c?.moneda || 'PEN'; $('cIgv').value = c?.afectoIgv || 'SI'; $('cCont').value = c?.contable || 'SI';
  $('cDet').value = c?.detraccion || 'NO'; $('cDetPct').value = c?.detPct ?? 0; $('cSol').value = c?.solicitud || ''; $('cNotas').value = c?.notas || '';
  if (!c) calcVence();
  CAMPOS.forEach(id => $(id).disabled = ro || (modo === 'editar' && CAMPOS_BLOQ_EDIT.includes(id)));
  ['cIA', 'cGuardar', 'cAddLin', 'cCambiar'].forEach(id => $(id).hidden = ro);
  $('cMsg').hidden = true;
  const ap = c?.aprobacion;
  $('cAprob').innerHTML = c ? `Registrado por <b>${esc(c.creadoPor?.nombre || '')}</b> el ${new Date(c.creadoMs).toLocaleString('es-PE')}. Aprobación: ${pill(c)}${ap?.usuario ? ` por ${esc(ap.usuario)} (${fmtF(ap.fecha)})` : ''}${ap?.motivo ? ` — ${esc(ap.motivo)}` : ''}${c.estado === 'ANULADO' ? ` · Anulado por ${esc(c.anuladoPor || '')}` : ''}` : '';
  previsualizar(null);
  pintarLineas();
  $('dComp').showModal();
  cargarProveedores();
  if (ED.adjuntoId) {
    $('cDropTxt').textContent = 'Cargando imagen…';
    try { const a = await getDoc(doc(db, 'adjuntos', ED.adjuntoId)); if (a.exists()) { ED.adjData = a.data(); previsualizar(ED.adjData); } else $('cDropTxt').textContent = 'No se encontró la imagen.'; }
    catch (e) { $('cDropTxt').textContent = 'No se pudo cargar la imagen.'; }
  } else if (ro) $('cDropTxt').textContent = 'Este comprobante no tiene imagen adjunta.';
}
async function cargarProveedores() {
  if (PROVEEDORES.size) return;
  try { const s = await getDocs(collection(db, 'proveedores')); s.forEach(d => PROVEEDORES.set(d.id, d.data())); $('dlProv').innerHTML = [...PROVEEDORES.values()].map(p => `<option value="${esc(p.ruc)}">${esc(p.razon)}</option>`).join(''); } catch (e) { }
}
function previsualizar(a) {
  const img = $('cPrev'), pdf = $('cPrevPdf');
  img.hidden = pdf.hidden = true; $('cDropTxt').hidden = false;
  $('cDropTxt').innerHTML = 'Arrastra aquí la foto o el PDF de la factura,<br>haz clic para elegirla o pégala con Ctrl+V';
  if (!a) return;
  $('cDropTxt').hidden = true;
  if (a.mime === 'application/pdf') { pdf.src = urlAdjunto(a); pdf.hidden = false; }
  else { img.src = `data:${a.mime};base64,${a.d}`; img.hidden = false; }
}
function urlAdjunto(a) {
  const bin = atob(a.d), u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([u], { type: a.mime }));
}
async function prepararArchivo(file) {
  if (file.type === 'application/pdf') {
    if (file.size > 700000) throw new Error('El PDF pesa más de 700 KB. Toma una foto o captura de pantalla de la factura.');
    const d = await new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(file); });
    return { d, mime: 'application/pdf', nombre: file.name };
  }
  if (!file.type.startsWith('image/')) throw new Error('Sube una imagen (JPG o PNG) o un PDF.');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 1700 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  let q = 0.82, url;
  do { url = cv.toDataURL('image/jpeg', q); q -= 0.08; } while (url.length > 880000 && q > 0.3);
  if (url.length > 900000) throw new Error('La imagen es demasiado grande incluso reducida.');
  return { d: url.split(',')[1], mime: 'image/jpeg', nombre: file.name || 'comprobante.jpg' };
}
async function tomarArchivo(file) {
  if (!file || !ED || ED.modo === 'ver') return;
  try { ED.archivo = await prepararArchivo(file); ED.adjData = ED.archivo; previsualizar(ED.archivo); msgComp(IA?.clave ? 'Imagen lista. Pulsa “Leer con IA” para llenar los datos.' : 'Imagen lista.', 'ok'); }
  catch (e) { msgComp(e.message, 'error'); }
}
function msgComp(t, tipo = '') { const m = $('cMsg'); m.hidden = !t; m.className = 'aviso ' + tipo; m.innerHTML = t; }
$('cFile').addEventListener('change', e => { tomarArchivo(e.target.files[0]); e.target.value = ''; });
$('cCambiar').addEventListener('click', () => $('cFile').click());
$('cAmpliar').addEventListener('click', () => { if (ED?.adjData) verAdjunto(ED.adjData); });
const drop = $('cDrop');
drop.addEventListener('click', e => { if (ED?.modo === 'ver' || ED?.adjData) { e.preventDefault(); if (ED?.adjData) verAdjunto(ED.adjData); } });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('arrastre'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('arrastre'); }));
drop.addEventListener('drop', e => tomarArchivo(e.dataTransfer.files[0]));
document.addEventListener('paste', e => { if (!$('dComp').open) return; const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); tomarArchivo(f); } });
function verAdjunto(a) {
  $('imgCuerpo').innerHTML = a.mime === 'application/pdf' ? `<iframe src="${urlAdjunto(a)}" style="width:100%;height:100%;min-height:75vh;border:0" title="PDF"></iframe>` : `<img src="data:${a.mime};base64,${a.d}" alt="Comprobante" style="max-width:100%">`;
  $('dImg').showModal();
}
$('imgCerrar').addEventListener('click', () => $('dImg').close());
cerrarAlClickFuera($('dImg'));
$('cCerrar').addEventListener('click', () => $('dComp').close());

function calcVence() {
  const m = /(\d+)\s*DIA/i.exec($('cCond').value), f = $('cFecha').value;
  if (!f) return;
  $('cVence').value = m ? sumarDias(f, +m[1]) : f;
}
$('cCond').addEventListener('change', calcVence);
$('cFecha').addEventListener('change', calcVence);
['cIgv', 'cDet', 'cDetPct'].forEach(id => $(id).addEventListener('input', () => pintarLineas()));
$('cRuc').addEventListener('change', () => { const p = PROVEEDORES.get(limpio($('cRuc').value)); if (p && !limpio($('cRazon').value)) $('cRazon').value = p.razon; });

function calcLinea(l) { const sub = r2(num(l.cant) * num(l.vu)); const igv = $('cIgv').value === 'SI' ? r2(sub * IGV) : 0; return { sub, igv, tot: r2(sub + igv) }; }
function totales() {
  let s = 0, g = 0;
  ED.lineas.forEach(l => { const c = calcLinea(l); s += c.sub; g += c.igv; });
  s = r2(s); g = r2(g); const t = r2(s + g);
  const det = $('cDet').value === 'SI' ? Math.round(t * num($('cDetPct').value) / 100) : 0;
  const r = { subtotal: s, igv: g, total: t, detMonto: det, totalPagar: r2(t - det) };
  $('tSub').textContent = n2(s); $('tIgv').textContent = n2(g); $('tTot').textContent = n2(t); $('tDet').textContent = n2(det); $('tPagar').textContent = n2(r.totalPagar);
  return r;
}
function marcaProd(l) {
  if (ED.clase !== 'COMPRA') return '';
  if (l.prodId && PRODUCTOS.get(l.prodId)) return `<span class="marca-prod ok">${esc(PRODUCTOS.get(l.prodId).codigo)} · en kardex</span>`;
  if (l.prodId) return `<span class="marca-prod ok">${esc(l.codigo || '')}</span>`;
  return limpio(l.desc) ? '<span class="marca-prod nuevo">Producto nuevo: se creará en el kardex</span>' : '';
}
function pintarLineas() {
  const compra = ED.clase === 'COMPRA', ro = ED.modo !== 'nuevo' && (ED.modo === 'ver' || compra), dis = ro ? ' disabled' : '';
  $('cLinHead').innerHTML = `<tr><th>#</th><th>${compra ? 'Producto' : 'Concepto'}</th>${compra ? '<th>Unidad</th>' : ''}<th>Cant.</th><th>P. unit sin IGV</th>${compra ? '<th>Lote</th><th>Vence</th>' : ''}<th class="num">Subtotal</th><th class="num">IGV</th><th class="num">Total</th><th></th></tr>`;
  $('cLineas').innerHTML = ED.lineas.map((l, i) => {
    const c = calcLinea(l);
    return `<tr data-i="${i}"><td class="c">${i + 1}</td>
      <td class="ancho"><input data-f="desc" value="${esc(l.desc)}"${compra ? ' list="dlProd"' : ''}${dis} aria-label="${compra ? 'Producto' : 'Concepto'}"><span data-c="marca">${marcaProd(l)}</span></td>
      ${compra ? `<td><input class="w6" data-f="unidad" list="dlUni" value="${esc(l.unidad || 'UND')}"${dis} aria-label="Unidad"></td>` : ''}
      <td><input class="w6 num" type="number" step="any" min="0" data-f="cant" value="${l.cant}"${dis} aria-label="Cantidad"></td>
      <td><input class="w8 num" type="number" step="any" min="0" data-f="vu" value="${l.vu}"${dis} aria-label="Precio unitario sin IGV"></td>
      ${compra ? `<td><input class="w8" data-f="lote" value="${esc(l.lote || '')}"${dis} aria-label="Lote"></td><td><input type="date" data-f="vence" value="${esc(l.vence || '')}"${dis} aria-label="Vencimiento"></td>` : ''}
      <td class="num" data-c="sub">${n2(c.sub)}</td><td class="num" data-c="igv">${n2(c.igv)}</td><td class="num" data-c="tot">${n2(c.tot)}</td>
      <td>${ro ? '' : '<button type="button" class="x" data-quitar title="Quitar ítem" aria-label="Quitar ítem">×</button>'}</td></tr>`;
  }).join('') || `<tr><td colspan="11" class="vacio">Sin ítems.</td></tr>`;
  $('cAddLin').hidden = ro;
  const t = totales();
  if (ED.iaTotal !== null && Math.abs(ED.iaTotal - t.total) > 0.05) msgComp(`El total calculado (${n2(t.total)}) no coincide con el total del comprobante (${n2(ED.iaTotal)}). Revisa cantidades, precios o si es afecto a IGV.`, '');
}
$('cLineas').addEventListener('input', e => {
  const inp = e.target.closest('[data-f]'); if (!inp) return;
  const tr = inp.closest('tr'), i = +tr.dataset.i, l = ED.lineas[i], f = inp.dataset.f;
  l[f] = inp.value;
  if (f === 'desc' && ED.clase === 'COMPRA') {
    const p = buscarProd(inp.value);
    l.prodId = p ? p.id : null; l.codigo = p ? p.codigo : '';
    if (p) { l.unidad = p.unidad; const u = tr.querySelector('[data-f="unidad"]'); if (u) u.value = p.unidad; }
    tr.querySelector('[data-c="marca"]').innerHTML = marcaProd(l);
  }
  const c = calcLinea(l);
  tr.querySelector('[data-c="sub"]').textContent = n2(c.sub); tr.querySelector('[data-c="igv"]').textContent = n2(c.igv); tr.querySelector('[data-c="tot"]').textContent = n2(c.tot);
  totales();
});
$('cLineas').addEventListener('change', e => {
  const inp = e.target.closest('[data-f="desc"]'); if (!inp || ED.clase !== 'COMPRA') return;
  const l = ED.lineas[+inp.closest('tr').dataset.i];
  if (l.prodId) { const p = PRODUCTOS.get(l.prodId); if (p) { inp.value = p.nombre; l.desc = p.nombre; } }
});
$('cLineas').addEventListener('click', e => { if (e.target.closest('[data-quitar]')) { ED.lineas.splice(+e.target.closest('tr').dataset.i, 1); if (!ED.lineas.length) ED.lineas.push(lineaVacia()); pintarLineas(); } });
$('cAddLin').addEventListener('click', () => { ED.lineas.push(lineaVacia()); pintarLineas(); const ins = $('cLineas').querySelectorAll('[data-f="desc"]'); ins[ins.length - 1]?.focus(); });

/* ---------- Lectura con IA ---------- */
$('cIA').addEventListener('click', async () => {
  const a = ED?.archivo || ED?.adjData;
  if (!a) return msgComp('Primero sube la foto o el PDF del comprobante.', 'error');
  if (!IA?.clave) return msgComp('Falta la clave de Gemini. El administrador la pone en Configuración.', 'error');
  const b = $('cIA'); ocupado(b, true, 'Leyendo…'); msgComp('Leyendo el comprobante con IA, espera unos segundos…', '');
  try {
    const modelo = limpio(IA.modelo) || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent?key=${encodeURIComponent(IA.clave)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: a.mime, data: a.d } }, { text: PROMPT_IA }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0 } })
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error?.message || ('Error ' + r.status));
    const t = (j.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!t) throw new Error('La IA no devolvió datos. Prueba con una foto más nítida.');
    aplicarIA(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)));
  } catch (e) { msgComp('No se pudo leer el comprobante: ' + esc(e.message), 'error'); }
  ocupado(b, false);
});
function aplicarIA(d) {
  const tipo = TIPOS_DOC.find(x => norm(x) === norm(d.tipo)) || (norm(d.tipo).includes('honorario') ? 'RECIBO POR HONORARIOS' : norm(d.tipo).includes('credito') ? 'NOTA DE CREDITO' : 'FACTURA');
  opciones($('cTipo'), TIPOS_DOC, tipo);
  if (d.serie) $('cSerie').value = limpio(d.serie).toUpperCase();
  if (d.numero) $('cNum').value = String(d.numero).replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.fechaEmision || '')) $('cFecha').value = d.fechaEmision;
  if (d.proveedorRuc) $('cRuc').value = String(d.proveedorRuc).replace(/\D/g, '');
  if (d.proveedorRazon) $('cRazon').value = limpio(d.proveedorRazon).toUpperCase();
  if (d.moneda) $('cMoneda').value = /USD|\$|DOLAR/i.test(d.moneda) && !/S\//.test(d.moneda) ? 'USD' : 'PEN';
  const cp = norm(d.condicionPago);
  if (cp) { const dias = /(\d+)/.exec(cp); const v = cp.includes('contado') ? 'CONTADO' : dias ? `${dias[1]} DIAS CREDITO` : limpio(d.condicionPago).toUpperCase(); opciones($('cCond'), LISTAS.condiciones, v); }
  calcVence();
  if (/^\d{4}-\d{2}-\d{2}$/.test(d.fechaVencimiento || '')) $('cVence').value = d.fechaVencimiento;
  const cli = String(d.clienteRuc || '').replace(/\D/g, '');
  const emp = LISTAS.empresas.find(e => e.ruc && e.ruc === cli) || LISTAS.empresas.find(e => d.clienteRazon && norm(d.clienteRazon).includes(norm(e.nombre).split(' ').slice(0, 2).join(' ')));
  if (emp) $('cEmpresa').value = emp.nombre;
  const igv = num(d.igv), total = num(d.total);
  $('cIgv').value = igv === 0 && total > 0 ? 'NO' : 'SI';
  if (d.detraccion) { $('cDet').value = 'SI'; $('cDetPct').value = num(d.porcentajeDetraccion) || 12; }
  const items = Array.isArray(d.items) ? d.items : [];
  ED.lineas = items.map(it => {
    const cant = num(it.cantidad) || 1;
    const vu = num(it.valorUnitario) || r4(num(it.subtotal) / cant);
    const l = { desc: limpio(it.descripcion).toUpperCase(), prodId: null, codigo: '', unidad: LISTAS.unidades.find(u => norm(u) === norm(it.unidad)) || (it.unidad ? limpio(it.unidad).toUpperCase() : 'UND'), cant, vu: r4(vu), lote: limpio(it.lote), vence: /^\d{4}-\d{2}-\d{2}$/.test(it.vencimiento || '') ? it.vencimiento : '' };
    if (ED.clase === 'COMPRA') { const p = buscarProd(it.codigo) || buscarProd(l.desc); if (p) { l.prodId = p.id; l.codigo = p.codigo; l.desc = p.nombre; l.unidad = p.unidad; } }
    return l;
  }).filter(l => l.desc);
  if (!ED.lineas.length) ED.lineas = [{ ...lineaVacia(), desc: 'SEGÚN COMPROBANTE', vu: num(d.subtotal) || r2(total / (igv ? 1 + IGV : 1)) }];
  ED.iaTotal = total || null;
  msgComp('Datos leídos con IA. <b>Revísalos con la imagen antes de guardar</b>; completa tipo de gasto, centro de costos y destino.', 'ok');
  pintarLineas();
}

/* ---------- Guardar ---------- */
const idComp = (ruc, tipo, serie, numero) => `${ruc}_${tipo.replace(/\s+/g, '')}_${serie}-${numero}`.replace(/[\/#?\[\]]/g, '');
function leerForm() {
  const f = {
    tipo: $('cTipo').value, serie: limpio($('cSerie').value).toUpperCase(), numero: limpio($('cNum').value).replace(/^0+(?=\d)/, ''),
    fechaEmision: $('cFecha').value, fechaVence: $('cVence').value, ruc: limpio($('cRuc').value), razon: limpio($('cRazon').value).toUpperCase(),
    condicion: $('cCond').value, forma: $('cForma').value, moneda: $('cMoneda').value, gasto: $('cGasto').value, centro: $('cCentro').value,
    afectoIgv: $('cIgv').value, contable: $('cCont').value, detraccion: $('cDet').value, detPct: num($('cDetPct').value),
    empresa: $('cEmpresa').value, destino: $('cDestino').value, solicitud: limpio($('cSol').value), notas: limpio($('cNotas').value)
  };
  f.empresaRuc = LISTAS.empresas.find(e => e.nombre === f.empresa)?.ruc || '';
  f.mes = (f.fechaEmision || '').slice(0, 7);
  return f;
}
function validar(f, lineas) {
  if (!f.serie || !f.numero) return 'Falta la serie o el número del comprobante.';
  if (!f.fechaEmision) return 'Falta la fecha de emisión.';
  if (!/^\d{8}$|^\d{11}$/.test(f.ruc)) return 'El RUC del proveedor debe tener 11 dígitos (o DNI de 8).';
  if (!f.razon) return 'Falta el nombre del proveedor.';
  if (!f.empresa) return 'Elige la empresa.';
  if (!f.gasto) return 'Elige el tipo de gasto.';
  if (!f.centro) return 'Elige el centro de costos.';
  if (!lineas.length) return 'Agrega al menos un ítem con descripción y cantidad.';
  if (lineas.some(l => l.cant <= 0)) return 'Todas las cantidades deben ser mayores a cero.';
  return '';
}
$('fComp').addEventListener('submit', async e => {
  e.preventDefault();
  if (!ED || ED.modo === 'ver') return;
  const f = leerForm(), t = totales();
  const lineas = ED.lineas.filter(l => limpio(l.desc)).map(l => { const c = calcLinea(l); return { desc: limpio(l.desc).toUpperCase(), prodId: l.prodId || null, codigo: l.codigo || '', unidad: limpio(l.unidad || 'UND').toUpperCase(), cant: r4(num(l.cant)), vu: r4(num(l.vu)), lote: limpio(l.lote), vence: l.vence || '', ...c }; });
  const err = validar(f, lineas); if (err) return msgComp(err, 'error');
  const b = $('cGuardar'); ocupado(b, true, 'Guardando…');
  const id = ED.modo === 'editar' ? ED.id : idComp(f.ruc, f.tipo, f.serie, f.numero);
  let nuevoAdj = null;
  try {
    if (ED.archivo) { const r = await addDoc(collection(db, 'adjuntos'), { ...ED.archivo, uid: YO.uid, creadoMs: Date.now() }); nuevoAdj = r.id; }
    const datos = { ...f, clase: ED.clase, lineas, ...t, adjuntoId: nuevoAdj || ED.adjuntoId || null };
    if (ED.clase === 'COMPRA') await guardarCompra(id, datos); else await guardarServicio(id, datos);
    PROVEEDORES.set(f.ruc, { ruc: f.ruc, razon: f.razon });
    $('dComp').close(); toast('Comprobante guardado.');
    const st = EST[ED.clase];
    if (st.mes && st.mes !== f.mes) { st.mes = f.mes; const i = secComp(ED.clase).querySelector('[data-f="mes"]'); if (i) i.value = f.mes; }
    cargarComps(ED.clase);
  } catch (err2) {
    if (nuevoAdj) deleteDoc(doc(db, 'adjuntos', nuevoAdj)).catch(() => { });
    msgComp(esc(errorTexto(err2)), 'error');
  }
  ocupado(b, false);
});
function yaExiste(s) { const d = s.data(); return new Error(`Este comprobante ya está registrado (${d.tipo} ${d.serie}-${d.numero}, registrado por ${d.creadoPor?.nombre || 'otro usuario'}).`); }
async function guardarServicio(id, datos) {
  await runTransaction(db, async tx => {
    const ref = doc(db, 'comprobantes', id), s = await tx.get(ref);
    const prev = s.exists() ? s.data() : null;
    if (ED.modo === 'nuevo' && prev && prev.estado !== 'ANULADO') throw yaExiste(s);
    const base = ED.modo === 'editar' && prev ? prev : null;
    tx.set(ref, { ...datos, creadoMs: base?.creadoMs || Date.now(), creadoPor: base?.creadoPor || { uid: YO.uid, nombre: YO.nombre }, aprobacion: base?.aprobacion || { estado: 'PENDIENTE' }, estado: 'REGISTRADO', editadoMs: base ? Date.now() : null, editadoPor: base ? YO.nombre : null });
    tx.set(doc(db, 'proveedores', datos.ruc), { ruc: datos.ruc, razon: datos.razon, actMs: Date.now() }, { merge: true });
  });
}
async function guardarCompra(id, datos) {
  await runTransaction(db, async tx => {
    const ref = doc(db, 'comprobantes', id), s = await tx.get(ref);
    if (s.exists() && s.data().estado !== 'ANULADO') throw yaExiste(s);
    const nuevos = datos.lineas.filter(l => !l.prodId || !PRODUCTOS.has(l.prodId));
    const refCont = doc(db, 'config', 'contadores');
    const cont = nuevos.length ? await tx.get(refCont) : null;
    const ids = [...new Set(datos.lineas.filter(l => l.prodId && PRODUCTOS.has(l.prodId)).map(l => l.prodId))];
    const est = new Map();
    for (const pid of ids) { const ps = await tx.get(doc(db, 'productos', pid)); if (!ps.exists()) throw new Error('Un producto ya no existe en el kardex. Vuelve a elegirlo.'); est.set(pid, { ...ps.data(), _nuevo: false }); }
    let n = cont && cont.exists() ? (cont.data().producto || 0) : 0;
    const porNombre = new Map();
    const doc0 = `${datos.tipo} ${datos.serie}-${datos.numero}`;
    let ms = Date.now();
    for (const l of datos.lineas) {
      let pid = l.prodId && est.has(l.prodId) ? l.prodId : null;
      if (!pid) {
        const k = norm(l.desc);
        if (porNombre.has(k)) pid = porNombre.get(k);
        else {
          n += 1; pid = doc(collection(db, 'productos')).id;
          est.set(pid, { codigo: 'P' + String(n).padStart(5, '0'), nombre: l.desc, nombreN: k, unidad: l.unidad || 'UND', stock: 0, valor: 0, cProm: 0, creadoMs: Date.now(), _nuevo: true });
          porNombre.set(k, pid);
        }
      }
      const p = est.get(pid);
      p.stock = r4(p.stock + l.cant); p.valor = r2(p.valor + l.sub); p.cProm = p.stock > 0 ? r4(p.valor / p.stock) : 0;
      l.prodId = pid; l.codigo = p.codigo;
      tx.set(doc(collection(db, 'movimientos')), {
        productoId: pid, codigo: p.codigo, producto: p.nombre, unidad: p.unidad, fecha: datos.fechaEmision, ms: ms++,
        tipo: 'ENTRADA', origen: 'COMPRA', documento: doc0, comprobanteId: id, tercero: datos.razon,
        cant: l.cant, cu: l.vu, ct: l.sub, saldoCant: p.stock, cProm: p.cProm, saldoValor: p.valor, lote: l.lote, vence: l.vence,
        usuario: YO.nombre, uid: YO.uid, creado: serverTimestamp()
      });
    }
    for (const [pid, p] of est) {
      const { _nuevo, ...d } = p;
      tx.set(doc(db, 'productos', pid), { ...d, actMs: Date.now(), ultMov: datos.fechaEmision });
    }
    if (nuevos.length) tx.set(refCont, { producto: n }, { merge: true });
    tx.set(ref, { ...datos, creadoMs: Date.now(), creadoPor: { uid: YO.uid, nombre: YO.nombre }, aprobacion: { estado: 'PENDIENTE' }, estado: 'REGISTRADO' });
    tx.set(doc(db, 'proveedores', datos.ruc), { ruc: datos.ruc, razon: datos.razon, actMs: Date.now() }, { merge: true });
  });
}
async function anularComp(c) {
  await runTransaction(db, async tx => {
    const ref = doc(db, 'comprobantes', c.id), s = await tx.get(ref);
    if (!s.exists() || s.data().estado === 'ANULADO') throw new Error('Este comprobante ya estaba anulado.');
    const d = s.data();
    if (d.clase === 'COMPRA') {
      const est = new Map();
      for (const pid of new Set(d.lineas.map(l => l.prodId))) { const ps = await tx.get(doc(db, 'productos', pid)); if (ps.exists()) est.set(pid, ps.data()); }
      let ms = Date.now();
      for (const l of d.lineas) {
        const p = est.get(l.prodId); if (!p) continue;
        if (p.stock + 1e-9 < l.cant) throw new Error(`No se puede anular: de ${p.nombre} solo quedan ${nq(p.stock)} ${p.unidad} y la factura ingresó ${nq(l.cant)}. Primero registra un ajuste.`);
        p.stock = r4(p.stock - l.cant); p.valor = p.stock <= 1e-9 ? 0 : r2(p.valor - l.sub); p.cProm = p.stock > 0 ? r4(p.valor / p.stock) : 0;
        tx.set(doc(collection(db, 'movimientos')), {
          productoId: l.prodId, codigo: p.codigo, producto: p.nombre, unidad: p.unidad, fecha: hoyISO(), ms: ms++,
          tipo: 'SALIDA', origen: 'ANULACION', documento: `Anula ${d.tipo} ${d.serie}-${d.numero}`, comprobanteId: c.id, tercero: d.razon,
          cant: l.cant, cu: l.vu, ct: l.sub, saldoCant: p.stock, cProm: p.cProm, saldoValor: p.valor, usuario: YO.nombre, uid: YO.uid, creado: serverTimestamp()
        });
      }
      for (const [pid, p] of est) tx.update(doc(db, 'productos', pid), { stock: p.stock, valor: p.valor, cProm: p.cProm, actMs: Date.now() });
    }
    tx.update(ref, { estado: 'ANULADO', anuladoPor: YO.nombre, anuladoMs: Date.now() });
  });
}

/* ================= Kardex ================= */
let kSel = null, kMovs = [];
function abrirKardex() {
  $('kMov').hidden = !puede('kardex');
  pintarKardex();
}
$('kBuscar').addEventListener('input', pintarKardex);
function pintarKardex() {
  const q = norm($('kBuscar').value);
  const l = [...PRODUCTOS.values()].filter(p => !q || norm(p.codigo + ' ' + p.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  let val = 0, conStock = 0; PRODUCTOS.forEach(p => { val += p.valor || 0; if (p.stock > 0) conStock++; });
  $('kTarjetas').innerHTML = [['Productos', PRODUCTOS.size, conStock + ' con stock'], ['Valor del inventario', 'S/ ' + n2(val), 'costo promedio sin IGV']]
    .map(t => `<div class="tarjeta"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('');
  $('kProds').innerHTML = l.length ? l.map(p => `<tr data-id="${esc(p.id)}" class="${p.id === kSel ? 'sel' : ''}" style="cursor:pointer"><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}<br><small class="nota">${esc(p.unidad)}</small></td><td class="num">${nq(p.stock)}</td><td class="num">${n2(p.cProm)}</td><td class="num">${n2(p.valor)}</td></tr>`).join('')
    : `<tr><td colspan="5" class="vacio">${PRODUCTOS.size ? 'Ningún producto coincide.' : 'El kardex está vacío. Los productos se crean al registrar compras en “Ingreso de materiales”.'}</td></tr>`;
  if (kSel && PRODUCTOS.has(kSel)) pintarDetKardex();
}
$('kProds').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-id]'); if (!tr) return;
  kSel = tr.dataset.id; document.querySelectorAll('#kProds tr').forEach(x => x.classList.toggle('sel', x === tr));
  $('kDet').innerHTML = '<div class="vacio">Cargando movimientos…</div>';
  try { const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', kSel))); kMovs = s.docs.map(d => d.data()).sort((a, b) => a.ms - b.ms); pintarDetKardex(); }
  catch (err) { $('kDet').innerHTML = `<div class="aviso error">${esc(errorTexto(err))}</div>`; }
});
function pintarDetKardex() {
  const p = PRODUCTOS.get(kSel); if (!p) return;
  $('kDet').innerHTML = `<div class="cab"><div><h3 style="margin:0">${esc(p.nombre)}</h3><p class="nota">${esc(p.codigo)} · ${esc(p.unidad)}</p></div><button class="btn sec chico" type="button" id="kCsvMov">Exportar este kardex</button></div>
    <div class="ficha"><div>Stock<b>${nq(p.stock)}</b></div><div>Costo promedio<b>S/ ${n2(p.cProm)}</b></div><div>Valor<b>S/ ${n2(p.valor)}</b></div><div>Movimientos<b>${kMovs.length}</b></div></div>
    <div class="tabla"><table><thead><tr><th>Fecha</th><th>Mov.</th><th>Documento</th><th>Proveedor / destino</th><th class="num">Entrada</th><th class="num">Salida</th><th class="num">Saldo</th><th class="num">C. unit</th><th class="num">C. total</th><th class="num">C. prom.</th><th class="num">Saldo S/</th></tr></thead>
    <tbody>${kMovs.length ? kMovs.map(m => { const ent = m.tipo === 'ENTRADA' || m.origen === 'AJUSTE+'; const t = m.tipo === 'AJUSTE' ? 'AJUSTE' : m.tipo; return `<tr><td>${fmtF(m.fecha)}</td><td><span class="pill ${t}">${esc(m.origen === 'ANULACION' ? 'ANULA' : m.tipo === 'AJUSTE' ? m.origen : m.tipo)}</span></td><td>${esc(m.documento)}${m.lote ? `<br><small class="nota">Lote ${esc(m.lote)}${m.vence ? ' · vence ' + fmtF(m.vence) : ''}</small>` : ''}</td><td>${esc(m.tercero || '')}${m.persona ? `<br><small class="nota">${esc(m.persona)}</small>` : ''}</td><td class="num">${ent ? nq(m.cant) : ''}</td><td class="num">${ent ? '' : nq(m.cant)}</td><td class="num"><b>${nq(m.saldoCant)}</b></td><td class="num">${n2(m.cu)}</td><td class="num">${n2(m.ct)}</td><td class="num">${n2(m.cProm)}</td><td class="num">${n2(m.saldoValor)}</td></tr>`; }).join('') : '<tr><td colspan="11" class="vacio">Sin movimientos.</td></tr>'}</tbody></table></div>`;
  $('kCsvMov').addEventListener('click', () => descargarCSV(`kardex_${p.codigo}.csv`, filasKardex(kMovs)));
}
function filasKardex(movs) {
  return [['Código', 'Producto', 'Unidad', 'Fecha', 'Movimiento', 'Origen', 'Documento', 'Proveedor / destino', 'Entregado a', 'Entrada', 'Salida', 'Saldo cantidad', 'Costo unitario', 'Costo total', 'Costo promedio', 'Saldo valorizado', 'Lote', 'Vencimiento', 'Usuario']]
    .concat(movs.map(m => { const ent = m.tipo === 'ENTRADA' || m.origen === 'AJUSTE+'; return [m.codigo, m.producto, m.unidad, fmtF(m.fecha), m.tipo, m.origen, m.documento, m.tercero || '', m.persona || '', ent ? String(m.cant).replace('.', ',') : '', ent ? '' : String(m.cant).replace('.', ','), String(m.saldoCant).replace('.', ','), numCSV(m.cu), numCSV(m.ct), numCSV(m.cProm), numCSV(m.saldoValor), m.lote || '', fmtF(m.vence), m.usuario]; }));
}
$('kCsvProd').addEventListener('click', () => descargarCSV('productos_kardex.csv', [['Código', 'Producto', 'Unidad', 'Stock', 'Costo promedio', 'Valor', 'Último movimiento']].concat([...PRODUCTOS.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)).map(p => [p.codigo, p.nombre, p.unidad, String(p.stock).replace('.', ','), numCSV(p.cProm), numCSV(p.valor), fmtF(p.ultMov)]))));
$('kCsvTodo').addEventListener('click', async e => {
  const b = e.currentTarget; ocupado(b, true, 'Preparando…');
  try { const s = await getDocs(collection(db, 'movimientos')); const m = s.docs.map(d => d.data()).sort((a, b2) => a.codigo.localeCompare(b2.codigo) || a.ms - b2.ms); descargarCSV('kardex_completo.csv', filasKardex(m)); }
  catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});

/* Salidas y ajustes */
$('kMov').addEventListener('click', () => {
  $('fMov').reset(); $('mFecha').value = hoyISO(); $('mMsg').textContent = ''; $('mInfo').textContent = '';
  opciones($('mDestino'), LISTAS.areas, '', '— Elegir —');
  if (kSel && PRODUCTOS.has(kSel)) $('mProd').value = etiquetaProd(PRODUCTOS.get(kSel));
  $('mTipo').querySelectorAll('option[value^="AJUSTE"]').forEach(o => o.disabled = YO.rol !== 'ADMIN');
  infoMov(); cargarPersonalSilencioso(); $('dMov').showModal();
});
$('mCerrar').addEventListener('click', () => $('dMov').close());
$('mProd').addEventListener('input', infoMov);
$('mTipo').addEventListener('change', infoMov);
function infoMov() {
  const p = buscarProd($('mProd').value);
  $('mCostoL').hidden = $('mTipo').value !== 'AJUSTE+';
  $('mInfo').textContent = p ? `Stock actual: ${nq(p.stock)} ${p.unidad} · costo promedio S/ ${n2(p.cProm)}` : '';
  if (p && $('mTipo').value === 'AJUSTE+' && !$('mCosto').value) $('mCosto').value = p.cProm || '';
}
$('fMov').addEventListener('submit', async e => {
  e.preventDefault();
  const p = buscarProd($('mProd').value); if (!p) return $('mMsg').textContent = 'Elige un producto de la lista.';
  const tipoSel = $('mTipo').value, q = r4(num($('mCant').value));
  if (q <= 0) return $('mMsg').textContent = 'La cantidad debe ser mayor a cero.';
  if (tipoSel === 'SALIDA' && !$('mDestino').value) return $('mMsg').textContent = 'Elige el destino o área.';
  const b = e.submitter; ocupado(b, true, 'Registrando…'); $('mMsg').textContent = '';
  try {
    await runTransaction(db, async tx => {
      const ref = doc(db, 'productos', p.id), s = await tx.get(ref); const d = s.data();
      let stock = d.stock, valor = d.valor, cu = d.cProm || 0;
      const ingreso = tipoSel === 'AJUSTE+';
      if (ingreso) { cu = r4(num($('mCosto').value) || d.cProm || 0); stock = r4(stock + q); valor = r2(valor + q * cu); }
      else { if (q > stock + 1e-9) throw new Error(`Stock insuficiente: hay ${nq(stock)} ${d.unidad}.`); stock = r4(stock - q); valor = stock <= 1e-9 ? 0 : r2(valor - q * cu); }
      const cProm = stock > 0 ? r4(valor / stock) : 0;
      tx.update(ref, { stock, valor, cProm, actMs: Date.now(), ultMov: $('mFecha').value });
      tx.set(doc(collection(db, 'movimientos')), {
        productoId: p.id, codigo: d.codigo, producto: d.nombre, unidad: d.unidad, fecha: $('mFecha').value, ms: Date.now(),
        tipo: tipoSel === 'SALIDA' ? 'SALIDA' : 'AJUSTE', origen: tipoSel === 'SALIDA' ? 'CONSUMO' : tipoSel, documento: limpio($('mMotivo').value), tercero: $('mDestino').value, persona: limpio($('mPersona').value),
        cant: q, cu, ct: r2(q * cu), saldoCant: stock, cProm, saldoValor: valor, usuario: YO.nombre, uid: YO.uid, creado: serverTimestamp()
      });
    });
    $('dMov').close(); toast('Movimiento registrado.');
    if (kSel === p.id) { const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', kSel))); kMovs = s.docs.map(d => d.data()).sort((a, b2) => a.ms - b2.ms); pintarDetKardex(); }
  } catch (err) { $('mMsg').textContent = errorTexto(err); }
  ocupado(b, false);
});

/* ================= RR. HH. ================= */
let personalCargado = false;
async function cargarPersonal(forzar) {
  if (personalCargado && !forzar) return;
  const s = await getDocs(collection(db, 'personal'));
  PERSONAL = new Map(s.docs.map(d => [d.id, { dni: d.id, ...d.data() }]));
  personalCargado = true;
  $('dlPersonal').innerHTML = [...PERSONAL.values()].filter(p => p.estado !== 'CESADO').map(p => `<option value="${esc(p.nombre)}">${esc(p.dni)} · ${esc(p.area || '')}</option>`).join('');
}
function cargarPersonalSilencioso() { cargarPersonal().catch(() => { }); }
async function abrirRRHH() {
  ['pNuevo', 'pImportar'].forEach(id => $(id).hidden = !puede('personal'));
  opciones($('pfArea'), LISTAS.areas, $('pfArea').value || '', 'Todas');
  $('pFilas').innerHTML = '<tr><td colspan="9" class="vacio">Cargando…</td></tr>';
  try { await cargarPersonal(true); pintarRRHH(); } catch (e) { $('pFilas').innerHTML = `<tr><td colspan="9"><div class="aviso error">${esc(errorTexto(e))}</div></td></tr>`; }
}
['pfArea', 'pfEstado', 'pfQ'].forEach(id => $(id).addEventListener('input', pintarRRHH));
function filtrarRRHH() {
  const a = $('pfArea').value, est = $('pfEstado').value, q = norm($('pfQ').value);
  return [...PERSONAL.values()].filter(p => (!a || p.area === a) && (!est || (p.estado || 'ACTIVO') === est) && (!q || norm(p.dni + ' ' + p.nombre + ' ' + (p.cargo || '')).includes(q))).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));
}
function pintarRRHH() {
  const l = filtrarRRHH();
  const act = [...PERSONAL.values()].filter(p => (p.estado || 'ACTIVO') === 'ACTIVO').length;
  $('pRes').innerHTML = `<span><b>${l.length}</b> en la lista</span><span>Activos en total: <b>${act}</b></span>`;
  $('pFilas').innerHTML = l.length ? l.map(p => `<tr><td>${esc(p.dni)}</td><td>${esc(p.nombre)}</td><td>${esc(p.cargo || '')}</td><td>${esc(p.area || '')}</td><td>${esc(p.empresa || '')}</td><td>${fmtF(p.ingreso)}</td><td>${esc(p.celular || '')}</td><td><span class="pill ${(p.estado || 'ACTIVO') === 'ACTIVO' ? 'APROBADO' : 'ANULADO'}">${esc(p.estado || 'ACTIVO')}</span></td><td>${puede('personal') ? `<button class="btn sec chico" data-dni="${esc(p.dni)}">Editar</button>` : ''}</td></tr>`).join('')
    : `<tr><td colspan="9" class="vacio">${PERSONAL.size ? 'Nadie coincide con el filtro.' : 'Todavía no hay personal. Usa “Importar del formulario de uniformes” para traer a quienes ya respondieron, o “+ Nuevo trabajador”.'}</td></tr>`;
}
$('pFilas').addEventListener('click', e => { const b = e.target.closest('[data-dni]'); if (b) abrirPer(PERSONAL.get(b.dataset.dni)); });
$('pNuevo').addEventListener('click', () => abrirPer(null));
$('pCerrar').addEventListener('click', () => $('dPer').close());
function abrirPer(p) {
  $('fPer').reset(); $('pMsg').textContent = '';
  $('pTit').textContent = p ? 'Editar trabajador' : 'Nuevo trabajador';
  opciones($('pArea'), LISTAS.areas, p?.area || '', '— Elegir —');
  opciones($('pEmpresa'), LISTAS.empresas.map(e => e.nombre), p?.empresa || LISTAS.empresas[0]?.nombre);
  $('pDni').value = p?.dni || ''; $('pDni').disabled = !!p;
  $('pNombre').value = p?.nombre || ''; $('pCargo').value = p?.cargo || ''; $('pEstado').value = p?.estado || 'ACTIVO';
  $('pIngreso').value = p?.ingreso || ''; $('pNac').value = p?.nacimiento || ''; $('pCel').value = p?.celular || ''; $('pCorreo').value = p?.correo || '';
  $('pDir').value = p?.direccion || ''; $('pTallaS').value = p?.tallaSup || ''; $('pTallaP').value = p?.tallaInf || ''; $('pObs').value = p?.obs || '';
  $('dPer').showModal();
}
$('fPer').addEventListener('submit', async e => {
  e.preventDefault();
  const dni = limpio($('pDni').value);
  if (!/^\d{8}$/.test(dni)) return $('pMsg').textContent = 'El DNI debe tener 8 dígitos.';
  const editando = $('pDni').disabled;
  if (!editando && PERSONAL.has(dni)) return $('pMsg').textContent = 'Ya existe un trabajador con ese DNI.';
  const d = { nombre: limpio($('pNombre').value).toUpperCase(), cargo: limpio($('pCargo').value).toUpperCase(), area: $('pArea').value, empresa: $('pEmpresa').value, estado: $('pEstado').value, ingreso: $('pIngreso').value, nacimiento: $('pNac').value, celular: limpio($('pCel').value), correo: limpio($('pCorreo').value).toLowerCase(), direccion: limpio($('pDir').value), tallaSup: limpio($('pTallaS').value).toUpperCase(), tallaInf: limpio($('pTallaP').value).toUpperCase(), obs: limpio($('pObs').value), actMs: Date.now(), actPor: YO.nombre };
  const b = e.submitter; ocupado(b, true, 'Guardando…');
  try { await setDoc(doc(db, 'personal', dni), d, { merge: true }); PERSONAL.set(dni, { dni, ...(PERSONAL.get(dni) || {}), ...d }); $('dPer').close(); toast('Trabajador guardado.'); pintarRRHH(); }
  catch (err) { $('pMsg').textContent = errorTexto(err); }
  ocupado(b, false);
});
$('pCsv').addEventListener('click', () => descargarCSV('personal.csv', [['DNI', 'Apellidos y nombres', 'Cargo', 'Área / sucursal', 'Empresa', 'Estado', 'Fecha de ingreso', 'Fecha de nacimiento', 'Celular', 'Correo', 'Dirección', 'Talla superior', 'Talla inferior', 'Observaciones']].concat(filtrarRRHH().map(p => [p.dni, p.nombre, p.cargo, p.area, p.empresa, p.estado, fmtF(p.ingreso), fmtF(p.nacimiento), p.celular, p.correo, p.direccion, p.tallaSup, p.tallaInf, p.obs]))));
$('pImportar').addEventListener('click', async e => {
  const b = e.currentTarget; ocupado(b, true, 'Importando…');
  try {
    await leerUniformes(true);
    const nuevos = [...UNI.values()].filter(r => r.dni && !PERSONAL.has(r.dni));
    if (!nuevos.length) { toast('No hay personas nuevas en el formulario.'); ocupado(b, false); return; }
    if (!confirm(`Se agregarán ${nuevos.length} personas que respondieron el formulario de uniformes y todavía no están en Personal. ¿Continuar?`)) { ocupado(b, false); return; }
    for (let i = 0; i < nuevos.length; i += 400) {
      const lote = writeBatch(db);
      nuevos.slice(i, i + 400).forEach(r => lote.set(doc(db, 'personal', r.dni), { nombre: r.nombre.toUpperCase(), cargo: '', area: areaDeSucursal(r.suc), empresa: LISTAS.empresas[0]?.nombre || '', estado: 'ACTIVO', tallaSup: r.tallaSup || '', tallaInf: r.tallaInf || '', actMs: Date.now(), actPor: YO.nombre + ' (importado del formulario)' }));
      await lote.commit();
    }
    toast(`${nuevos.length} trabajadores importados. Completa su cargo y datos.`);
    await cargarPersonal(true); pintarRRHH();
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});
function areaDeSucursal(s) { const t = norm(s); return LISTAS.areas.find(a => norm(a) === t) || LISTAS.areas.find(a => norm(a).replace(/[^a-z]/g, '') === t.replace(/[^a-z]/g, '')) || limpio(s).toUpperCase(); }

/* ================= Formulario de uniformes (Google Sheets) ================= */
const PRENDAS = [['moñera', 'Moñera'], ['collet', 'Collet'], ['chompa', 'Chompa'], ['casaca', 'Casaca'], ['buzo deportivo', 'Buzo deportivo'], ['fotocheck', 'Fotocheck'], ['chaqueta logueada', 'Chaqueta logueada'], ['mangas', 'Mangas'], ['chaleco de seguridad', 'Chaleco de seguridad'], ['guantes de seguridad', 'Guantes de seguridad'], ['faja de seguridad', 'Faja de seguridad'], ['fotochek', 'Fotocheck']];
let UNI = new Map(), UNI_OK = false;
function gvizFecha(v) { const m = /^Date\((\d+),(\d+),(\d+)(?:,(\d+),(\d+),(\d+))?\)$/.exec(String(v || '')); if (!m) return null; const d = new Date(+m[1], +m[2], +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)); d.setFullYear(+m[1]); return d; }
async function leerUniformes(forzar) {
  if (UNI_OK && !forzar) return;
  const r = await fetch(`https://docs.google.com/spreadsheets/d/${SHEET_UNIFORMES}/gviz/tq?tqx=out:json&headers=1&t=${Date.now()}`);
  const t = await r.text(); const j = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
  if (j.status !== 'ok') throw new Error('Google Sheets respondió con error. Revisa que la hoja siga compartida con el enlace.');
  const cols = j.table.cols, M = { ts: -1, nombre: -1, dni: -1, suc: -1, items: PRENDAS.map(([k, n]) => ({ k: norm(k), n, rec: -1, fecha: -1, estado: -1, obs: -1, talla: -1 })) };
  let ult = null;
  cols.forEach((c, i) => {
    const h = norm(c.label);
    if (h === 'marca temporal') return M.ts = i; if (h === 'nombre completo') return M.nombre = i; if (h === 'dni') return M.dni = i; if (h === 'sucursal') return M.suc = i;
    let it = M.items.find(x => h.includes(x.k)) || ult; if (!it) return; ult = it;
    const rol = h.includes('talla') ? 'talla' : h.includes('usted recibio') ? 'rec' : h.includes('fecha') ? 'fecha' : h.includes('estado') ? 'estado' : h.includes('observacion') ? 'obs' : null;
    if (rol && it[rol] === -1) it[rol] = i;
  });
  const cel = (row, i) => i < 0 || !row.c || !row.c[i] ? null : row.c[i];
  const tx = (row, i) => { const c = cel(row, i); return !c || c.v === null || c.v === undefined ? '' : limpio(c.f ?? c.v); };
  const grupos = new Map();
  j.table.rows.forEach(row => {
    const c = cel(row, M.dni); const dni = !c || c.v === null ? '' : (typeof c.v === 'number' ? String(Math.round(c.v)) : limpio(c.v)).padStart(8, '0');
    const nombre = tx(row, M.nombre); if (!dni && !nombre) return;
    const ts = gvizFecha(cel(row, M.ts)?.v) || new Date(0);
    const prendas = M.items.map(it => {
      const rec = norm(tx(row, it.rec)), fecha = tx(row, it.fecha), est = tx(row, it.estado);
      const si = rec === 'si', dudoso = !rec && !!(fecha || est); if (!si && !dudoso) return null;
      const fc = cel(row, it.fecha), fd = fc && fc.v ? gvizFecha(fc.v) : null;
      return { n: it.n, fecha, fechaRev: !!fd && (fd.getFullYear() < 2020 || fd > new Date()), est, obs: tx(row, it.obs), talla: tx(row, it.talla), dudoso };
    }).filter(Boolean);
    const tallaDe = n => prendas.find(p => p.n === n)?.talla || '';
    const r = { dni, nombre, suc: tx(row, M.suc), ts, tsTxt: tx(row, M.ts), prendas, tallaSup: tallaDe('Chompa') || tallaDe('Casaca') || tallaDe('Chaqueta logueada'), tallaInf: tallaDe('Buzo deportivo') };
    const k = dni || norm(nombre); if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r);
  });
  UNI = new Map(); UNI_RESP = new Map();
  grupos.forEach((l, k) => { l.sort((a, b) => b.ts - a.ts); UNI.set(k, l[0]); UNI_RESP.set(k, l); });
  UNI_OK = true;
}
let UNI_RESP = new Map();

/* ================= Cargo de entrega ================= */
let gSel = null, gRespIdx = {}, gLista = [];
async function abrirCargo() {
  $('gEstado').textContent = 'Cargando…';
  const errores = [];
  await Promise.all([cargarPersonal(true).catch(e => errores.push('Personal: ' + errorTexto(e))), leerUniformes(false).catch(e => errores.push('Formulario: ' + e.message))]);
  armarListaCargo();
  $('gEstado').textContent = errores.length ? errores.join(' · ') : `${gLista.length} trabajadores · ${UNI.size} respondieron el formulario`;
}
$('gRecargar').addEventListener('click', async () => { $('gEstado').textContent = 'Actualizando…'; try { await leerUniformes(true); } catch (e) { toast(e.message, true); } armarListaCargo(); $('gEstado').textContent = `${gLista.length} trabajadores · ${UNI.size} respondieron el formulario`; if (gSel) mostrarCargo(gSel); });
function armarListaCargo() {
  const m = new Map();
  PERSONAL.forEach(p => { if ((p.estado || 'ACTIVO') === 'ACTIVO') m.set(p.dni, { key: p.dni, dni: p.dni, nombre: p.nombre, area: p.area || '', per: p }); });
  UNI.forEach((r, k) => { const x = m.get(k); if (x) x.uni = k; else m.set(k, { key: k, dni: r.dni, nombre: r.nombre, area: areaDeSucursal(r.suc), uni: k }); });
  gLista = [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const sucs = [...new Set(gLista.map(x => x.area).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  opciones($('gSuc'), sucs, sucs.includes($('gSuc').value) ? $('gSuc').value : '', 'Todas las sucursales');
  pintarListaCargo();
}
function filtrarCargo() { const q = norm($('gQ').value), s = $('gSuc').value; return gLista.filter(x => (!s || x.area === s) && (!q || norm(x.nombre).includes(q) || (x.dni || '').includes(q))); }
function pintarListaCargo() {
  const l = filtrarCargo();
  $('gLista').innerHTML = l.length ? l.map(x => { const n = x.uni ? (UNI_RESP.get(x.uni) || []).length : 0; return `<div class="persona${x.key === gSel ? ' sel' : ''}" data-k="${esc(x.key)}" tabindex="0" role="button"><b>${esc(x.nombre)}${n > 1 ? `<span class="chip">${n} respuestas</span>` : ''}</b><small>DNI ${esc(x.dni)} · ${esc(x.area)}${x.uni ? '' : ' · sin formulario'}</small></div>`; }).join('') : '<div class="vacio">Nadie coincide.</div>';
  $('gTodos').disabled = !l.length; $('gTodos').textContent = `Imprimir todos (${l.length})`;
}
$('gQ').addEventListener('input', pintarListaCargo); $('gSuc').addEventListener('change', pintarListaCargo);
$('gLista').addEventListener('click', e => { const it = e.target.closest('[data-k]'); if (it) mostrarCargo(it.dataset.k); });
$('gLista').addEventListener('keydown', e => { const it = e.target.closest('[data-k]'); if (it && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); mostrarCargo(it.dataset.k); } });
const hoyTxt = () => fmtF(hoyISO());
function campoH(k, v, o = {}) { return `<div class="campo${o.full ? ' full' : ''}"><span class="k">${k}:</span><span class="v"${o.ro ? '' : ' contenteditable="true"'}${o.id ? ` data-guardar="${o.id}"` : ''}>${esc(v)}</span></div>`; }
const guardado = k => { try { return localStorage.getItem('erp_' + k) || ''; } catch (e) { return ''; } };
document.addEventListener('input', e => { const k = e.target.dataset?.guardar; if (k) try { localStorage.setItem('erp_' + k, e.target.textContent.trim()); } catch (er) { } });
function respDe(x) { if (!x.uni) return null; const l = UNI_RESP.get(x.uni) || []; return l[Math.min(gRespIdx[x.key] || 0, l.length - 1)] || null; }
function hojaCargo(x) {
  const r = respDe(x), per = x.per || PERSONAL.get(x.dni);
  const emp = LISTAS.empresas.find(e => e.nombre === per?.empresa) || LISTAS.empresas[0] || { nombre: '', ruc: '' };
  const nombre = (per?.nombre || x.nombre).toUpperCase(), area = per?.area || x.area, prendas = r ? r.prendas : [];
  const filas = prendas.map((p, i) => `<tr${p.dudoso ? ' class="dudoso" title="No marcó que la recibió, pero llenó fecha o estado"' : ''}><td class="c">${i + 1}</td><td contenteditable="true">${esc(p.n)}</td><td class="c" contenteditable="true">${esc(p.talla)}</td><td class="c" contenteditable="true">1</td><td class="c" contenteditable="true">UND</td><td class="c${p.fechaRev ? ' rev' : ''}" contenteditable="true">${esc(p.fecha)}</td><td contenteditable="true">${[p.est, p.obs].filter(Boolean).map(esc).join(' – ')}</td></tr>`).join('');
  const vac = Array.from({ length: Math.max(0, 5 - prendas.length) }, (_, i) => `<tr><td class="c">${prendas.length + i + 1}</td>${'<td contenteditable="true"></td>'.repeat(6)}</tr>`).join('');
  return `<section class="hoja">
    <div class="enc"><img src="logo.png" alt=""><div class="t"><h2>CARGO DE ENTREGA DE ÚTILES DE TRABAJO</h2><div class="sub">${esc(emp.nombre)}${emp.ruc ? ' · RUC ' + esc(emp.ruc) : ''}</div></div><div class="cod">${r ? 'Resp. ' + esc(r.tsTxt.split(' ')[0]) : ''}</div></div>
    <div class="hg2">${campoH('Empresa', emp.nombre)}${campoH('RUC', emp.ruc)}${campoH('Área', area)}${campoH('Fecha de entrega', hoyTxt())}</div>
    <h3>DATOS DEL TRABAJADOR</h3>
    <div class="hg2">${campoH('Nombres y apellidos', nombre, { full: true })}${campoH('DNI', x.dni)}${campoH('Cargo', per?.cargo || '')}${campoH('Área de trabajo', area, { full: true })}</div>
    <h3>DETALLE DE LOS ÚTILES ENTREGADOS</h3>
    <table><thead><tr><th style="width:7mm">N.º</th><th>Descripción del útil</th><th style="width:12mm">Talla</th><th style="width:12mm">Cant.</th><th style="width:13mm">Unidad</th><th style="width:22mm">Fecha de recepción</th><th>Estado / Observaciones</th></tr></thead><tbody>${filas}${vac}</tbody></table>
    <h3>CONSTANCIA DE RECEPCIÓN</h3>
    <p class="const">Declaro haber recibido los útiles de trabajo detallados en el presente documento, en las cantidades y condiciones indicadas, para el desarrollo de mis funciones laborales.</p>
    <h3>OBSERVACIONES</h3><div class="obs" contenteditable="true"></div>
    <div class="firmas">
      <div class="firma"><div class="tit">ENTREGUÉ CONFORME</div><div class="linea"></div>${campoH('Firma', '', { ro: true })}${campoH('Nombre', guardado('entrega_nombre') || YO?.nombre || '', { id: 'entrega_nombre' })}${campoH('Cargo', guardado('entrega_cargo'), { id: 'entrega_cargo' })}${campoH('Fecha', hoyTxt())}</div>
      <div class="firma"><div class="tit">RECIBÍ CONFORME</div><div class="linea"></div>${campoH('Firma', '', { ro: true })}${campoH('Nombre', nombre)}${campoH('DNI', x.dni)}${campoH('Fecha', hoyTxt())}</div>
    </div></section>`;
}
function mostrarCargo(key) {
  gSel = key; const x = gLista.find(y => y.key === key); if (!x) return;
  document.querySelectorAll('#gLista .persona').forEach(el => el.classList.toggle('sel', el.dataset.k === key));
  $('gHojas').innerHTML = hojaCargo(x);
  const r = respDe(x), l = x.uni ? UNI_RESP.get(x.uni) || [] : [], av = [];
  if (!x.uni) av.push('<div class="aviso">Esta persona no respondió el formulario de uniformes; la tabla queda en blanco para llenarla a mano.</div>');
  if (l.length > 1) av.push(`<div class="aviso">Respondió ${l.length} veces. Usando la respuesta del <select id="gResp" aria-label="Respuesta">${l.map((y, i) => `<option value="${i}"${y === r ? ' selected' : ''}>${esc(y.tsTxt)}${i === 0 ? ' (más reciente)' : ''} · ${esc(y.suc)}</option>`).join('')}</select></div>`);
  if (r?.prendas.some(p => p.fechaRev)) av.push('<div class="aviso">Hay fechas imposibles o futuras (en rojo). Corrígelas haciendo clic sobre ellas.</div>');
  if (r?.prendas.some(p => p.dudoso)) av.push('<div class="aviso">Algunas prendas (sombreadas) tienen fecha o estado pero no se marcó que se recibieron. Revísalas.</div>');
  if (!(x.per || PERSONAL.get(x.dni))?.cargo) av.push('<div class="aviso">Falta el cargo. Escríbelo en la hoja o regístralo en Personal.</div>');
  $('gAvisos').innerHTML = av.join('');
  const s = $('gResp'); if (s) s.onchange = () => { gRespIdx[key] = +s.value; mostrarCargo(key); };
  $('gImprimir').disabled = false;
}
$('gImprimir').addEventListener('click', () => window.print());
$('gTodos').addEventListener('click', () => {
  const l = filtrarCargo(); if (!l.length) return;
  $('gHojas').innerHTML = l.map(hojaCargo).join(''); $('gAvisos').innerHTML = '';
  setTimeout(() => { window.print(); if (gSel) mostrarCargo(gSel); else $('gHojas').innerHTML = ''; }, 300);
});

/* ================= Usuarios ================= */
async function abrirUsuarios() {
  $('uRoles').innerHTML = '<b>Roles:</b><br>' + ROLES.map(r => `<b>${r}</b>: ${esc(DESC_ROL[r])}`).join('<br>');
  $('uFilas').innerHTML = '<tr><td colspan="5" class="vacio">Cargando…</td></tr>';
  try {
    const s = await getDocs(collection(db, 'usuarios'));
    const l = s.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.usuario.localeCompare(b.usuario));
    $('uFilas').innerHTML = l.map(u => `<tr><td>${esc(u.usuario)}</td><td>${esc(u.nombre)}</td><td><select data-rol="${esc(u.uid)}" aria-label="Rol"${u.uid === YO.uid ? ' disabled' : ''}>${ROLES.map(r => `<option${r === u.rol ? ' selected' : ''}>${r}</option>`).join('')}</select></td><td><span class="pill ${u.activo ? 'APROBADO' : 'ANULADO'}">${u.activo ? 'ACTIVO' : 'INACTIVO'}</span></td><td>${u.uid === YO.uid ? '<small class="nota">Tú</small>' : `<button class="btn sec chico" data-act="${esc(u.uid)}" data-v="${u.activo ? '0' : '1'}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('');
  } catch (e) { $('uFilas').innerHTML = `<tr><td colspan="5"><div class="aviso error">${esc(errorTexto(e))}</div></td></tr>`; }
}
$('uFilas').addEventListener('change', async e => { const s = e.target.closest('[data-rol]'); if (!s) return; try { await updateDoc(doc(db, 'usuarios', s.dataset.rol), { rol: s.value }); toast('Rol actualizado.'); } catch (err) { toast(errorTexto(err), true); } });
$('uFilas').addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; ocupado(b, true); try { await updateDoc(doc(db, 'usuarios', b.dataset.act), { activo: b.dataset.v === '1' }); abrirUsuarios(); } catch (err) { toast(errorTexto(err), true); ocupado(b, false); } });
$('uNuevo').addEventListener('click', () => { $('fUsr').reset(); $('uMsg').textContent = ''; opciones($('uRol'), ROLES, 'LOGISTICA'); $('dUsr').showModal(); });
$('uCerrar').addEventListener('click', () => $('dUsr').close());
$('fUsr').addEventListener('submit', async e => {
  e.preventDefault();
  const usuario = limpio($('uUsr').value).toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return $('uMsg').textContent = 'El usuario debe tener de 3 a 30 letras o números, sin espacios.';
  const b = e.submitter; ocupado(b, true, 'Creando…');
  // Se usa una segunda conexión para crear la cuenta sin cerrar la sesión del administrador
  const aux = initializeApp(firebaseConfig, 'aux' + Date.now());
  try {
    const cred = await createUserWithEmailAndPassword(getAuth(aux), usuario + DOMINIO, $('uClave').value);
    await setDoc(doc(db, 'usuarios', cred.user.uid), { usuario, nombre: limpio($('uNom').value), rol: $('uRol').value, activo: true, creado: serverTimestamp() });
    await signOut(getAuth(aux));
    $('dUsr').close(); toast(`Usuario ${usuario} creado. Pásale su contraseña inicial.`); abrirUsuarios();
  } catch (err) { $('uMsg').textContent = errorTexto(err); }
  deleteApp(aux).catch(() => { });
  ocupado(b, false);
});

/* ================= Configuración ================= */
function abrirConfig() {
  $('cfClave').value = IA?.clave || ''; $('cfModelo').value = IA?.modelo || 'gemini-2.5-flash';
  $('cfEmpresas').value = LISTAS.empresas.map(e => e.nombre + (e.ruc ? ' | ' + e.ruc : '')).join('\n');
  $('cfAreas').value = LISTAS.areas.join('\n'); $('cfGastos').value = LISTAS.gastos.join('\n'); $('cfFormas').value = LISTAS.formas.join('\n');
  $('cfCond').value = LISTAS.condiciones.join('\n'); $('cfUnid').value = LISTAS.unidades.join('\n'); $('cfCargos').value = LISTAS.cargos.join('\n');
}
$('cfGuardar').addEventListener('click', async e => {
  const lin = id => [...new Set($(id).value.split('\n').map(x => limpio(x).toUpperCase()).filter(Boolean))];
  const l = {
    empresas: lin('cfEmpresas').map(x => { const [n, r] = x.split('|').map(limpio); return { nombre: n, ruc: (r || '').replace(/\D/g, '') }; }),
    areas: lin('cfAreas'), gastos: lin('cfGastos'), formas: lin('cfFormas'), condiciones: lin('cfCond'), unidades: lin('cfUnid'), cargos: lin('cfCargos')
  };
  if (Object.values(l).some(v => !v.length)) return toast('Ninguna lista puede quedar vacía.', true);
  const b = e.currentTarget; ocupado(b, true, 'Guardando…');
  try {
    await setDoc(doc(db, 'config', 'listas'), l);
    await setDoc(doc(db, 'config', 'ia'), { clave: limpio($('cfClave').value), modelo: limpio($('cfModelo').value) || 'gemini-2.5-flash' });
    await cargarBase(); toast('Configuración guardada.');
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});
