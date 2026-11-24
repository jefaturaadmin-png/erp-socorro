// ERP Socorro — Farmacia Socorro
// GitHub Pages + Firebase (Auth + Firestore). Lectura de comprobantes con Google Gemini.
import { initializeApp, deleteApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, updatePassword } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, onSnapshot, runTransaction, writeBatch, serverTimestamp, deleteField } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { CENTROS_COSTO } from './centros.js';

/* ================= Configuración fija ================= */
const DOMINIO = '@erp-socorro.example.com'; // los usuarios solo escriben su nombre de usuario
const SHEET_UNIFORMES = '1VG8CztNg3nO1oB1tIUCTnVIEm0_qPuwUVl7hoVF9WWA';
const IGV = 0.18;
const MODELO_IA = 'gemini-3.8-flash'; // modelo vigente de Google Gemini
const VERSION = '2026.11.24f'; // cambiarla también en index.html (app.js?v=...) para que los navegadores no usen la copia vieja
const MODELOS_RETIRADOS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash'];
const ROLES = ['ADMIN', 'LOGISTICA', 'COMPRAS', 'ALMACEN', 'RRHH', 'GERENCIA', 'CONSULTA'];
// El rol LOGISTICA se guarda con ese nombre (usuarios y reglas ya creados), pero se muestra como ADMINISTRACION
const rolTxt = r => r === 'LOGISTICA' ? 'ADMINISTRACION' : r;
const MODULOS = [
  { id: 'inicio', nombre: 'Inicio', grupo: 'General' },
  { id: 'solicitudes', nombre: 'Solicitudes de sucursales', grupo: 'Administración' },
  { id: 'servicios', nombre: 'Ingreso de servicios', grupo: 'Administración' },
  { id: 'compras', nombre: 'Ingreso de materiales', grupo: 'Administración' },
  { id: 'salidas', nombre: 'Salida de materiales', grupo: 'Administración' },
  { id: 'kardex', nombre: 'Kardex', grupo: 'Administración' },
  { id: 'inventario', nombre: 'Toma de inventario', grupo: 'Administración' },
  { id: 'rrhh', nombre: 'Personal', grupo: 'RR. HH.' },
  { id: 'cargo', nombre: 'Cargo de útiles', grupo: 'RR. HH.' },
  { id: 'usuarios', nombre: 'Usuarios', grupo: 'Sistema' },
  { id: 'config', nombre: 'Configuración', grupo: 'Sistema' }
];
const ACCESO = {
  ADMIN: MODULOS.map(m => m.id),
  LOGISTICA: ['inicio', 'solicitudes', 'servicios', 'compras', 'salidas', 'kardex', 'cargo'],
  COMPRAS: ['inicio', 'solicitudes', 'servicios', 'compras', 'salidas', 'kardex'],
  ALMACEN: ['inicio', 'solicitudes', 'compras', 'salidas', 'kardex'],
  RRHH: ['inicio', 'rrhh', 'cargo'],
  GERENCIA: ['inicio', 'solicitudes', 'servicios', 'compras', 'salidas', 'kardex', 'rrhh', 'cargo'],
  CONSULTA: ['inicio', 'solicitudes', 'servicios', 'compras', 'salidas', 'kardex']
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
  ALMACEN: 'Ve compras y registra salidas de materiales',
  RRHH: 'Registra personal e imprime cargos de útiles',
  GERENCIA: 'Ve todo y aprueba o rechaza comprobantes',
  CONSULTA: 'Solo mira servicios, compras y kardex'
};
const TIPOS_DOC = ['FACTURA', 'BOLETA', 'RECIBO POR HONORARIOS', 'NOTA DE CREDITO', 'NOTA DE DEBITO', 'TICKET', 'OTRO'];
const DEF_LISTAS = {
  empresas: [{ nombre: 'FS SOCORRO S.A.C.', ruc: '20486562341' }, { nombre: 'FS INNOVA SOCORRO', ruc: '' }, { nombre: 'HEALTH PREVENTIVE', ruc: '' }],
  areas: ['ADMINISTRACIÓN', 'DROGUERÍA FS', 'REAL', 'MERCADO', 'TUPAC', 'ORTEGA', 'HUANCAS', 'HEROES', 'MCDO. TAMBO', 'PARRA', 'SUMAR', 'PUNO', 'PIOPATA', 'CONCEPCIÓN', 'LIBERTAD', 'ANDALUZ'],
  gastos: ['MATERIALES', 'ACTIVOS MENORES', 'SERVICIOS', 'MANTENIMIENTO', 'ÚTILES DE OFICINA', 'LIMPIEZA', 'UNIFORMES', 'TRANSPORTE', 'PUBLICIDAD', 'ALQUILERES', 'OTROS'],
  formas: ['TRANSFERENCIA BCP', 'TRANSFERENCIA BBVA', 'TRANSFERENCIA INTERBANK', 'EFECTIVO', 'YAPE / PLIN', 'CHEQUE'],
  condiciones: ['CONTADO', '7 DIAS CREDITO', '15 DIAS CREDITO', '30 DIAS CREDITO', '45 DIAS CREDITO', '60 DIAS CREDITO'],
  unidades: ['UND', 'CAJA', 'PAQUETE', 'BOLSA', 'KG', 'LITRO', 'GALÓN', 'METRO', 'PAR', 'JUEGO', 'ROLLO', 'MILLAR'],
  codigosCC: CENTROS_COSTO,
  cargos: ['QUÍMICO FARMACÉUTICO', 'TÉCNICO EN FARMACIA', 'CAJERO(A)', 'ALMACENERO', 'ASISTENTE ADMINISTRATIVO', 'JEFE DE ADMINISTRACIÓN', 'CONTADOR(A)', 'GERENTE']
};
const PROMPT_IA = `Eres un asistente contable en Perú. Lee este comprobante de pago (factura, boleta, recibo por honorarios, nota de crédito, etc.) y devuelve SOLO un objeto JSON con esta forma exacta:
{"tipo":"FACTURA|BOLETA|RECIBO POR HONORARIOS|NOTA DE CREDITO|NOTA DE DEBITO|TICKET|OTRO","serie":"F001","numero":"20538","fechaEmision":"YYYY-MM-DD","fechaVencimiento":"YYYY-MM-DD o null","moneda":"PEN o USD","proveedorRuc":"RUC del emisor","proveedorRazon":"razón social del emisor","clienteRuc":"RUC del cliente o null","clienteRazon":"razón social del cliente o null","condicionPago":"CONTADO o 'N DIAS CREDITO' o null","items":[{"codigo":null,"descripcion":"","unidad":"UND","cantidad":1,"valorUnitario":0,"subtotal":0,"lote":null,"vencimiento":"YYYY-MM-DD o null"}],"subtotal":0,"igv":0,"total":0,"detraccion":false,"porcentajeDetraccion":0,"retencion":0,"porcentajeRetencion":0}
Reglas: valorUnitario y subtotal de cada ítem van SIN IGV; si el comprobante solo muestra precios con IGV, divídelos entre 1.18. Números sin separador de miles y con punto decimal. El emisor (proveedor) es quien emite el comprobante, no el cliente. En recibos por honorarios: total = total por honorarios, retencion = monto de la retención de renta (4ta categoría) y el ítem es el concepto. Si un dato no aparece, usa null. No inventes datos.`;

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
    $('yoNombre').textContent = YO.nombre; $('yoRol').textContent = YO.usuario + ' · ' + rolTxt(YO.rol);
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
  // Primera vez con los centros de costo oficiales: reemplazan a la lista antigua (solo tenía el 101)
  if ((LISTAS.codigosCC || []).length <= 1) {
    LISTAS.codigosCC = CENTROS_COSTO;
    if (YO?.rol === 'ADMIN') setDoc(doc(db, 'config', 'listas'), { codigosCC: CENTROS_COSTO }, { merge: true }).catch(e => console.warn('centros de costo', e));
  }
  IA = ia && ia.exists() ? ia.data() : null;
  $('dlUni').innerHTML = LISTAS.unidades.map(u => `<option value="${esc(u)}">`).join('');
  $('dlCargos').innerHTML = LISTAS.cargos.map(u => `<option value="${esc(u)}">`).join('');
  if (unsubProd) unsubProd();
  unsubProd = onSnapshot(collection(db, 'productos'), s => {
    PRODUCTOS.clear(); s.forEach(d => PRODUCTOS.set(d.id, { id: d.id, ...d.data() }));
    $('dlProd').innerHTML = [...PRODUCTOS.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(p => `<option value="${esc(etiquetaProd(p))}">`).join('');
    if (modActual === 'kardex') pintarKardex();
    if (modActual === 'inventario' && !$('invFilas').contains(document.activeElement)) pintarInventario();
    sincronizarCatalogo(); // nombres de materiales para la página pública de solicitudes
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

// Íconos (trazos simples) para el menú y las barras de acciones
const SVG = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICO = {
  editar: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'),
  imprimir: SVG('<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>'),
  excel: SVG('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  borrar: SVG('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/>'),
  ok: SVG('<path d="M20 6 9 17l-5-5"/>'),
  x: SVG('<path d="M18 6 6 18M6 6l12 12"/>'),
  deshacer: SVG('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15-6.7L3 13"/>'),
  clip: SVG('<path d="M21.4 11.1 12.2 20.3a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>'),
  camion: SVG('<path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>'),
  anular: SVG('<circle cx="12" cy="12" r="10"/><path d="m4.9 4.9 14.2 14.2"/>'),
  inicio: SVG('<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>'),
  solicitudes: SVG('<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1Z"/>'),
  servicios: SVG('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8"/>'),
  compras: SVG('<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.7 13.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L23 6H6"/>'),
  kardex: SVG('<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>'),
  rrhh: SVG('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>'),
  cargo: SVG('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>'),
  usuarios: SVG('<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>'),
  inventario: SVG('<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/><path d="m9 14 2 2 4-4"/>'),
  config: SVG('<circle cx="12" cy="12" r="3"/><path d="M12 1v3M12 20v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M1 12h3M20 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>')
};
ICO.salidas = ICO.camion;
const botonIco = (ico, txt, attrs, clase = '') => `<button type="button" class="ico ${clase}" ${attrs}>${ICO[ico] || ''}<span>${txt}</span></button>`;

/* ================= Menú ================= */
function armarMenu() {
  let grupo = '', h = '';
  MODULOS.filter(m => ACCESO[YO.rol].includes(m.id)).forEach(m => {
    if (m.grupo !== grupo) { grupo = m.grupo; h += `<div class="grupo">${esc(grupo)}</div>`; }
    h += `<button type="button" data-mod="${m.id}">${ICO[m.id] || ''}<span>${esc(m.nombre)}</span></button>`;
  });
  $('menu').innerHTML = h + `<div style="padding:16px 12px 8px;font-size:11px;color:#8b939d">Versión ${VERSION}</div>`;
}
$('menu').addEventListener('click', e => { const b = e.target.closest('[data-mod]'); if (b) irA(b.dataset.mod); });
function irA(id) {
  if (!ACCESO[YO.rol].includes(id)) id = 'inicio';
  modActual = id;
  document.querySelectorAll('.mod').forEach(s => s.hidden = s.id !== 'm-' + id);
  document.querySelectorAll('#menu [data-mod]').forEach(b => b.classList.toggle('act', b.dataset.mod === id));
  history.replaceState(null, '', '#' + id);
  ({ inicio: abrirInicio, solicitudes: abrirSolicitudes, servicios: () => abrirComps('SERVICIO'), compras: () => abrirComps('COMPRA'), salidas: abrirSalidas, kardex: abrirKardex, inventario: abrirInventario, rrhh: abrirRRHH, cargo: abrirCargo, usuarios: abrirUsuarios, config: abrirConfig })[id]();
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
        <div class="acc">${puede('comprobantes') ? '<button class="btn" type="button" data-a="nuevo">+ Nuevo ingreso</button>' : ''}${!serv && YO.rol === 'ADMIN' ? '<button class="btn sec" type="button" data-a="importar" title="Excel con una hoja por material (registro auxiliar de suministros)">Importar facturas desde Excel</button><button class="btn peligro" type="button" data-a="deshacer">Deshacer importación</button>' : ''}<button class="btn sec" type="button" data-a="csv">Exportar Excel</button></div></div>
      <div class="filtros">
        <label>Mes de emisión<input type="month" data-f="mes" value="${st.mes}"></label>
        <label>Empresa<select data-f="empresa"></select></label>
        <label${serv ? '' : ' hidden'}>Aprobación<select data-f="aprob"><option value="">Todas</option><option>PENDIENTE</option><option>APROBADO</option><option>RECHAZADO</option><option>ANULADO</option></select></label>
        <label class="crece">Buscar<input type="search" data-f="q" placeholder="Proveedor, RUC, serie, número o concepto"></label>
      </div>
      <div class="resumen" data-r="res"></div>
      <div class="md"><div class="md-lista" data-r="filas"><div class="vacio">Cargando…</div></div><div class="md-det" data-r="det"><div class="vacio">Elige un comprobante de la lista para verlo.</div></div></div>`;
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
  } catch (e) { sec.querySelector('[data-r="filas"]').innerHTML = `<div class="aviso error">${esc(errorTexto(e))}</div>`; }
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
  sec.querySelector('[data-r="res"]').innerHTML = `<span><b>${l.length}</b> comprobantes</span><span>Total: <b>S/ ${n2(pen)}</b>${usd ? ` · <b>US$ ${n2(usd)}</b>` : ''}</span>${serv ? `<span>Pendientes de aprobación: <b>${vig.filter(c => c.aprobacion?.estado === 'PENDIENTE').length}</b></span>` : ''}`;
  const st = EST[clase];
  if (st.sel && !l.some(c => c.id === st.sel)) st.sel = null;
  sec.querySelector('[data-r="filas"]').innerHTML = l.length ? `<table class="lst"><thead><tr><th>Documento</th><th>Emisión</th><th>Proveedor</th><th class="opc">${serv ? 'Tipo de gasto' : 'Ítems'}</th><th class="num">Total</th><th>${serv ? 'Aprobación' : 'Estado'}</th></tr></thead><tbody>${l.map(c => {
    const anul = c.estado === 'ANULADO';
    const est = anul ? '<span class="pill ANULADO">ANULADO</span>' : serv ? pill(c) : '<span class="pill APROBADO">REGISTRADO</span>';
    return `<tr class="${anul ? 'anulado' : ''}" data-a="sel" data-id="${esc(c.id)}"><td><a href="#" data-a="sel" data-id="${esc(c.id)}">${esc(c.serie)}-${esc(c.numero)}</a><span class="sub">${esc(c.tipo)}</span></td><td>${fmtF(c.fechaEmision)}</td>
      <td>${esc(c.razon || 'SIN PROVEEDOR')}<span class="sub">RUC ${esc(c.ruc || '—')}</span></td>
      <td class="opc">${serv ? `${esc(c.gasto || '')}<span class="sub">${esc(c.centro || '')}</span>` : `${(c.lineas || []).length} ítem(s)<span class="sub">${esc((c.lineas || []).slice(0, 2).map(x => x.desc).join(', '))}${(c.lineas || []).length > 2 ? '…' : ''}</span>`}</td>
      <td class="num"><b>${mon(c.moneda)} ${n2(c.total)}</b></td><td>${est}</td></tr>`;
  }).join('')}</tbody></table><div class="lst-pie">Total — ${l.length}</div>` : `<div class="vacio">No hay comprobantes con este filtro.${puede('comprobantes') ? ' Usa “+ Nuevo ingreso” para registrar el primero.' : ''}</div>`;
  pintarDetComp(clase);
}
// Documento del comprobante elegido, con su barra de acciones
function pintarDetComp(clase) {
  const st = EST[clase], sec = secComp(clase), c = st.lista.find(x => x.id === st.sel), serv = clase === 'SERVICIO';
  const det = sec.querySelector('[data-r="det"]');
  sec.querySelector('.md').classList.toggle('ver-doc', !!c);
  if (!c) { det.innerHTML = ''; return; }
  const anul = c.estado === 'ANULADO', pendiente = c.aprobacion?.estado === 'PENDIENTE', id = esc(c.id), m = mon(c.moneda);
  const acc = [];
  if (!anul && puede('comprobantes') && (serv ? pendiente : true)) acc.push(botonIco('editar', 'Editar', `data-a="editar" data-id="${id}"`));
  if (serv && !anul && pendiente && puede('aprobar')) acc.push(botonIco('ok', 'Aprobar', `data-a="aprobar" data-id="${id}"`, 'prim'), botonIco('x', 'Rechazar', `data-a="rechazar" data-id="${id}"`, 'peligro'));
  acc.push(botonIco('imprimir', 'Imprimir', `data-a="imprimir" data-id="${id}"`), botonIco('excel', 'Excel', `data-a="xls" data-id="${id}"`));
  if (c.adjuntoId) acc.push(botonIco('clip', 'Adjunto', `data-a="adjunto" data-id="${id}"`));
  if (serv && !anul && puede('comprobantes')) acc.push(botonIco('anular', 'Anular', `data-a="anular" data-id="${id}"`, 'peligro'));
  if (YO.rol === 'ADMIN') acc.push(botonIco('borrar', 'Borrar', `data-a="borrar" data-id="${id}"`, 'peligro'));
  const estado = anul ? '<span class="estado no">ANULADO</span>' : serv ? `<span class="estado ${pendiente ? 'am' : c.aprobacion?.estado === 'APROBADO' ? 'ok' : 'no'}">${esc(c.aprobacion?.estado || 'PENDIENTE')}</span>` : '<span class="estado ok">REGISTRADO · EN KARDEX</span>';
  const datos = [['Proveedor', `${esc(c.razon || '—')}<br><small class="nota">RUC ${esc(c.ruc || '—')}</small>`], ['Fecha de emisión', fmtF(c.fechaEmision)], ['Vencimiento', fmtF(c.fechaVence) || '—'],
    ['Condición de pago', esc(c.condicion || '—')], ['Forma de pago', esc(c.forma || '—')], ['Empresa', esc(c.empresa || '—')], ['Tipo de gasto', esc(c.gasto || '—')],
    ...(serv ? [['Centro de costos', esc(c.centro || '—')], ['Destino', esc(c.destino || '—')], ['¿Contable?', esc(c.contable || '—')]] : []),
    ['Registró', `${esc(c.creadoPor?.nombre || '—')}<br><small class="nota">${c.creadoMs ? new Date(c.creadoMs).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : ''}</small>`]];
  det.innerHTML = `<div class="tb">${botonIco('', '← Volver a la lista', 'data-a="volver"')}<span class="tit">${esc(c.tipo)} ${esc(c.serie)}-${esc(c.numero)}</span>${acc.join('')}</div>
    <div class="doc">
      <div class="doc-cab"><div><h3>${serv ? 'COMPROBANTE DE SERVICIO' : 'FACTURA DE COMPRA'}</h3><div class="sub">${esc(c.tipo)} N.º <b>${esc(c.serie)}-${esc(c.numero)}</b></div>${estado}</div>
        <div style="text-align:right"><div class="nota">Total</div><div style="font-size:24px;font-weight:bold">${m} ${n2(c.total)}</div>${c.totalPagar !== undefined && c.totalPagar !== c.total ? `<div class="nota">A pagar ${m} ${n2(c.totalPagar)}</div>` : ''}</div></div>
      <div class="doc-datos">${datos.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('')}</div>
      ${c.aprobacion?.motivo ? `<div class="aviso">Motivo: ${esc(c.aprobacion.motivo)}</div>` : ''}${c.notas ? `<div class="nota">Anotaciones: ${esc(c.notas)}</div>` : ''}
      <div class="tabla"><table><thead><tr><th>#</th><th>${serv ? 'Concepto' : 'Producto'}</th><th class="num">Cantidad</th><th class="num">P. unit sin IGV</th><th class="num">Subtotal</th><th class="num">IGV</th><th class="num">Total</th></tr></thead>
      <tbody>${(c.lineas || []).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.desc)}${x.codigo ? `<br><small class="nota">${esc(x.codigo)}</small>` : ''}</td><td class="num">${nq(x.cant)} ${esc(x.unidad || '')}</td><td class="num">${n2(x.vu)}</td><td class="num">${n2(x.sub)}</td><td class="num">${n2(x.igv)}</td><td class="num">${n2(x.tot)}</td></tr>`).join('') || '<tr><td colspan="7" class="vacio">Sin ítems.</td></tr>'}</tbody></table></div>
      <div class="tots"><span>Subtotal</span><b>${m} ${n2(c.subtotal)}</b><span>IGV</span><b>${m} ${n2(c.igv)}</b>${c.detMonto ? `<span>Detracción</span><b>${m} ${n2(c.detMonto)}</b>` : ''}${c.retMonto ? `<span>Retención IR</span><b>${m} ${n2(c.retMonto)}</b>` : ''}<span class="g">Total</span><b class="g">${m} ${n2(c.total)}</b></div>
    </div>`;
}
async function accionComp(clase, e) {
  const b = e.target.closest('[data-a]'); if (!b) return;
  const a = b.dataset.a, c = EST[clase].lista.find(x => x.id === b.dataset.id);
  if (a === 'nuevo') return abrirEditor(clase, null, 'nuevo');
  if (a === 'csv') return exportarComps(clase);
  if (a === 'importar') { BTN_IMP = b; return $('kImpFile').click(); }
  if (a === 'deshacer') return deshacerImportacion(b);
  if (a === 'volver') { EST[clase].sel = null; pintarDetComp(clase); return; }
  if (!c) return;
  if (a === 'sel') { e.preventDefault(); EST[clase].sel = c.id; pintarDetComp(clase); window.scrollTo(0, 0); return; }
  if (a === 'imprimir') return imprimirComp(c);
  if (a === 'xls') return excelComp(c, b);
  if (a === 'adjunto') { try { const d = await getDoc(doc(db, 'adjuntos', c.adjuntoId)); if (d.exists()) verAdjunto(d.data()); else toast('No se encontró el adjunto.', true); } catch (err) { toast(errorTexto(err), true); } return; }
  if (a === 'borrar') return borrarComp(clase, c, b);
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
function imprimirComp(c) {
  const serv = c.clase === 'SERVICIO', m = mon(c.moneda);
  const w = window.open('', '_blank'); if (!w) return toast('El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.', true);
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(c.tipo)} ${esc(c.serie)}-${esc(c.numero)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:28px;font-size:13px}.cab{display:flex;justify-content:space-between;align-items:flex-start}.cab img{width:60px}
    h1{font-size:20px;margin:0}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 20px;margin:18px 0}.g div{font-size:11px;color:#666;text-transform:uppercase}.g b{display:block;color:#222;font-size:13px;text-transform:none}
    table{width:100%;border-collapse:collapse}th,td{border-bottom:1px solid #ddd;padding:6px 8px;text-align:left}th{background:#f2f2f2;font-size:11px;text-transform:uppercase}.n{text-align:right}
    .t{margin-left:auto;width:280px;margin-top:12px;display:grid;grid-template-columns:1fr auto;gap:4px 20px}.t .x{font-weight:bold;font-size:15px;border-top:1px solid #222;padding-top:4px}
  </style></head><body>
    <div class="cab"><div><h1>${serv ? 'COMPROBANTE DE SERVICIO' : 'FACTURA DE COMPRA'}</h1><div>${esc(c.tipo)} N.º <b>${esc(c.serie)}-${esc(c.numero)}</b>${c.estado === 'ANULADO' ? ' · <b style="color:#b3261e">ANULADO</b>' : ''}</div></div><img src="${esc(new URL('logo.png', location.href).href)}" alt=""></div>
    <div class="g"><div>Proveedor<b>${esc(c.razon)} · RUC ${esc(c.ruc || '—')}</b></div><div>Emisión<b>${fmtF(c.fechaEmision)}</b></div><div>Vencimiento<b>${fmtF(c.fechaVence) || '—'}</b></div>
      <div>Empresa<b>${esc(c.empresa || '—')}</b></div><div>Condición / forma de pago<b>${esc(c.condicion || '—')} · ${esc(c.forma || '—')}</b></div><div>Tipo de gasto<b>${esc(c.gasto || '—')}${serv && c.centro ? ' · ' + esc(c.centro) : ''}</b></div></div>
    <table><thead><tr><th>#</th><th>${serv ? 'Concepto' : 'Producto'}</th><th class="n">Cantidad</th><th class="n">P. unit</th><th class="n">Subtotal</th><th class="n">IGV</th><th class="n">Total</th></tr></thead><tbody>
    ${(c.lineas || []).map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.desc)}</td><td class="n">${nq(x.cant)} ${esc(x.unidad || '')}</td><td class="n">${n2(x.vu)}</td><td class="n">${n2(x.sub)}</td><td class="n">${n2(x.igv)}</td><td class="n">${n2(x.tot)}</td></tr>`).join('')}</tbody></table>
    <div class="t"><span>Subtotal</span><b>${m} ${n2(c.subtotal)}</b><span>IGV</span><b>${m} ${n2(c.igv)}</b>${c.detMonto ? `<span>Detracción</span><b>${m} ${n2(c.detMonto)}</b>` : ''}${c.retMonto ? `<span>Retención</span><b>${m} ${n2(c.retMonto)}</b>` : ''}<span class="x">Total</span><b class="x">${m} ${n2(c.total)}</b></div>
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
async function excelComp(c, b) {
  ocupado(b, true, '…');
  try {
    const X = await libroXlsx();
    const filas = [[`${c.tipo} ${c.serie}-${c.numero}`], [], ['Proveedor', c.razon], ['RUC', c.ruc], ['Fecha de emisión', fmtF(c.fechaEmision)], ['Vencimiento', fmtF(c.fechaVence)], ['Empresa', c.empresa], ['Condición', c.condicion], ['Forma de pago', c.forma], ['Tipo de gasto', c.gasto], ['Moneda', c.moneda], ['Estado', c.estado === 'ANULADO' ? 'ANULADO' : c.aprobacion?.estado || 'REGISTRADO'], [],
      ['#', 'Producto / concepto', 'Código', 'Cantidad', 'Unidad', 'P. unit sin IGV', 'Subtotal', 'IGV', 'Total']];
    (c.lineas || []).forEach((x, i) => filas.push([i + 1, x.desc, x.codigo || '', x.cant, x.unidad || '', x.vu, x.sub, x.igv, x.tot]));
    filas.push([], ['', '', '', '', '', '', 'Subtotal', '', c.subtotal], ['', '', '', '', '', '', 'IGV', '', c.igv], ['', '', '', '', '', '', 'TOTAL', '', c.total]);
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, hojaXlsx(X, filas, [18, 40, 10, 10, 10, 14, 12, 10, 12]), 'Comprobante');
    X.writeFile(wb, `${c.tipo.toLowerCase().replace(/\s+/g, '_')}_${c.serie}-${c.numero}.xlsx`);
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
}
// Borrar un ingreso (solo ADMIN): en materiales también saca del kardex lo que ingresó y recalcula el stock
async function borrarComp(clase, c, b) {
  const compra = clase === 'COMPRA';
  const pids = [...new Set((c.lineas || []).map(l => l.prodId).filter(Boolean))];
  const negativos = compra && c.estado !== 'ANULADO' ? (c.lineas || []).filter(l => l.prodId && PRODUCTOS.get(l.prodId) && PRODUCTOS.get(l.prodId).stock + 1e-9 < l.cant).map(l => `• ${PRODUCTOS.get(l.prodId).nombre}: hay ${nq(PRODUCTOS.get(l.prodId).stock)} y la factura ingresó ${nq(l.cant)}`) : [];
  if (!confirm(`¿Borrar ${c.tipo} ${c.serie}-${c.numero} de ${c.razon}?` + (compra ? '\n\nTambién se borrarán sus entradas del kardex y el stock se recalculará.' : '') +
    (negativos.length ? `\n\n⚠ Parte de lo que ingresó ya se entregó; el stock quedará negativo en:\n${negativos.join('\n')}` : '') + '\n\nNo se puede deshacer.')) return;
  ocupado(b, true, 'Borrando…');
  try {
    if (compra) {
      const ms = await getDocs(query(collection(db, 'movimientos'), where('comprobanteId', '==', c.id)));
      ms.docs.forEach(d => pids.push(d.data().productoId));
      let lote = writeBatch(db), n = 0;
      for (const d of ms.docs) { lote.delete(d.ref); if (++n % 450 === 0) { await lote.commit(); lote = writeBatch(db); } }
      if (n % 450) await lote.commit();
    }
    await deleteDoc(doc(db, 'comprobantes', c.id));
    if (c.adjuntoId) deleteDoc(doc(db, 'adjuntos', c.adjuntoId)).catch(() => { });
    if (compra) for (const pid of new Set(pids)) if (pid && PRODUCTOS.has(pid)) await recalcularProducto(pid);
    toast(`${c.tipo} ${c.serie}-${c.numero} borrada.`);
    EST[clase].sel = null; cargarComps(clase);
  } catch (err) { toast(errorTexto(err), true); ocupado(b, false); }
}
function exportarComps(clase) {
  const l = filtrarComps(clase), filas = [['Fecha emisión', 'Tipo', 'Serie', 'Número', 'RUC', 'Proveedor', 'Empresa', 'Condición', 'Vencimiento', 'Forma de pago', 'Tipo de gasto', 'Centro de costos', 'Destino', 'Moneda', 'Ítem', 'Producto / concepto', 'Código', 'Unidad', 'Cantidad', 'P. unit sin IGV', 'Subtotal', 'IGV', 'Total ítem', 'Total comprobante', 'Detracción', 'Retención IR', 'Total a pagar', 'Aprobación', 'Estado', 'Registró', 'N.º solicitud', 'Anotaciones']];
  l.forEach(c => (c.lineas || []).forEach((x, i) => filas.push([fmtF(c.fechaEmision), c.tipo, c.serie, c.numero, c.ruc, c.razon, c.empresa, c.condicion, fmtF(c.fechaVence), c.forma, c.gasto, c.centro, c.destino, c.moneda, i + 1, x.desc, x.codigo || '', x.unidad || '', String(x.cant).replace('.', ','), numCSV(x.vu), numCSV(x.sub), numCSV(x.igv), numCSV(x.tot), i === 0 ? numCSV(c.total) : '', i === 0 ? numCSV(c.detMonto) : '', i === 0 ? numCSV(c.retMonto) : '', i === 0 ? numCSV(c.totalPagar) : '', c.aprobacion?.estado || '', c.estado, c.creadoPor?.nombre || '', c.solicitud || '', c.notas || ''])));
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

/* Buscador de productos: al escribir aparecen los que coinciden (código o nombre, cualquier palabra), con su stock.
   Sirve para cualquier campo con data-bp; reemplaza a la lista desplegable del navegador. */
const BP = { el: null, inp: null, ops: [], act: -1 };
BP.el = document.createElement('div'); BP.el.className = 'bp'; BP.el.hidden = true; BP.el.setAttribute('role', 'listbox');
function cerrarBP() { BP.el.hidden = true; BP.inp = null; BP.ops = []; BP.act = -1; }
function marcarBP(txt, palabras) {
  const nn = norm(txt); if (nn.length !== txt.length) return esc(txt);
  const on = Array(txt.length).fill(false);
  palabras.forEach(w => { let i = nn.indexOf(w); while (i >= 0) { for (let k = i; k < i + w.length; k++) on[k] = true; i = nn.indexOf(w, i + w.length); } });
  let h = '', ab = false;
  for (let k = 0; k < txt.length; k++) { if (on[k] !== ab) { h += ab ? '</b>' : '<b>'; ab = on[k]; } h += esc(txt[k]); }
  return h + (ab ? '</b>' : '');
}
function abrirBP(inp) {
  if (BP.silencio) return;
  const t = norm(inp.value.replace(/·/g, ' ')), palabras = t.split(' ').filter(Boolean);
  const todos = [...PRODUCTOS.values()];
  if (palabras.length && buscarProd(inp.value)) return cerrarBP(); // ya está elegido
  const ops = (palabras.length ? todos.filter(p => { const n = norm(p.codigo + ' ' + p.nombre); return palabras.every(w => n.includes(w)); }) : todos)
    .sort((a, b) => (norm(b.nombre).startsWith(t) - norm(a.nombre).startsWith(t)) || a.nombre.localeCompare(b.nombre, 'es')).slice(0, 12);
  Object.assign(BP, { inp, ops, act: ops.length ? 0 : -1 });
  BP.el.innerHTML = ops.length ? ops.map((p, i) => `<div role="option" data-i="${i}" class="${i === BP.act ? 'act' : ''}"><span class="cod">${marcarBP(p.codigo, palabras)}</span><span class="nom">${marcarBP(p.nombre, palabras)}</span><span class="stk${p.stock > 0 ? '' : ' cero'}">${nq(p.stock)} ${esc(p.unidad || '')}</span></div>`).join('')
    : `<div class="vacia">${inp.dataset.bp === 'libre' ? 'No está en el kardex: se creará como producto nuevo' : 'Ningún material coincide'}</div>`;
  (inp.closest('dialog') || document.body).appendChild(BP.el); // dentro del diálogo para que se vea encima
  const r = inp.getBoundingClientRect(), abajo = window.innerHeight - r.bottom;
  Object.assign(BP.el.style, { left: r.left + 'px', width: Math.max(r.width, 360) + 'px', top: abajo > 260 || abajo > r.top ? (r.bottom + 3) + 'px' : 'auto', bottom: abajo > 260 || abajo > r.top ? 'auto' : (window.innerHeight - r.top + 3) + 'px' });
  BP.el.hidden = false;
}
function elegirBP(i) {
  const p = BP.ops[i], inp = BP.inp; if (!p || !inp) return;
  inp.value = etiquetaProd(p); cerrarBP();
  BP.silencio = true; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); BP.silencio = false;
}
document.addEventListener('input', e => { if (e.target.matches?.('input[data-bp]')) abrirBP(e.target); });
document.addEventListener('focusin', e => { if (e.target.matches?.('input[data-bp]')) { if (!e.target.value) abrirBP(e.target); } else if (BP.inp && !BP.el.contains(e.target)) cerrarBP(); });
document.addEventListener('focusout', e => { if (e.target === BP.inp) setTimeout(() => { if (BP.inp === e.target && document.activeElement !== e.target) cerrarBP(); }, 150); });
document.addEventListener('keydown', e => {
  if (BP.el.hidden || e.target !== BP.inp) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return cerrarBP(); }
  if (!BP.ops.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); e.stopPropagation();
    BP.act = (BP.act + (e.key === 'ArrowDown' ? 1 : -1) + BP.ops.length) % BP.ops.length;
    [...BP.el.children].forEach((d, i) => d.classList.toggle('act', i === BP.act)); BP.el.children[BP.act]?.scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter' && BP.act >= 0) { e.preventDefault(); e.stopPropagation(); elegirBP(BP.act); }
}, true);
BP.el.addEventListener('mousedown', e => { e.preventDefault(); const d = e.target.closest('[data-i]'); if (d) elegirBP(+d.dataset.i); });
window.addEventListener('resize', cerrarBP);
document.addEventListener('scroll', e => { if (BP.inp && !BP.el.contains(e.target)) cerrarBP(); }, true);
const CAMPOS_BLOQ_EDIT = ['cTipo', 'cSerie', 'cNum', 'cRuc'];
const CAMPOS = ['cTipo', 'cSerie', 'cNum', 'cFecha', 'cRuc', 'cRazon', 'cCond', 'cVence', 'cForma', 'cMoneda', 'cGasto', 'cCentro', 'cIgv', 'cCont', 'cDet', 'cDetPct', 'cRet', 'cRetPct', 'cEmpresa', 'cDestino', 'cSol', 'cNotas'];

async function abrirEditor(clase, c, modo) {
  ED = { clase, modo, id: c?.id || null, archivo: null, adjuntoId: c?.adjuntoId || null, lineas: c ? structuredClone(c.lineas || []) : [lineaVacia()], iaTotal: null };
  const compra = clase === 'COMPRA', ro = modo === 'ver';
  $('cTit').textContent = (modo === 'nuevo' ? 'Nuevo ingreso de ' : modo === 'editar' ? 'Editar ingreso de ' : '') + (compra ? 'materiales' : 'servicio') + (c ? ` · ${c.tipo} ${c.serie}-${c.numero}` : '');
  opciones($('cTipo'), TIPOS_DOC, c?.tipo || 'FACTURA');
  opciones($('cCond'), LISTAS.condiciones, c?.condicion || 'CONTADO');
  opciones($('cForma'), LISTAS.formas, c?.forma || LISTAS.formas[0]);
  opciones($('cGasto'), LISTAS.gastos, c?.gasto || (compra ? 'MATERIALES' : ''), '— Elegir —');
  opciones($('cCentro'), LISTAS.areas, c?.centro || '', '— Elegir —');
  opciones($('cDestino'), LISTAS.areas, c?.destino || 'ADMINISTRACIÓN', '— Elegir —');
  opciones($('cEmpresa'), LISTAS.empresas.map(e => e.nombre), c?.empresa || LISTAS.empresas[0]?.nombre);
  $('cSerie').value = c?.serie || ''; $('cNum').value = c?.numero || ''; $('cFecha').value = c?.fechaEmision || hoyISO();
  $('cRuc').value = c?.ruc || ''; $('cRazon').value = c?.razon || ''; $('cVence').value = c?.fechaVence || '';
  $('cMoneda').value = c?.moneda || 'PEN'; $('cIgv').value = c?.afectoIgv || 'SI'; $('cCont').value = c?.contable || 'SI';
  $('cDet').value = c?.detraccion || 'NO'; $('cDetPct').value = c?.detPct ?? 0;
  $('cRet').value = c?.retencion || 'NO'; $('cRetPct').value = c?.retPct ?? 8; $('cSol').value = c?.solicitud || ''; $('cNotas').value = c?.notas || '';
  if (!c) calcVence();
  CAMPOS.forEach(id => $(id).disabled = ro || (modo === 'editar' && CAMPOS_BLOQ_EDIT.includes(id) && !c?.importado));
  ['cLeer', 'cGuardar', 'cAddLin', 'cCambiar'].forEach(id => $(id).hidden = ro);
  $('cIA').hidden = ro || !IA?.clave;
  if (compra && modo === 'editar') ['cLeer', 'cIA'].forEach(id => $(id).hidden = true); // los ítems ya están en el kardex: solo se corrige la cabecera
  // En Ingreso de materiales no se adjunta foto ni se lee el comprobante: se escribe directo
  $('dComp').querySelector('.comp-img').hidden = compra; $('dComp').querySelector('.comp').classList.toggle('sin-img', compra);
  if (compra) ['cLeer', 'cIA'].forEach(id => $(id).hidden = true);
  // Campos que no se usan en Ingreso de materiales
  ['cCentro', 'cCont', 'cDestino', 'cSol', 'cNotas'].forEach(id => { $(id).closest('label').hidden = compra; });
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
document.addEventListener('paste', e => { if (!$('dComp').open || ED?.clase === 'COMPRA') return; const f = [...(e.clipboardData?.files || [])][0]; if (f) { e.preventDefault(); tomarArchivo(f); } });
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
['cIgv', 'cDet', 'cDetPct', 'cRet', 'cRetPct'].forEach(id => $(id).addEventListener('input', () => pintarLineas()));
$('cTipo').addEventListener('change', () => {
  if ($('cTipo').value === 'RECIBO POR HONORARIOS') { $('cIgv').value = 'NO'; if (!num($('cRetPct').value)) $('cRetPct').value = 8; pintarLineas(); if (totales().total > 1500) { $('cRet').value = 'SI'; pintarLineas(); } }
});
$('cRuc').addEventListener('change', () => { const p = PROVEEDORES.get(limpio($('cRuc').value)); if (p && !limpio($('cRazon').value)) $('cRazon').value = p.razon; });

function calcLinea(l) { const sub = r2(num(l.cant) * num(l.vu)); const igv = $('cIgv').value === 'SI' ? r2(sub * IGV) : 0; return { sub, igv, tot: r2(sub + igv) }; }
function totales() {
  let s = 0, g = 0;
  ED.lineas.forEach(l => { const c = calcLinea(l); s += c.sub; g += c.igv; });
  s = r2(s); g = r2(g); const t = r2(s + g);
  const det = $('cDet').value === 'SI' ? Math.round(t * num($('cDetPct').value) / 100) : 0;
  const ret = $('cRet').value === 'SI' ? r2(t * num($('cRetPct').value) / 100) : 0;
  const r = { subtotal: s, igv: g, total: t, detMonto: det, retMonto: ret, totalPagar: r2(t - det - ret) };
  $('tSub').textContent = n2(s); $('tIgv').textContent = n2(g); $('tTot').textContent = n2(t); $('tDet').textContent = n2(det); $('tRet').textContent = n2(ret); $('tPagar').textContent = n2(r.totalPagar);
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
  $('cLinHead').innerHTML = `<tr><th>#</th><th>${compra ? 'Producto' : 'Concepto'}</th>${compra ? '<th>Unidad</th>' : ''}<th>Cant.</th><th>P. unit sin IGV</th><th class="num">Subtotal</th><th class="num">IGV</th><th class="num">Total</th><th></th></tr>`;
  $('cLineas').innerHTML = ED.lineas.map((l, i) => {
    const c = calcLinea(l);
    return `<tr data-i="${i}"><td class="c">${i + 1}</td>
      <td class="ancho"><input data-f="desc" value="${esc(l.desc)}"${compra ? ' data-bp="libre" autocomplete="off"' : ''}${dis} aria-label="${compra ? 'Producto' : 'Concepto'}"><span data-c="marca">${marcaProd(l)}</span></td>
      ${compra ? `<td><input class="w6" data-f="unidad" list="dlUni" value="${esc(l.unidad || 'UND')}"${dis} aria-label="Unidad"></td>` : ''}
      <td><input class="w6 num" type="number" step="any" min="0" data-f="cant" value="${l.cant}"${dis} aria-label="Cantidad"></td>
      <td><input class="w8 num" type="number" step="any" min="0" data-f="vu" value="${l.vu}"${dis} aria-label="Precio unitario sin IGV"></td>
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
    const modelo = !limpio(IA.modelo) || MODELOS_RETIRADOS.includes(limpio(IA.modelo)) ? MODELO_IA : limpio(IA.modelo);
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
  const ret = num(d.retencion);
  if (tipo === 'RECIBO POR HONORARIOS') $('cIgv').value = 'NO';
  if (ret > 0 && total > 0) { $('cRet').value = 'SI'; $('cRetPct').value = num(d.porcentajeRetencion) || Math.round(ret / total * 1000) / 10; }
  else if (tipo === 'RECIBO POR HONORARIOS' && total > 1500) { $('cRet').value = 'SI'; $('cRetPct').value = 8; }
  else $('cRet').value = 'NO';
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
  msgComp((d._fuente || 'Datos leídos con IA.') + ' <b>Revísalos con la imagen antes de guardar</b>; completa tipo de gasto, centro de costos y destino.', 'ok');
  pintarLineas();
}

/* ---------- Lectura gratuita: texto del PDF (pdf.js) u OCR de la foto (Tesseract) ---------- */
const scripts = {};
function cargarScript(src) {
  if (!scripts[src]) scripts[src] = new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => { delete scripts[src]; no(new Error('No se pudo cargar el lector. Revisa tu internet.')); }; document.head.appendChild(s); });
  return scripts[src];
}
async function pdfjs() {
  await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  return window.pdfjsLib;
}
const bytesDe = a => { const b = atob(a.d), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
async function textoPDF(a) {
  const lib = await pdfjs(), pdf = await lib.getDocument({ data: bytesDe(a) }).promise;
  let lineas = [];
  for (let n = 1; n <= Math.min(pdf.numPages, 2); n++) {
    const pg = await pdf.getPage(n), tc = await pg.getTextContent(), filas = [];
    tc.items.forEach(it => { if (!it.str.trim()) return; const y = Math.round(it.transform[5]); let f = filas.find(r => Math.abs(r.y - y) <= 3); if (!f) filas.push(f = { y, partes: [] }); f.partes.push({ x: it.transform[4], t: it.str }); });
    filas.sort((p, q) => q.y - p.y).forEach(f => lineas.push(f.partes.sort((p, q) => p.x - q.x).map(x => x.t).join(' ').replace(/\s+/g, ' ').trim()));
  }
  return lineas.join('\n');
}
async function imagenDePDF(a) {
  const lib = await pdfjs(), pdf = await lib.getDocument({ data: bytesDe(a) }).promise, pg = await pdf.getPage(1);
  const vp = pg.getViewport({ scale: 2.2 }), cv = document.createElement('canvas'); cv.width = vp.width; cv.height = vp.height;
  await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp }).promise;
  return cv;
}
async function ocr(fuente, avance) {
  await cargarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
  const w = await window.Tesseract.createWorker('spa', 1, { logger: m => { if (m.status === 'recognizing text') avance(Math.round(m.progress * 100)); } });
  try { const { data } = await w.recognize(fuente); return data.text; } finally { await w.terminate(); }
}
const MESES_N = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
const iso = (d, m, y) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
function montoTras(txt, etiqueta) {
  const m = new RegExp(etiqueta + '[^\\d\\n]{0,40}?(\\d{1,3}(?:[,\\s]\\d{3})*(?:\\.\\d{1,2})|\\d+(?:\\.\\d{1,2})?)', 'i').exec(txt);
  return m ? num(m[1].replace(/\s/g, '')) : 0;
}
function parsearComprobante(txt) {
  const t = txt.replace(/[|]/g, ' ').replace(/[ \t]+/g, ' '), n = norm(t), lineas = t.split('\n').map(limpio).filter(Boolean);
  const d = { items: [], _fuente: '' };
  d.tipo = /honorario/.test(n) ? 'RECIBO POR HONORARIOS' : /nota de credito/.test(n) ? 'NOTA DE CREDITO' : /boleta/.test(n) ? 'BOLETA' : /factura/.test(n) ? 'FACTURA' : 'OTRO';
  const sn = /\b([EFB][A-Z0-9]{2,3})\s*[-–N°º.:]*\s*[-–]\s*0*(\d{1,8})\b/.exec(t) || /\bnro\.?\s*:?\s*([A-Z]\d{3})\s*[-–]\s*0*(\d{1,8})/i.exec(t);
  if (sn) { d.serie = sn[1].toUpperCase(); d.numero = sn[2]; }
  const rucs = [...t.matchAll(/\b(1[05]\d{9}|2\d{10})\b/g)].map(m => m[1]);
  const rucCli = /identificad[oa]\s+con\s+(?:el\s+)?R\.?U\.?C\.?[^\d]{0,15}(\d{11})/i.exec(t)?.[1] || /(?:se[ñn]or(?:es)?|cliente|adquiriente)[^\n]{0,80}?(\d{11})/i.exec(t)?.[1];
  d.clienteRuc = rucCli || (rucs.find(r => LISTAS.empresas.some(e => e.ruc === r)) || null);
  d.proveedorRuc = rucs.find(r => r !== d.clienteRuc && !LISTAS.empresas.some(e => e.ruc === r)) || null;
  const recibi = /recib[ií]\s+de\s*:?\s*([^\n]+)/i.exec(t); if (recibi) d.clienteRazon = limpio(recibi[1]);
  // Nombre del emisor: proveedor ya conocido, o la línea en mayúsculas más cercana a su RUC
  if (d.proveedorRuc && PROVEEDORES.get(d.proveedorRuc)) d.proveedorRazon = PROVEEDORES.get(d.proveedorRuc).razon;
  else if (d.proveedorRuc) {
    const i = lineas.findIndex(l => l.includes(d.proveedorRuc));
    const malo = /RECIBO|HONORARIO|ELECTR|R\.?U\.?C|NRO|N°|DIRECC|AV\.|JR\.|CALLE|TELF|TEL[EÉ]F|FECHA|FACTURA|BOLETA|PER[UÚ]|HUANCAYO|LIMA|JUN[IÍ]N|DISTRITO|PROVINCIA/i;
    const ok = l => l && l.length >= 6 && !/\d{3}/.test(l) && !malo.test(l) && l.replace(/[^A-ZÁÉÍÓÚÑ ]/g, '').length >= l.length * 0.7;
    const cand = [lineas[i - 1], lineas[i + 1], lineas[i - 2], lineas[i + 2], lineas[i - 3]].find(ok) || (ok(lineas[0]) ? lineas[0] : '');
    const enLinea = i >= 0 ? limpio(lineas[i].replace(/R\.?U\.?C\.?\s*:?\s*\d{11}/i, '')) : '';
    d.proveedorRazon = cand || (ok(enLinea) ? enLinea : '');
  }
  const f1 = /fecha\s+de\s+emisi[oó]n\s*:?\s*(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/i.exec(t) || /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/.exec(t);
  const f2 = /(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+del?\s+(\d{4})/i.exec(t);
  if (f1) d.fechaEmision = iso(f1[1], f1[2], f1[3]); else if (f2) d.fechaEmision = iso(f2[1], MESES_N[norm(f2[2])], f2[3]);
  d.moneda = /d[oó]lar|US\$/i.test(t) ? 'USD' : 'PEN';
  if (d.tipo === 'RECIBO POR HONORARIOS') {
    d.total = montoTras(t, 'total\\s+por\\s+honorarios') || montoTras(t, 'honorarios');
    d.retencion = montoTras(t, 'retenci[oó]n\\s*\\(?\\s*\\d+(?:[.,]\\d+)?\\s*%\\s*\\)?\\s*(?:IR|renta)?') || 0;
    const pct = /retenci[oó]n\s*\(?\s*(\d+(?:[.,]\d+)?)\s*%/i.exec(t); if (pct) d.porcentajeRetencion = num(pct[1]);
    const neto = montoTras(t, 'total\\s+neto(?:\\s+recibido)?');
    if (!d.total && neto) d.total = r2(neto + (d.retencion || 0));
    d.igv = 0;
    const conc = /por\s+concepto\s+de\s*:?\s*([\s\S]+?)(?:\n\s*(?:observaci|inciso|total|fecha|forma de pago|la suma)|$)/i.exec(t);
    d.items = [{ descripcion: conc ? limpio(conc[1]).slice(0, 200) : 'SERVICIOS PROFESIONALES', cantidad: 1, valorUnitario: d.total, subtotal: d.total }];
  } else {
    d.total = montoTras(t, 'importe\\s+total') || montoTras(t, 'total\\s+a\\s+pagar') || montoTras(t, '\\btotal\\b');
    d.igv = montoTras(t, '\\bI\\.?G\\.?V\\.?(?:\\s*\\(?18\\s*%\\)?)?');
    d.subtotal = montoTras(t, 'op(?:\\.|eraci[oó]n)?\\s*gravada') || montoTras(t, 'valor\\s+de\\s+venta') || montoTras(t, 'sub\\s*-?\\s*total') || (d.total && d.igv ? r2(d.total - d.igv) : 0);
    if (d.igv && d.total && Math.abs(d.subtotal + d.igv - d.total) > 0.1) d.subtotal = r2(d.total - d.igv);
    const cond = /(\d+)\s*d[ií]as/i.exec(t); d.condicionPago = /contado/i.test(t) ? 'CONTADO' : cond ? `${cond[1]} DIAS CREDITO` : null;
  }
  return d;
}
$('cLeer').addEventListener('click', async () => {
  const a = ED?.archivo || ED?.adjData;
  if (!a) return msgComp('Primero sube el PDF o la foto del comprobante.', 'error');
  const b = $('cLeer'); ocupado(b, true, 'Leyendo…');
  try {
    let txt = '', via = '';
    if (a.mime === 'application/pdf') {
      msgComp('Leyendo el texto del PDF…'); txt = await textoPDF(a); via = 'Datos leídos del texto del PDF.';
      if (txt.replace(/\s/g, '').length < 60) { msgComp('El PDF es una imagen escaneada. Reconociendo el texto (la primera vez tarda un poco más)…'); txt = await ocr(await imagenDePDF(a), p => msgComp(`Reconociendo el texto… ${p}%`)); via = 'Datos leídos por OCR del PDF escaneado.'; }
    } else {
      msgComp('Reconociendo el texto de la foto (la primera vez descarga el lector, puede tardar)…');
      txt = await ocr(`data:${a.mime};base64,${a.d}`, p => msgComp(`Reconociendo el texto… ${p}%`)); via = 'Datos leídos por OCR de la foto.';
    }
    const d = parsearComprobante(txt); d._fuente = via;
    if (!d.total && !d.proveedorRuc && !d.serie) return msgComp('No se encontraron datos en el comprobante. Prueba con una foto más nítida y derecha, o llénalo a mano.', 'error');
    aplicarIA(d);
    if (!d.total) msgComp(via + ' No se encontró el monto total: escríbelo en el detalle. <b>Revisa todo con la imagen.</b>', '');
  } catch (e) { msgComp('No se pudo leer el comprobante: ' + esc(e.message), 'error'); }
  ocupado(b, false);
});

/* ---------- Guardar ---------- */
const idComp = (ruc, tipo, serie, numero) => `${ruc}_${tipo.replace(/\s+/g, '')}_${serie}-${numero}`.replace(/[\/#?\[\]]/g, '');
function leerForm() {
  const f = {
    tipo: $('cTipo').value, serie: limpio($('cSerie').value).toUpperCase(), numero: limpio($('cNum').value).replace(/^0+(?=\d)/, ''),
    fechaEmision: $('cFecha').value, fechaVence: $('cVence').value, ruc: limpio($('cRuc').value), razon: limpio($('cRazon').value).toUpperCase(),
    condicion: $('cCond').value, forma: $('cForma').value, moneda: $('cMoneda').value, gasto: $('cGasto').value, centro: $('cCentro').value,
    afectoIgv: $('cIgv').value, contable: $('cCont').value, detraccion: $('cDet').value, detPct: num($('cDetPct').value),
    retencion: $('cRet').value, retPct: num($('cRetPct').value),
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
  if (!f.centro && ED?.clase !== 'COMPRA') return 'Elige el centro de costos.';
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
    if (ED.clase === 'COMPRA') await (ED.modo === 'editar' ? guardarCompraCab : guardarCompra)(id, datos); else await guardarServicio(id, datos);
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
// Edición de una factura de materiales ya registrada: solo cabecera; los ítems y el kardex no cambian
async function guardarCompraCab(id, datos) {
  const ref = doc(db, 'comprobantes', id), s = await getDoc(ref);
  if (!s.exists() || s.data().estado === 'ANULADO') throw new Error('El comprobante ya no existe o está anulado.');
  const prev = s.data(), conIgv = datos.afectoIgv === 'SI';
  const lineas = (prev.lineas || []).map(l => { const igv = conIgv ? r2(l.sub * IGV) : 0; return { ...l, igv, tot: r2(l.sub + igv) }; });
  await updateDoc(ref, { ...datos, lineas, editadoMs: Date.now(), editadoPor: YO.nombre });
  await setDoc(doc(db, 'proveedores', datos.ruc), { ruc: datos.ruc, razon: datos.razon, actMs: Date.now() }, { merge: true });
  const docTxt = `${datos.tipo} ${datos.serie}-${datos.numero}`;
  if (YO.rol === 'ADMIN' && (prev.razon !== datos.razon || `${prev.tipo} ${prev.serie}-${prev.numero}` !== docTxt)) {
    const ms = await getDocs(query(collection(db, 'movimientos'), where('comprobanteId', '==', id)));
    const lote = writeBatch(db); let n = 0;
    ms.docs.forEach(d => { if (d.data().origen === 'COMPRA') { lote.update(d.ref, { tercero: datos.razon, documento: docTxt }); n++; } });
    if (n) await lote.commit();
  }
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
// El kardex es solo de consulta: primero la lista de materiales; al elegir uno se muestra su tarjeta
function abrirKardex() { verListaKardex(); pintarKardex(); }
function verListaKardex() { kSel = null; $('kVista').hidden = true; $('kLista').hidden = false; }
$('kVolver').addEventListener('click', () => { const id = kSel; verListaKardex(); pintarKardex(); const tr = id && $('kProds').querySelector(`tr[data-id="${CSS.escape(id)}"]`); if (tr) tr.scrollIntoView({ block: 'center' }); });
$('kBuscar').addEventListener('input', pintarKardex);
function pintarKardex() {
  const q = norm($('kBuscar').value);
  const l = [...PRODUCTOS.values()].filter(p => !q || norm(p.codigo + ' ' + p.nombre).includes(q)).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  $('kProds').innerHTML = l.length ? l.map(p => `<tr data-id="${esc(p.id)}" class="${p.id === kSel ? 'sel' : ''}"><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}<br><small class="nota">${esc(p.unidad)}</small></td><td class="num">${nq(p.stock)}</td><td class="num">${n2(p.valor)}</td></tr>`).join('')
    : `<tr><td colspan="4" class="vacio">${PRODUCTOS.size ? 'Ningún producto coincide.' : 'El kardex está vacío. Los productos se crean al registrar compras en “Ingreso de materiales”.'}</td></tr>`;
  if (kSel && PRODUCTOS.has(kSel)) pintarDetKardex();
}
$('kProds').addEventListener('click', e => { const tr = e.target.closest('tr[data-id]'); if (tr) elegirProdKardex(tr.dataset.id); });
async function elegirProdKardex(id) {
  kSel = id; $('kLista').hidden = true; $('kVista').hidden = false; window.scrollTo(0, 0);
  document.querySelectorAll('#kProds tr').forEach(x => { const s = x.dataset.id === id; x.classList.toggle('sel', s); if (s) x.scrollIntoView({ block: 'nearest' }); });
  $('kDet').innerHTML = '<div class="vacio">Cargando movimientos…</div>';
  try { const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', id))); if (kSel !== id) return; kMovs = ordenarMovs(s.docs.map(d => ({ id: d.id, ...d.data() }))); pintarDetKardex(); }
  catch (err) { $('kDet').innerHTML = `<div class="aviso error">${esc(errorTexto(err))}</div>`; }
}
function nombreCC(t) {
  const c = String(t || '').trim(); const x = (LISTAS.codigosCC || []).find(k => k.codigo === c);
  return x && x.nombre ? `${c} · ${x.nombre}` : c;
}
const esEntrada = m => m.tipo === 'ENTRADA' || m.origen === 'AJUSTE+' || m.origen === 'SALDO INICIAL';
const ordenarMovs = l => l.sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '') || a.ms - b.ms);
// Tarjeta kardex: filtros por periodo y tipo de movimiento, y navegación entre materiales
const KF = { per: '', tipo: '' };
const listaKardex = () => [...$('kProds').querySelectorAll('tr[data-id]')].map(tr => tr.dataset.id);
function pintarDetKardex() {
  const p = PRODUCTOS.get(kSel); if (!p) return;
  const adm = false, u = esc(p.unidad || ''); // la tarjeta es solo de consulta
  const meses = [...new Set(kMovs.map(m => (m.fecha || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  if (KF.per && !meses.includes(KF.per)) KF.per = '';
  // inventario antes de cada movimiento = saldo del movimiento anterior
  const filas = kMovs.map((m, i) => ({ m, ini: i ? kMovs[i - 1].saldoCant : 0, iniVal: i ? kMovs[i - 1].saldoValor : 0, ent: esEntrada(m) }));
  const enPer = filas.filter(f => !KF.per || (f.m.fecha || '').startsWith(KF.per));
  const vis = enPer.filter(f => !KF.tipo || (KF.tipo === 'E' ? f.ent : !f.ent));
  const antes = KF.per ? filas.filter(f => (f.m.fecha || '') < KF.per) : [];
  const saldoIni = antes.length ? antes[antes.length - 1].m : null;
  const cierre = enPer.length ? enPer[enPer.length - 1].m : (saldoIni || { saldoCant: 0, saldoValor: 0 });
  const totE = r4(enPer.filter(f => f.ent).reduce((a, f) => a + f.m.cant, 0)), totS = r4(enPer.filter(f => !f.ent).reduce((a, f) => a + f.m.cant, 0));
  const compras = kMovs.filter(m => m.tipo === 'ENTRADA' && m.origen === 'COMPRA' && m.cu > 0), ult = compras[compras.length - 1], cus = compras.map(m => m.cu);
  const lista = listaKardex(), pos = lista.indexOf(p.id);
  const etq = m => m.origen === 'ANULACION' ? 'ANULA' : m.origen === 'SALDO INICIAL' ? 'SALDO INICIAL' : m.tipo === 'AJUSTE' ? m.origen : m.tipo === 'ENTRADA' ? 'COMPRA' : 'SALIDA';
  const docu = m => m.comprobanteId ? `<a href="#" data-comp="${esc(m.comprobanteId)}" title="Ver la factura">${esc(m.documento)}</a>` : esc(m.documento || '');
  $('kDet').innerHTML = `<div class="tk">
    <div class="tk-cab">
      <button type="button" class="tk-nav" data-nav="-1"${pos <= 0 ? ' disabled' : ''} aria-label="Material anterior" title="Material anterior">‹</button>
      <h3>TARJETA KARDEX</h3>
      <div class="tk-num">N.º <b>${esc(p.codigo)}</b></div>
      <button type="button" class="tk-nav" data-nav="1"${pos < 0 || pos >= lista.length - 1 ? ' disabled' : ''} aria-label="Material siguiente" title="Material siguiente">›</button>
    </div>
    <div class="tk-datos">
      <div class="tk-f"><span>Artículo</span><b>${esc(p.nombre)}</b></div>
      <div class="tk-f"><span>Referencia</span><b>${esc(p.codigo)}${p.categoria ? ' · ' + esc(p.categoria) : ''}</b></div>
      <div class="tk-f"><span>Proveedor</span><b>${ult?.tercero ? esc(ult.tercero) : '—'}</b></div>
      <div class="tk-f"><span>Periodo</span><select id="kPer" aria-label="Periodo"><option value="">Todo el historial</option>${meses.map(m => `<option value="${m}"${m === KF.per ? ' selected' : ''}>${esc(nombreMes(m))}</option>`).join('')}</select></div>
      <div class="tk-f tk-saldo"><span>Saldos${KF.per ? ' al cierre' : ''}</span><b>${nq(cierre.saldoCant)} ${u}</b><b>S/ ${n2(cierre.saldoValor)}</b></div>
      <div class="tk-f"><span>Costo promedio</span><b>S/ ${n2(KF.per ? cierre.cProm : p.cProm)}</b>${ult ? `<small>Última compra S/ ${n2(ult.cu)} (${fmtF(ult.fecha)}) · mín. ${n2(Math.min(...cus))} · máx. ${n2(Math.max(...cus))}</small>` : ''}</div>
    </div>
    <div class="tk-bar">
      <div class="seg" role="group" aria-label="Tipo de movimiento">${[['', 'Todos'], ['E', 'Entradas'], ['S', 'Salidas']].map(([v, t]) => `<button type="button" data-tipo="${v}" class="${KF.tipo === v ? 'act' : ''}">${t}</button>`).join('')}</div>
      <span class="nota">${KF.per ? esc(nombreMes(KF.per)) + ': ' : ''}entraron <b style="color:var(--ok)">${nq(totE)}</b> · salieron <b style="color:var(--rojo)">${nq(totS)}</b> ${u}</span>
      <div class="acc"><button class="btn sec chico" type="button" id="kCsvMov">Exportar</button></div>
    </div>
    <div class="tabla"><table class="tk-tab">
      <thead><tr><th rowspan="2">Fecha</th><th rowspan="2">Documento / Descripción</th><th rowspan="2">Proveedor / destino</th><th colspan="5" class="tk-grupo">UNIDADES</th><th colspan="2" class="tk-grupo">VALORES (S/)</th>${adm ? '<th rowspan="2"></th>' : ''}</tr>
        <tr><th class="num">Inv. inicial</th><th class="num">Costo unit.</th><th class="num">Entrada</th><th class="num">Salida</th><th class="num">Inv. final</th><th class="num">Costo total</th><th class="num">Saldo</th></tr></thead>
      <tbody>${saldoIni && !KF.tipo ? `<tr class="tk-ant"><td>${fmtF(saldoIni.fecha)}</td><td colspan="6"><i>Saldo anterior al periodo</i></td><td class="num"><b>${nq(saldoIni.saldoCant)}</b></td><td></td><td class="num">${n2(saldoIni.saldoValor)}</td>${adm ? '<td></td>' : ''}</tr>` : ''}
      ${vis.length ? vis.map(({ m, ini, ent }) => `<tr class="${ent ? 'tk-e' : 'tk-s'}${m.saldoCant < -1e-9 ? ' tk-neg' : ''}" title="${esc(`Registró: ${m.usuario || ''} · C. prom. después: S/ ${n2(m.cProm)}`)}">
        <td>${fmtF(m.fecha)}</td>
        <td><span class="pill ${m.tipo === 'AJUSTE' ? 'AJUSTE' : m.tipo}">${esc(etq(m))}</span> ${docu(m)}${m.lote ? `<br><small class="nota">Lote ${esc(m.lote)}${m.vence ? ' · vence ' + fmtF(m.vence) : ''}</small>` : ''}</td>
        <td>${esc(nombreCC(m.tercero))}${m.persona ? `<br><small class="nota">${esc(m.persona)}</small>` : ''}</td>
        <td class="num">${nq(ini)}</td><td class="num">${n2(m.cu)}</td>
        <td class="num tk-ent">${ent ? nq(m.cant) : ''}</td><td class="num tk-sal">${ent ? '' : nq(m.cant)}</td>
        <td class="num"><b>${nq(m.saldoCant)}</b></td><td class="num">${n2(m.ct)}</td><td class="num">${n2(m.saldoValor)}</td>
        ${adm ? `<td class="tk-acc"><button type="button" class="tk-ic" data-ed="${esc(m.id)}" title="Editar movimiento" aria-label="Editar movimiento">✎</button><button type="button" class="tk-ic peligro" data-del="${esc(m.id)}" title="Eliminar movimiento" aria-label="Eliminar movimiento">×</button></td>` : ''}</tr>`).join('') : `<tr><td colspan="${adm ? 11 : 10}" class="vacio">Sin movimientos${KF.per || KF.tipo ? ' con este filtro' : ''}.</td></tr>`}</tbody>
      ${enPer.length ? `<tfoot><tr><td colspan="5"><b>Totales${KF.per ? ' del periodo' : ''}</b></td><td class="num tk-ent"><b>${nq(totE)}</b></td><td class="num tk-sal"><b>${nq(totS)}</b></td><td class="num"><b>${nq(cierre.saldoCant)}</b></td><td></td><td class="num"><b>${n2(cierre.saldoValor)}</b></td>${adm ? '<td></td>' : ''}</tr></tfoot>` : ''}
    </table></div></div>`;
  $('kCsvMov').addEventListener('click', () => descargarCSV(`kardex_${p.codigo}${KF.per ? '_' + KF.per : ''}.csv`, filasKardex(vis.map(f => f.m))));
  $('kPer').addEventListener('change', e => { KF.per = e.target.value; pintarDetKardex(); });
  $('kDet').querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', () => { KF.tipo = b.dataset.tipo; pintarDetKardex(); }));
  $('kDet').querySelectorAll('[data-nav]').forEach(b => b.addEventListener('click', () => { const l = listaKardex(), i = l.indexOf(p.id) + Number(b.dataset.nav); if (l[i]) elegirProdKardex(l[i]); }));
}
$('kDet').addEventListener('click', async e => {
  const ed = e.target.closest('[data-ed]'), del = e.target.closest('[data-del]'), comp = e.target.closest('[data-comp]');
  if (comp) {
    e.preventDefault();
    try { const s = await getDoc(doc(db, 'comprobantes', comp.dataset.comp)); if (!s.exists()) return toast('La factura ya no existe.', true); const c = { id: s.id, ...s.data() }; return abrirEditor(c.clase || 'COMPRA', c, 'ver'); }
    catch (err) { return toast(errorTexto(err), true); }
  }
  if (ed) return abrirEdMov(kMovs.find(m => m.id === ed.dataset.ed));
  if (del) {
    const m = kMovs.find(x => x.id === del.dataset.del); if (!m) return;
    if (!confirm(`¿Eliminar este movimiento?\n${fmtF(m.fecha)} · ${m.documento || ''} · ${nq(m.cant)} ${m.unidad || ''}\n\nLos saldos se recalculan solos.`)) return;
    ocupado(del, true);
    try { await deleteDoc(doc(db, 'movimientos', m.id)); await recalcularProducto(kSel); toast('Movimiento eliminado.'); } catch (err) { toast(errorTexto(err), true); ocupado(del, false); }
  }
});
// Vuelve a calcular saldos, costo promedio y valor de todos los movimientos del producto, en orden de fecha
async function recalcularProducto(pid) {
  const p = PRODUCTOS.get(pid) || (await getDoc(doc(db, 'productos', pid))).data();
  const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', pid)));
  const l = ordenarMovs(s.docs.map(d => ({ id: d.id, ...d.data() })));
  let st = 0, val = 0, lote = writeBatch(db), ops = 0;
  for (const m of l) {
    const q = r4(m.cant); let cu = r4(m.cu || 0);
    if (esEntrada(m)) { st = r4(st + q); val = r2(val + q * cu); }
    else { cu = st > 1e-9 ? r4(val / st) : cu; st = r4(st - q); val = st <= 1e-9 ? 0 : r2(val - q * cu); }
    const nuevo = { cu, ct: r2(q * cu), saldoCant: st, cProm: st > 0 ? r4(val / st) : 0, saldoValor: st > 0 ? val : 0, producto: p.nombre, unidad: p.unidad, codigo: p.codigo };
    if (Object.keys(nuevo).some(k => m[k] !== nuevo[k])) { lote.update(doc(db, 'movimientos', m.id), nuevo); if (++ops >= 450) { await lote.commit(); lote = writeBatch(db); ops = 0; } }
    Object.assign(m, nuevo);
  }
  lote.update(doc(db, 'productos', pid), { stock: st, valor: st > 0 ? val : 0, cProm: st > 0 ? r4(val / st) : 0, actMs: Date.now(), ultMov: l.length ? l[l.length - 1].fecha : '' });
  await lote.commit();
  if (kSel === pid) { kMovs = l; const pp = PRODUCTOS.get(pid); if (pp) Object.assign(pp, { stock: st, valor: st > 0 ? val : 0, cProm: st > 0 ? r4(val / st) : 0 }); pintarDetKardex(); }
}
/* Editar o agregar un movimiento (solo administrador) */
let edMov = null;
function abrirEdMov(m) {
  edMov = m;
  $('emTit').textContent = m ? 'Editar movimiento' : 'Agregar movimiento';
  $('emFecha').value = m?.fecha || hoyISO();
  $('emTipo').value = !m ? 'ENTRADA' : m.origen === 'SALDO INICIAL' ? 'SALDO INICIAL' : m.tipo === 'AJUSTE' ? m.origen : m.tipo;
  $('emDoc').value = m?.documento || ''; $('emTercero').value = m?.tercero || ''; $('emPersona').value = m?.persona || '';
  $('emCant').value = m?.cant ?? ''; $('emCu').value = m?.cu ?? (PRODUCTOS.get(kSel)?.cProm || '');
  $('emMsg').textContent = ''; $('emAviso').textContent = m?.comprobanteId ? 'Este movimiento viene de un comprobante registrado; si lo cambias aquí, el comprobante no se modifica.' : '';
  emTipoCambio(); $('dEdMov').showModal();
}
function emTipoCambio() { const t = $('emTipo').value; $('emCuL').hidden = !(t === 'ENTRADA' || t === 'AJUSTE+' || t === 'SALDO INICIAL'); }
$('emTipo').addEventListener('change', emTipoCambio);
$('emCerrar').addEventListener('click', () => $('dEdMov').close());
$('fEdMov').addEventListener('submit', async e => {
  e.preventDefault();
  const t = $('emTipo').value, q = r4(num($('emCant').value));
  if (q <= 0) return $('emMsg').textContent = 'La cantidad debe ser mayor a cero.';
  if (!$('emFecha').value) return $('emMsg').textContent = 'Falta la fecha.';
  const ent = t === 'ENTRADA' || t === 'AJUSTE+' || t === 'SALDO INICIAL';
  const origenPrev = edMov?.origen;
  const d = {
    fecha: $('emFecha').value, cant: q, documento: limpio($('emDoc').value), tercero: limpio($('emTercero').value).toUpperCase(), persona: limpio($('emPersona').value),
    tipo: t === 'ENTRADA' ? 'ENTRADA' : t === 'SALIDA' ? 'SALIDA' : 'AJUSTE',
    origen: t === 'ENTRADA' ? (origenPrev === 'COMPRA' ? 'COMPRA' : 'COMPRA') : t === 'SALIDA' ? (['CONSUMO', 'ANULACION'].includes(origenPrev) ? origenPrev : 'CONSUMO') : t,
    editadoPor: YO.nombre, editadoMs: Date.now()
  };
  if (ent) d.cu = r4(num($('emCu').value));
  const b = e.submitter; ocupado(b, true, 'Guardando…');
  try {
    if (edMov) await updateDoc(doc(db, 'movimientos', edMov.id), d);
    else { const p = PRODUCTOS.get(kSel); await setDoc(doc(collection(db, 'movimientos')), { ...d, cu: d.cu ?? p.cProm ?? 0, productoId: kSel, codigo: p.codigo, producto: p.nombre, unidad: p.unidad, ms: Date.now(), usuario: YO.nombre, uid: YO.uid, creado: serverTimestamp() }); }
    await recalcularProducto(kSel);
    $('dEdMov').close(); toast('Movimiento guardado y kardex recalculado.');
  } catch (err) { $('emMsg').textContent = errorTexto(err); }
  ocupado(b, false);
});
/* Editar o eliminar un producto (solo administrador) */
function abrirEdProd(p) {
  $('epNombre').value = p.nombre; $('epCat').value = p.categoria || ''; $('epMsg').textContent = '';
  opciones($('epUnidad'), LISTAS.unidades, p.unidad);
  $('dEdProd').showModal();
}
$('epCerrar').addEventListener('click', () => $('dEdProd').close());
$('fEdProd').addEventListener('submit', async e => {
  e.preventDefault();
  const nombre = limpio($('epNombre').value).toUpperCase(); if (!nombre) return $('epMsg').textContent = 'Falta el nombre.';
  const otro = [...PRODUCTOS.values()].find(x => x.id !== kSel && norm(x.nombre) === norm(nombre));
  if (otro) return $('epMsg').textContent = `Ya existe otro producto con ese nombre (${otro.codigo}).`;
  const b = e.submitter; ocupado(b, true, 'Guardando…');
  try {
    await updateDoc(doc(db, 'productos', kSel), { nombre, nombreN: norm(nombre), unidad: $('epUnidad').value, categoria: limpio($('epCat').value).toUpperCase(), actMs: Date.now() });
    Object.assign(PRODUCTOS.get(kSel), { nombre, unidad: $('epUnidad').value });
    await recalcularProducto(kSel);
    $('dEdProd').close(); toast('Producto actualizado.');
  } catch (err) { $('epMsg').textContent = errorTexto(err); }
  ocupado(b, false);
});
async function borrarProducto(pid) {
  const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', pid)));
  let lote = writeBatch(db), ops = 0;
  for (const d of s.docs) { lote.delete(d.ref); if (++ops >= 450) { await lote.commit(); lote = writeBatch(db); ops = 0; } }
  lote.delete(doc(db, 'productos', pid)); await lote.commit();
}
$('epBorrar').addEventListener('click', async e => {
  const p = PRODUCTOS.get(kSel); if (!p) return;
  if (!confirm(`¿Eliminar ${p.codigo} · ${p.nombre} con TODOS sus movimientos? No se puede deshacer.`)) return;
  ocupado(e.currentTarget, true, 'Eliminando…');
  try { await borrarProducto(kSel); kSel = null; $('dEdProd').close(); $('kDet').innerHTML = '<div class="vacio">Producto eliminado.</div>'; toast('Producto eliminado.'); } catch (err) { $('epMsg').textContent = errorTexto(err); }
  ocupado(e.currentTarget, false);
});
$('kDeshacer').addEventListener('click', e => deshacerImportacion(e.currentTarget));
async function deshacerImportacion(b) {
  const imp = [...PRODUCTOS.values()].filter(p => p.importado), ids = new Set(imp.map(p => p.id));
  let comps = [];
  try { comps = (await getDocs(query(collection(db, 'comprobantes'), where('importado', '==', true)))).docs; } catch (err) { console.warn(err); }
  if (!imp.length && !comps.length) return toast('No hay nada importado de Excel.');
  if (!confirm(`Se eliminarán ${imp.length} productos importados de Excel con todos sus movimientos y ${comps.length} facturas importadas, para volver a importarlos. ¿Continuar?`)) return;
  ocupado(b, true, 'Eliminando…');
  try {
    let k = 0;
    for (const c of comps) {
      const ms = await getDocs(query(collection(db, 'movimientos'), where('comprobanteId', '==', c.id)));
      const lote = writeBatch(db);
      ms.docs.forEach(d => { if (!ids.has(d.data().productoId)) lote.update(d.ref, { comprobanteId: null }); });
      lote.delete(c.ref); await lote.commit();
      b.textContent = `Eliminando facturas… ${++k}/${comps.length}`;
    }
    k = 0;
    for (const p of imp) { await borrarProducto(p.id); b.textContent = `Eliminando… ${++k}/${imp.length}`; }
    kSel = null; $('kDet').innerHTML = '<div class="vacio">Importación deshecha. Ya puedes volver a importar el Excel.</div>'; toast('Importación deshecha.');
    if (EST.COMPRA.armado) cargarComps('COMPRA');
  }
  catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
}
function filasKardex(movs) {
  return [['Código', 'Producto', 'Unidad', 'Fecha', 'Movimiento', 'Origen', 'Documento', 'Proveedor / destino', 'Entregado a', 'Entrada', 'Salida', 'Saldo cantidad', 'Costo unitario', 'Costo total', 'Costo promedio', 'Saldo valorizado', 'Lote', 'Vencimiento', 'Usuario']]
    .concat(movs.map(m => { const ent = esEntrada(m); return [m.codigo, m.producto, m.unidad, fmtF(m.fecha), m.tipo, m.origen, m.documento, m.tercero || '', m.persona || '', ent ? String(m.cant).replace('.', ',') : '', ent ? '' : String(m.cant).replace('.', ','), String(m.saldoCant).replace('.', ','), numCSV(m.cu), numCSV(m.ct), numCSV(m.cProm), numCSV(m.saldoValor), m.lote || '', fmtF(m.vence), m.usuario]; }));
}
$('kCsvProd').addEventListener('click', () => descargarCSV('productos_kardex.csv', [['Código', 'Producto', 'Unidad', 'Stock', 'Costo promedio', 'Valor', 'Último movimiento']].concat([...PRODUCTOS.values()].sort((a, b) => a.codigo.localeCompare(b.codigo)).map(p => [p.codigo, p.nombre, p.unidad, String(p.stock).replace('.', ','), numCSV(p.cProm), numCSV(p.valor), fmtF(p.ultMov)]))));
$('kCsvTodo').addEventListener('click', async e => {
  const b = e.currentTarget; ocupado(b, true, 'Preparando…');
  try { const s = await getDocs(collection(db, 'movimientos')); const m = s.docs.map(d => d.data()).sort((a, b2) => a.codigo.localeCompare(b2.codigo) || (a.fecha || '').localeCompare(b2.fecha || '') || a.ms - b2.ms); descargarCSV('kardex_completo.csv', filasKardex(m)); }
  catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});

/* Importar kardex desde Excel (una hoja por producto, formato "Registro auxiliar de control de suministros") */
let IMP = [];
let BTN_IMP = null;
$('kImp').addEventListener('click', () => { BTN_IMP = $('kImp'); $('kImpFile').click(); });
$('kImpFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const b = BTN_IMP || $('kImp'); ocupado(b, true, 'Leyendo Excel…');
  try {
    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
    const wb = window.XLSX.read(await f.arrayBuffer(), { type: 'array' });
    IMP = wb.SheetNames.map(n => {
      const ws = wb.Sheets[n];
      if (ws['!ref']) { const r = window.XLSX.utils.decode_range(ws['!ref']); r.s.c = 0; r.s.r = 0; ws['!ref'] = window.XLSX.utils.encode_range(r); } // empezar siempre en A1
      return leerHojaKardex(n, window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }));
    }).filter(Boolean);
    const vistos = new Map();
    IMP.forEach(h => {
      const k = norm(h.nombre);
      if (vistos.has(k)) { h.avisos.push(`El nombre del producto repite al de la hoja “${vistos.get(k)}”; se usará el nombre de la hoja.`); h.nombre = limpio(h.hoja).toUpperCase(); }
      vistos.set(norm(h.nombre), h.hoja);
      if (buscarProd(h.nombre)) { h.avisos.push('Ya existe en el kardex: no se vuelve a importar, solo se enlazan sus entradas con sus facturas.'); h.sel = false; h.existe = true; }
    });
    await prepararFacturasImp(f.name);
    pintarImp(); $('dImp').showModal();
  } catch (err) { toast('No se pudo leer el Excel: ' + err.message, true); }
  ocupado(b, false);
});
const UNI_IMP = { UNIDADES: 'UND', UNIDAD: 'UND', UND: 'UND', PARES: 'PAR', PAR: 'PAR', PAQUETES: 'PAQUETE', PAQUETE: 'PAQUETE', ROLLOS: 'ROLLO', ROLLO: 'ROLLO', BOTELLA: 'BOTELLA', BOTELLAS: 'BOTELLA', SPRAY: 'UND', CAJAS: 'CAJA', CAJA: 'CAJA', KILOS: 'KG', KG: 'KG', LITROS: 'LITRO', METROS: 'METRO' };
function fechaExcel(v, previa) {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v ?? '').trim();
  let m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s); if (m) return iso(m[1], m[2], m[3]);
  m = /^(\d{2})(\d{2})[\/\-.](\d{4})$/.exec(s); if (m) return iso(m[1], m[2], m[3]);
  return previa;
}
function leerHojaKardex(hoja, filas) {
  const celda = (r, c) => (filas[r] || [])[c];
  const valorTras = (rx) => { for (let r = 0; r < Math.min(filas.length, 15); r++) { const f = filas[r] || []; const i = f.findIndex(v => rx.test(String(v ?? ''))); if (i >= 0) { const v = f.slice(i + 1).find(x => x !== null && String(x).trim() !== ''); return v === undefined ? '' : limpio(v); } } return ''; };
  const ini = filas.findIndex(f => (f || []).some(v => norm(v) === 'fecha'));
  if (ini < 0) return null;
  // La columna "Fecha" debe quedar en la posición B; si el Excel empieza en otra columna, se corre todo
  const off = 1 - filas[ini].findIndex(v => norm(v) === 'fecha');
  if (off) filas = filas.map(f => off > 0 ? [...Array(off).fill(null), ...(f || [])] : (f || []).slice(-off));
  const nombre = limpio(valorTras(/DESCRIPCI[OÓ]N DEL PRODUCTO/i) || hoja).toUpperCase();
  const uRaw = limpio(valorTras(/UNIDAD DE MEDIDA/i)).toUpperCase();
  const h = { hoja, nombre, unidad: UNI_IMP[uRaw] || uRaw || 'UND', movs: [], avisos: [], sel: true, ini: 0, ent: 0, sal: 0 };
  let fecha = '', stock = 0, valor = 0, ultSaldoExcel = null;
  const fechas = filas.slice(ini + 1).map(f => fechaExcel((f || [])[1], '')).filter(Boolean);
  const primera = fechas.sort()[0] || hoyISO();
  for (let r = ini + 1; r < filas.length; r++) {
    const f = filas[r] || []; const c = i => f[i];
    const det = limpio(c(4)), doc0 = limpio(c(3)), cc = limpio(c(2)).toUpperCase().replace(/\s*-?\s*ADM$/i, '');
    const tieneFecha = c(1) !== null && String(c(1)).trim() !== '';
    if (typeof c(11) === 'number' && (tieneFecha || cc || doc0 || c(5) === null)) ultSaldoExcel = c(11);
    if (!tieneFecha && !cc && !doc0 && !/saldo\s+inicial/i.test(det)) continue; // fila de totales o de cuadre
    fecha = fechaExcel(c(1), fecha || primera);
    const qIn = num(c(5)), qOut = num(c(8));
    if (/saldo\s+inicial/i.test(det) || /saldo\s+inicial/i.test(String(c(1) ?? ''))) {
      const q = num(c(11)); if (q > 0) { const cu = num(c(12)) || (num(c(13)) / q); stock = r4(q); valor = r2(q * cu); h.ini = stock; h.movs.push({ fecha: primera, tipo: 'AJUSTE', origen: 'SALDO INICIAL', documento: 'Saldo inicial (importado de Excel)', tercero: '', cant: stock, cu: r4(cu), ct: valor, saldoCant: stock, cProm: r4(cu), saldoValor: valor }); }
      continue;
    }
    if (qIn > 0) {
      const cu = num(c(6)) || (num(c(7)) / qIn); stock = r4(stock + qIn); valor = r2(valor + qIn * cu); h.ent = r4(h.ent + qIn);
      h.movs.push({ fecha, fac: claveDoc(doc0), tipo: 'ENTRADA', origen: 'COMPRA', documento: doc0 || det || 'Compra', tercero: '', cant: qIn, cu: r4(cu), ct: r2(qIn * cu), saldoCant: stock, cProm: stock > 0 ? r4(valor / stock) : 0, saldoValor: valor });
    }
    if (qOut > 0) {
      const cu = stock > 0 ? valor / stock : num(c(9));
      if (qOut > stock + 1e-9) h.avisos.push(`Fila ${r + 1}: sale ${nq(qOut)} con solo ${nq(stock)} en stock.`);
      stock = r4(stock - qOut); valor = stock <= 1e-9 ? 0 : r2(valor - qOut * cu); h.sal = r4(h.sal + qOut);
      h.movs.push({ fecha, tipo: 'SALIDA', origen: 'CONSUMO', documento: doc0 || det || 'Entrega', tercero: cc, cant: qOut, cu: r4(cu), ct: r2(qOut * cu), saldoCant: stock, cProm: stock > 0 ? r4(valor / stock) : 0, saldoValor: valor });
    }
  }
  h.stock = stock; h.valor = valor; h.cProm = stock > 0 ? r4(valor / stock) : 0;
  h.saldoExcel = ultSaldoExcel;
  if (ultSaldoExcel !== null && ultSaldoExcel < 0) h.avisos.push(`El Excel termina con saldo negativo (${nq(ultSaldoExcel)}): hay más salidas que entradas. Se cuadra en 0.`);
  const objetivo = ultSaldoExcel === null ? null : Math.max(0, ultSaldoExcel);
  if (objetivo !== null && Math.abs(objetivo - stock) > 0.001) {
    if (ultSaldoExcel >= 0) h.avisos.push(`El Excel termina con saldo ${nq(ultSaldoExcel)}; con los movimientos da ${nq(stock)}.`);
    const dif = r4(objetivo - stock), cuRef = h.movs.slice().reverse().find(m => m.cu > 0)?.cu || 0;
    let st = r4(stock + dif), val;
    if (dif > 0) val = r2((stock > 0 ? valor : 0) + dif * cuRef + (stock < 0 ? stock * cuRef : 0)); else val = st <= 1e-9 ? 0 : r2(valor + dif * (h.cProm || cuRef));
    if (st > 0 && val <= 0) val = r2(st * cuRef);
    h.ajuste = { fecha: hoyISO(), tipo: 'AJUSTE', origen: dif > 0 ? 'AJUSTE+' : 'AJUSTE-', documento: 'Cuadre con saldo final del Excel', tercero: '', cant: Math.abs(dif), cu: r4(cuRef), ct: r2(Math.abs(dif) * cuRef), saldoCant: st, cProm: st > 0 ? r4(val / st) : 0, saldoValor: st > 0 ? val : 0 };
  }
  if (stock < 0) h.avisos.push('El stock quedaría negativo sin el cuadre.');
  if (!h.movs.length) { h.avisos.push('Sin movimientos.'); h.sel = false; }
  return h;
}
const finalImp = h => $('impCuadre').checked && h.ajuste ? { stock: h.ajuste.saldoCant, valor: h.ajuste.saldoValor, cProm: h.ajuste.cProm, movs: [...h.movs, h.ajuste] } : { stock: h.stock, valor: h.valor, cProm: h.cProm, movs: h.movs };
function pintarImp() {
  const sel = IMP.filter(h => h.sel), mov = sel.reduce((a, h) => a + finalImp(h).movs.length, 0), val = sel.reduce((a, h) => a + finalImp(h).valor, 0);
  $('impMsg').innerHTML = `Se encontraron <b>${IMP.length}</b> productos. Seleccionados: <b>${sel.length}</b> con <b>${mov}</b> movimientos; valor final del inventario S/ <b>${n2(val)}</b>. Los saldos se recalculan con costo promedio. Revisa las filas con avisos antes de importar.`;
  $('impFilas').innerHTML = IMP.map((h, i) => `<tr><td><input type="checkbox" data-i="${i}"${h.sel ? ' checked' : ''}${h.existe ? ' disabled' : ''} aria-label="Importar ${esc(h.nombre)}"></td><td>${esc(h.hoja)}</td><td>${esc(h.nombre)}</td><td>${esc(h.unidad)}</td><td class="num">${nq(h.ini)}</td><td class="num">${nq(h.ent)}</td><td class="num">${nq(h.sal)}</td><td class="num"><b>${nq(finalImp(h).stock)}</b>${$('impCuadre').checked && h.ajuste ? `<br><small class="nota">ajuste ${h.ajuste.origen === 'AJUSTE+' ? '+' : '−'}${nq(h.ajuste.cant)}</small>` : ''}</td><td class="num">${n2(finalImp(h).cProm)}</td><td class="num">${n2(finalImp(h).valor)}</td><td>${h.avisos.map(a => `<small class="nota" style="color:var(--ambar)">${esc(a)}</small>`).join('<br>')}</td></tr>`).join('');
  pintarFacsImp();
  $('impOk').disabled = !sel.length && !($('impFacs').checked && FACS_IMP.some(g => !g.existente && g.items.length));
}
$('impFilas').addEventListener('change', e => { const c = e.target.closest('[data-i]'); if (c) { IMP[+c.dataset.i].sel = c.checked; pintarImp(); } });
$('impTodos').addEventListener('change', e => { IMP.forEach(h => { if (!h.existe && h.movs.length) h.sel = e.target.checked; }); pintarImp(); });
$('impCerrar').addEventListener('click', () => $('dImp').close());
$('impCuadre').addEventListener('change', pintarImp);
/* Facturas dentro del Excel de kardex: las entradas de todas las hojas se agrupan por número de comprobante */
// "FAC FR01-40815", "fr01-40815", "FACFR01-41544", "FR001-40014", "FR01 - 45450" → { serie: 'FR01', numero: '40815' }
function claveDoc(txt) {
  let t = String(txt ?? '').toUpperCase().replace(/\s+/g, ' ').trim(); if (!t) return null;
  const tipo = /^BOL/.test(t) ? 'BOLETA' : 'FACTURA';
  t = t.replace(/^(FACTURA|FACT|FAC|FA|BOLETA|BOL)\.?\s*(?=[A-Z])/, '');
  const m = /\b([A-Z]{1,3}) ?(\d{1,4}) ?- ?0*(\d+)\b/.exec(t); if (!m) return null;
  let dig = m[2]; const cab = 4 - m[1].length; // la serie SUNAT tiene 4 caracteres: FR001 → FR01
  if (dig.length > cab && /^0+$/.test(dig.slice(0, dig.length - cab))) dig = dig.slice(-cab);
  const serie = m[1] + dig, numero = m[3];
  return { tipo, serie, numero, clave: serie + '-' + numero };
}
const parecido = (a, b) => { if (a === b) return false; if (b.startsWith(a) || a.startsWith(b)) return true; if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d === 1; };
let FACS_IMP = [], FAC_FIX = {}, PROV_SERIE = {}, COMP_REG = new Map(), COMP_IDS = new Set(), IMP_ARCH = '';
async function prepararFacturasImp(archivo) {
  FAC_FIX = {}; PROV_SERIE = {}; COMP_REG = new Map(); COMP_IDS = new Set(); IMP_ARCH = archivo;
  const n = norm(archivo), tema = /escritorio|oficina/.test(n) ? 'ESCRITORIO' : /limpieza/.test(n) ? 'LIMPIEZA' : '';
  if (tema) $('impCat').value = 'ÚTILES DE ' + tema;
  const gasto = tema === 'ESCRITORIO' ? LISTAS.gastos.find(g => /oficina|escritorio/i.test(g)) : tema === 'LIMPIEZA' ? LISTAS.gastos.find(g => /limpieza/i.test(g)) : '';
  opciones($('impEmp'), LISTAS.empresas.map(e => e.nombre), LISTAS.empresas[0]?.nombre);
  opciones($('impGasto'), LISTAS.gastos, gasto || 'MATERIALES');
  opciones($('impCentro'), LISTAS.areas, LISTAS.areas.find(a => /administraci/i.test(a)) || LISTAS.areas[0]);
  try {
    const s = await getDocs(query(collection(db, 'comprobantes'), where('clase', '==', 'COMPRA')));
    s.forEach(d => {
      const c = d.data(); COMP_IDS.add(d.id); if (c.estado === 'ANULADO') return;
      const k = claveDoc(`${c.serie}-${c.numero}`); if (!k) return;
      COMP_REG.set(k.clave, { id: d.id, ...c });
      if (/^\d{11}$/.test(c.ruc || '') && !PROV_SERIE[k.serie]) PROV_SERIE[k.serie] = { ruc: c.ruc, razon: c.razon || '' };
    });
  } catch (e) { console.warn('comprobantes', e); }
  await cargarProveedores();
}
function armarFacturas() {
  const grupos = new Map();
  IMP.forEach(h => h.movs.forEach(m => {
    m._g = null;
    if (!m.fac || (!h.sel && !h.existe)) return;
    const k = claveDoc(FAC_FIX[m.fac.clave] || m.fac.clave) || m.fac;
    let g = grupos.get(k.clave);
    if (!g) grupos.set(k.clave, g = { ...k, origs: new Set(), items: [], avisos: [] });
    g.origs.add(m.fac.clave); g.items.push({ h, m }); m._g = g;
  }));
  const l = [...grupos.values()];
  l.forEach(g => {
    const cnt = {}; g.items.forEach(({ m }) => { cnt[m.fecha] = (cnt[m.fecha] || 0) + 1; });
    const fechas = Object.keys(cnt).sort();
    g.fecha = fechas.slice().sort((a, b) => cnt[b] - cnt[a] || a.localeCompare(b))[0];
    if (fechas.length > 1) g.avisos.push(`Fechas distintas en el Excel (${fechas.map(fmtF).join(', ')}); se usa ${fmtF(g.fecha)}.`);
    g.sub = r2(g.items.reduce((a, { m }) => a + r2(m.cant * m.cu), 0));
    g.igv = r2(g.items.reduce((a, { m }) => a + r2(r2(m.cant * m.cu) * IGV), 0));
    g.existente = COMP_REG.get(g.clave) || null;
    if (g.existente) g.avisos.push('Ya está registrada en Ingreso de materiales: no se vuelve a crear.');
    if (g.items.some(x => x.h.existe)) g.avisos.push('Incluye materiales que ya estaban en el kardex: se enlazan sus entradas.');
  });
  l.forEach(g => {
    const otro = l.find(o => o !== g && o.serie === g.serie && o.fecha === g.fecha && o.items.length > g.items.length && parecido(g.numero, o.numero));
    if (otro) g.avisos.push(`¿Es la ${otro.clave}? Misma fecha y número parecido; si es la misma factura, corrige el número.`);
  });
  return l.sort((a, b) => a.fecha.localeCompare(b.fecha) || a.clave.localeCompare(b.clave));
}
function pintarFacsImp() {
  const on = $('impFacs').checked; $('impFacBox').hidden = !on;
  ['impEmp', 'impGasto', 'impCentro', 'impIgv'].forEach(i => { $(i).disabled = !on; });
  FACS_IMP = armarFacturas();
  if (!on) return;
  const conIgv = $('impIgv').checked, nuevas = FACS_IMP.filter(g => !g.existente);
  const series = {}; FACS_IMP.forEach(g => { series[g.serie] = (series[g.serie] || 0) + 1; });
  $('impMsg').innerHTML += ` Facturas encontradas: <b>${FACS_IMP.length}</b> (${nuevas.length} nuevas) por S/ <b>${n2(nuevas.reduce((a, g) => a + g.sub + (conIgv ? g.igv : 0), 0))}</b>.`;
  $('impSeries').innerHTML = Object.keys(series).sort().map(se => {
    const p = PROV_SERIE[se] || {};
    return `<tr><td><b>${esc(se)}</b></td><td class="num">${series[se]}</td><td><input class="w8" data-ser="${esc(se)}" data-c="ruc" list="dlProv" inputmode="numeric" maxlength="11" value="${esc(p.ruc || '')}" placeholder="11 dígitos" aria-label="RUC del proveedor de la serie ${esc(se)}"></td><td><input data-ser="${esc(se)}" data-c="razon" value="${esc(p.razon || '')}" placeholder="Razón social" style="min-width:260px;width:100%" aria-label="Razón social del proveedor de la serie ${esc(se)}"></td></tr>`;
  }).join('') || '<tr><td colspan="4" class="vacio">—</td></tr>';
  $('impFacFilas').innerHTML = FACS_IMP.length ? FACS_IMP.map((g, i) => `<tr${g.existente ? ' class="anulado"' : ''}>
      <td><input class="w8" data-fac="${i}" value="${esc(g.clave)}" aria-label="Serie y número de la factura"${g.origs.size > 1 ? ` title="Junta lo escrito como: ${esc([...g.origs].join(', '))}"` : ''}></td>
      <td>${fmtF(g.fecha)}</td><td class="num">${g.items.length}</td>
      <td><small>${esc(g.items.map(({ h, m }) => `${h.nombre} (${nq(m.cant)})`).join(', '))}</small></td>
      <td class="num">${n2(g.sub)}</td><td class="num"><b>${n2(g.sub + (conIgv ? g.igv : 0))}</b></td>
      <td>${g.avisos.map(a => `<small class="nota" style="color:var(--ambar)">${esc(a)}</small>`).join('<br>')}</td></tr>`).join('')
    : '<tr><td colspan="7" class="vacio">No se encontraron números de factura en la columna “Documento”.</td></tr>';
}
$('impFacFilas').addEventListener('change', e => {
  const i = e.target.closest('[data-fac]'); if (!i) return;
  const g = FACS_IMP[+i.dataset.fac], k = claveDoc(i.value);
  if (!k) { toast('Escribe la serie y el número, por ejemplo FR01-40815.', true); i.value = g.clave; return; }
  g.origs.forEach(o => { FAC_FIX[o] = k.clave; });
  pintarImp();
});
$('impSeries').addEventListener('change', e => {
  const i = e.target.closest('[data-ser]'); if (!i) return;
  const se = i.dataset.ser, p = PROV_SERIE[se] || (PROV_SERIE[se] = { ruc: '', razon: '' });
  if (i.dataset.c === 'ruc') {
    p.ruc = i.value.replace(/\D/g, ''); i.value = p.ruc;
    const conocido = PROVEEDORES.get(p.ruc), raz = $('impSeries').querySelector(`[data-ser="${CSS.escape(se)}"][data-c="razon"]`);
    if (conocido && !p.razon) { p.razon = conocido.razon; raz.value = conocido.razon; }
  } else p.razon = limpio(i.value).toUpperCase();
});
['impFacs', 'impIgv'].forEach(id => $(id).addEventListener('change', pintarImp));
const lineaImp = (desc, prodId, codigo, unidad, cant, cu, conIgv) => { const sub = r2(cant * cu), igv = conIgv ? r2(sub * IGV) : 0; return { desc, prodId, codigo, unidad, cant: r4(cant), vu: r4(cu), lote: '', vence: '', sub, igv, tot: r2(sub + igv) }; };

$('impOk').addEventListener('click', async () => {
  const sel = IMP.filter(h => h.sel), conFacs = $('impFacs').checked, conIgv = $('impIgv').checked;
  const facs = conFacs ? armarFacturas().filter(g => !g.existente) : [];
  IMP.forEach(h => h.movs.forEach(m => { if (!conFacs || m._g?.existente) m._g = null; }));
  if (!sel.length && !facs.length) return;
  if (sel.length && !conFacs && !confirm('No se registrarán las facturas: las entradas quedarán en el kardex sin factura. ¿Continuar?')) return;
  for (const g of facs) {
    const p = PROV_SERIE[g.serie] || {};
    if (p.ruc && !/^\d{11}$/.test(p.ruc)) return toast(`El RUC de la serie ${g.serie} debe tener 11 dígitos.`, true);
    Object.assign(g, { ruc: p.ruc || '', razon: p.razon || 'PROVEEDOR POR COMPLETAR', doc: `${g.tipo} ${g.serie}-${g.numero}`, lineas: [] });
    g.id = idComp(g.ruc || 'SINRUC', g.tipo, g.serie, g.numero);
  }
  const sinProv = [...new Set(facs.filter(g => !g.ruc).map(g => g.serie))];
  if (sinProv.length && !confirm(`Las series ${sinProv.join(', ')} no tienen proveedor. Las facturas se registrarán como “PROVEEDOR POR COMPLETAR” y luego podrás corregirlas con “Editar” en Ingreso de materiales.\n\n¿Importar de todos modos?`)) return;
  const negativos = sel.filter(h => finalImp(h).stock < -1e-9);
  if (negativos.length && !confirm(`Estos materiales quedarían con stock negativo y NO se importarán:\n${negativos.map(h => '• ' + h.nombre).join('\n')}\n\nActiva “Cuadrar con el saldo final del Excel” para incluirlos. ¿Continuar sin ellos?`)) return;
  const aImportar = sel.filter(h => !negativos.includes(h));
  const b = $('impOk'); ocupado(b, true, 'Importando…'); $('impErr').hidden = true;
  let hechos = 0, nf = 0;
  try {
    const cont = await getDoc(doc(db, 'config', 'contadores'));
    let n = cont.exists() ? (cont.data().producto || 0) : 0;
    const cat = limpio($('impCat').value).toUpperCase();
    let lote = writeBatch(db), ops = 0, ms = Date.now(), sinEnlace = 0;
    const enviar = async (forzar) => { if (ops >= 450 || (forzar && ops)) { await lote.commit(); lote = writeBatch(db); ops = 0; } };
    // 1. Materiales nuevos con todo su kardex; sus entradas quedan enlazadas a su factura.
    //    El producto se graba al final, para que nunca quede un material a medias si algo falla.
    for (const h0 of aImportar) {
      const h = { ...h0, ...finalImp(h0) };
      n += 1; const pid = doc(collection(db, 'productos')).id, codigo = 'P' + String(n).padStart(5, '0');
      const lineas = [];
      for (const m of h.movs) {
        const { fac, _g, ...mm } = m;
        if (_g) { Object.assign(mm, { comprobanteId: _g.id, documento: _g.doc, tercero: _g.razon }); lineas.push([_g, lineaImp(h.nombre, pid, codigo, h.unidad, m.cant, m.cu, conIgv)]); }
        lote.set(doc(collection(db, 'movimientos')), { ...mm, productoId: pid, codigo, producto: h.nombre, unidad: h.unidad, ms: ms++, usuario: YO.nombre + ' (importado de Excel)', uid: YO.uid, creado: serverTimestamp() });
        ops++; await enviar();
      }
      lote.set(doc(db, 'productos', pid), { codigo, nombre: h.nombre, nombreN: norm(h.nombre), unidad: h.unidad, categoria: cat, stock: h.stock, valor: h.valor, cProm: h.cProm, creadoMs: Date.now(), actMs: Date.now(), ultMov: h.movs[h.movs.length - 1]?.fecha || '', importado: true });
      lote.set(doc(db, 'config', 'contadores'), { producto: n }, { merge: true }); ops += 2;
      await enviar(true);
      lineas.forEach(([g, l]) => g.lineas.push(l));
      hechos++; b.textContent = `Materiales… ${hechos}/${aImportar.length}`;
    }
    // 2. Materiales que ya estaban en el kardex: se enlazan sus entradas existentes con la factura
    for (const h of IMP.filter(x => x.existe)) {
      const items = h.movs.filter(m => m._g); if (!items.length) continue;
      const p = buscarProd(h.nombre); if (!p) continue;
      const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', p.id)));
      const libres = s.docs.filter(d => d.data().tipo === 'ENTRADA' && (!d.data().comprobanteId || !COMP_IDS.has(d.data().comprobanteId)));
      for (const m of items) {
        const i = libres.findIndex(d => claveDoc(d.data().documento)?.clave === m.fac.clave && Math.abs((d.data().cant || 0) - m.cant) < 1e-6);
        if (i < 0) { sinEnlace++; continue; }
        const d = libres.splice(i, 1)[0], x = d.data();
        lote.update(d.ref, { comprobanteId: m._g.id, documento: m._g.doc, tercero: m._g.razon }); ops++; await enviar();
        m._g.lineas.push(lineaImp(p.nombre, p.id, p.codigo, p.unidad, x.cant, x.cu || m.cu, conIgv));
      }
    }
    // 3. Las facturas, con todos sus ítems
    b.textContent = 'Registrando facturas…';
    const emp = $('impEmp').value, empresaRuc = LISTAS.empresas.find(e => e.nombre === emp)?.ruc || '', centro = $('impCentro').value;
    for (const g of facs) {
      if (!g.lineas.length) continue;
      const subtotal = r2(g.lineas.reduce((a, l) => a + l.sub, 0)), igv = r2(g.lineas.reduce((a, l) => a + l.igv, 0)), total = r2(subtotal + igv);
      lote.set(doc(db, 'comprobantes', g.id), {
        tipo: g.tipo, serie: g.serie, numero: g.numero, fechaEmision: g.fecha, fechaVence: '', ruc: g.ruc, razon: g.razon,
        condicion: 'CONTADO', forma: '', moneda: 'PEN', gasto: $('impGasto').value, centro, afectoIgv: conIgv ? 'SI' : 'NO', contable: 'SI',
        detraccion: 'NO', detPct: 0, retencion: 'NO', retPct: 0, empresa: emp, empresaRuc, destino: centro, solicitud: '',
        notas: `Importada del Excel de kardex${IMP_ARCH ? ' (' + IMP_ARCH + ')' : ''}.`, mes: g.fecha.slice(0, 7), clase: 'COMPRA',
        lineas: g.lineas, subtotal, igv, total, detMonto: 0, retMonto: 0, totalPagar: total, adjuntoId: null,
        creadoMs: Date.now(), creadoPor: { uid: YO.uid, nombre: YO.nombre },
        aprobacion: { estado: 'APROBADO', fecha: hoyISO(), usuario: YO.nombre, uid: YO.uid, motivo: 'Factura histórica importada del Excel de kardex' },
        estado: 'REGISTRADO', importado: true
      });
      ops++; nf++;
      if (g.ruc) { lote.set(doc(db, 'proveedores', g.ruc), { ruc: g.ruc, razon: g.razon, actMs: Date.now() }, { merge: true }); ops++; PROVEEDORES.set(g.ruc, { ruc: g.ruc, razon: g.razon }); }
      await enviar();
    }
    await enviar(true);
    $('dImp').close();
    toast(`${hechos} materiales importados al kardex y ${nf} facturas registradas en Ingreso de materiales.${sinEnlace ? ` ${sinEnlace} entradas de materiales existentes no se encontraron para enlazar.` : ''}`);
    if (EST.COMPRA.armado) cargarComps('COMPRA');
  } catch (err) {
    console.error(err);
    $('impErr').hidden = false;
    $('impErr').innerHTML = `<b>La importación se detuvo:</b> ${esc(errorTexto(err))}<br>Se alcanzaron a grabar ${hechos} materiales completos y ${nf} facturas. Para no duplicar nada, usa “Deshacer importación” y vuelve a importar el Excel.`;
    toast('La importación se detuvo. Mira el detalle en la ventana.', true);
  }
  ocupado(b, false);
});

/* ================= Solicitudes de sucursales (las envían desde solicitud.html sin usuario) ================= */
// Catálogo público que lee solicitud.html: solo nombres de materiales y de sucursales (sin stock ni costos)
let catPublicado = null, catTimer = null;
function centrosPublicos() {
  const l = (LISTAS.codigosCC || []).map(c => ({ v: c.codigo, t: c.nombre ? `${c.codigo} · ${c.nombre}` : c.codigo }));
  if (l.filter(c => c.t !== c.v).length >= 2) return l; // con los centros de costo oficiales basta
  const nombres = new Set((LISTAS.codigosCC || []).map(c => norm(c.nombre)));
  LISTAS.areas.forEach(a => { if (!nombres.has(norm(a))) l.push({ v: a, t: a }); });
  return l;
}
function sincronizarCatalogo() {
  if (!YO || !puede('kardex')) return;
  clearTimeout(catTimer);
  catTimer = setTimeout(async () => {
    try {
      const datos = { items: [...PRODUCTOS.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(p => ({ i: p.id, c: p.codigo, n: p.nombre, u: p.unidad || '', k: /LIMPIEZA/i.test(p.categoria || '') ? 'L' : /ESCRITORIO|OFICINA/i.test(p.categoria || '') ? 'E' : '' })), centros: centrosPublicos() };
      const txt = JSON.stringify(datos);
      if (catPublicado === null) { const s = await getDoc(doc(db, 'publico', 'catalogo')); catPublicado = s.exists() ? JSON.stringify({ items: s.data().items || [], centros: s.data().centros || [] }) : ''; }
      if (txt === catPublicado) return;
      await setDoc(doc(db, 'publico', 'catalogo'), { ...datos, actMs: Date.now() });
      catPublicado = txt;
    } catch (e) { console.warn('catálogo público', e); }
  }, 2500);
}
const urlSolicitud = () => new URL('solicitud.html', location.href.split('#')[0]).href;

const SOLS = { lista: [] };
function abrirSolicitudes() {
  $('solLink').innerHTML = `<b>Enlace para las sucursales</b> (no necesita usuario ni contraseña): <a href="${esc(urlSolicitud())}" target="_blank" rel="noopener">${esc(urlSolicitud())}</a> <button type="button" class="btn sec chico" id="solCopiar">Copiar enlace</button>`;
  $('solCopiar').addEventListener('click', async () => { try { await navigator.clipboard.writeText(urlSolicitud()); toast('Enlace copiado. Envíalo a las sucursales.'); } catch (e) { prompt('Copia este enlace:', urlSolicitud()); } });
  sincronizarCatalogo();
  cargarSolicitudes();
}
async function cargarSolicitudes() {
  const est = $('solEstado').value; let mes = $('solMes').value;
  if (!est && !mes) { mes = mesISO(); $('solMes').value = mes; }
  $('solFilas').innerHTML = '<div class="vacio">Cargando…</div>';
  try {
    const q = est ? query(collection(db, 'solicitudes'), where('estado', '==', est)) : query(collection(db, 'solicitudes'), where('mes', '==', mes));
    const s = await getDocs(q);
    SOLS.lista = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => !mes || x.mes === mes).sort((a, b) => (b.numero || 0) - (a.numero || 0));
    pintarSolicitudes();
  } catch (e) { $('solFilas').innerHTML = `<div class="aviso error">${esc(errorTexto(e))}</div>`; }
}
const estSol = e => e === 'ATENDIDA' ? 'ENTREGADA' : e;
function filtrarSolicitudes() {
  const q = norm($('solBuscar').value);
  const t = $('solTipo').value;
  return SOLS.lista.filter(x => (!t || (x.tipo || 'ESCRITORIO') === t) && (!q || norm([x.numero, x.centroNombre, x.solicitante, ...(x.items || []).map(i => i.desc)].join(' ')).includes(q)));
}
const pillSol = x => `<span class="pill ${x.estado === 'ATENDIDA' ? 'APROBADO' : x.estado === 'RECHAZADA' ? 'RECHAZADO' : 'PENDIENTE'}">${esc(estSol(x.estado))}</span>`;
function pintarSolicitudes() {
  const l = filtrarSolicitudes();
  $('solRes').innerHTML = `<span><b>${l.length}</b> solicitudes</span><span>Pendientes: <b>${l.filter(x => x.estado === 'PENDIENTE').length}</b></span>`;
  if (SOLS.sel && !l.some(x => x.id === SOLS.sel)) SOLS.sel = null;
  $('solFilas').innerHTML = l.length ? `<table class="lst"><thead><tr><th>N.º</th><th>Fecha</th><th>Tipo</th><th>Sucursal / centro de costo</th><th class="opc">Solicitado por</th><th class="opc">Materiales</th><th>Estado</th></tr></thead><tbody>${l.map(x => `<tr data-solsel="${esc(x.id)}">
      <td><a href="#" data-solsel="${esc(x.id)}">${x.numero}</a></td><td>${fmtF(x.fecha)}</td><td>${tipoSolTxt(x) === 'LIMPIEZA' ? '🧽 Limpieza' : '✏️ Escritorio'}</td>
      <td>${esc(x.centroNombre || x.centro)}</td><td class="opc">${esc(x.solicitante)}</td>
      <td class="opc">${(x.items || []).length} material(es)<span class="sub">${esc((x.items || []).slice(0, 2).map(i => i.desc).join(', '))}${(x.items || []).length > 2 ? '…' : ''}</span></td>
      <td>${pillSol(x)}${x.fechaEntrega ? `<span class="sub">${fmtF(x.fechaEntrega)}</span>` : ''}</td></tr>`).join('')}</tbody></table><div class="lst-pie">Total — ${l.length}</div>`
    : '<div class="vacio">No hay solicitudes con este filtro.</div>';
  pintarDetSolicitud();
}
// Documento de la solicitud elegida, con su barra de acciones
function pintarDetSolicitud() {
  const x = SOLS.lista.find(y => y.id === SOLS.sel);
  $('solMD').classList.toggle('ver-doc', !!x);
  if (!x) { $('solDet').innerHTML = ''; return; }
  const id = esc(x.id), entregada = !!x.entrega, op = puede('kardex'), adm = YO.rol === 'ADMIN', par = parejaDe(x);
  const acc = [];
  if (x.estado === 'PENDIENTE' && op) acc.push(botonIco('camion', par ? 'Atender (con N.º ' + par.numero + ')' : 'Atender', `data-sol="${id}"`, 'prim'));
  else acc.push(botonIco('editar', 'Abrir', `data-sol="${id}"`));
  acc.push(botonIco('imprimir', 'Imprimir', `data-solimp="${id}"`), botonIco('excel', 'Excel', `data-solxls="${id}"`));
  if (adm && x.estado !== 'PENDIENTE') acc.push(botonIco('deshacer', 'Volver a pendiente', `data-solrev="${id}"`));
  if (adm) acc.push(botonIco('borrar', 'Borrar', `data-soldel="${id}"`, 'peligro'));
  const est = x.estado === 'ATENDIDA' ? '<span class="estado ok">ENTREGADA</span>' : x.estado === 'RECHAZADA' ? '<span class="estado no">RECHAZADA</span>' : '<span class="estado am">PENDIENTE</span>';
  const datos = [['Sucursal / centro de costo', esc(x.centroNombre || x.centro)], ['Solicitado por', esc(x.solicitante)], ['Fecha de solicitud', fmtF(x.fecha)],
    ...(entregada ? [['Fecha de entrega', fmtF(x.fechaEntrega)], ['Entregado por', esc(x.entregadoPor || '—')], ['Recibido por', esc(x.recibidoPor || '—')]] : [])];
  const filas = entregada
    ? x.entrega.map((i, k) => { const no = !(i.cant > 0); return `<tr class="${no ? 'sol-no' : i.cantSol && i.cant < i.cantSol ? 'sol-parcial' : ''}"><td>${k + 1}</td><td>${esc(i.producto || i.desc)}${i.producto && i.producto !== i.desc ? `<br><small class="nota">Pidió: ${esc(i.desc)}</small>` : ''}</td><td class="num">${nq(i.cantSol)}</td><td class="num"><b>${no ? '—' : nq(i.cant)}</b> ${esc(i.unidad || '')}</td><td>${no ? '<span class="obs-txt">NO ATENDIDO</span> ' : ''}${i.obs ? `<span class="obs-txt">${esc(i.obs)}</span>` : ''}</td><td class="num">${no ? '' : n2(i.cu)}</td><td class="num">${no ? '' : n2(i.ct)}</td></tr>`; }).join('')
    : (x.items || []).map((i, k) => { const p = (i.prodId && PRODUCTOS.get(i.prodId)) || buscarProd(i.desc); const falta = p && p.stock + 1e-9 < i.cant; return `<tr><td>${k + 1}</td><td>${esc(i.desc)}${p ? `<br><small class="nota">${esc(p.codigo)}</small>` : i.nuevo ? '<br><span class="pill AJUSTE">MATERIAL NUEVO · pedido como “Otro”</span>' : '<br><small class="nota">No está en el kardex</small>'}</td><td class="num"><b>${nq(i.cant)}</b> ${esc(i.unidad || '')}</td><td class="num"${falta ? ' style="color:var(--rojo);font-weight:bold"' : ''}>${p ? nq(p.stock) + ' ' + esc(p.unidad) : '—'}</td></tr>`; }).join('');
  $('solDet').innerHTML = `<div class="tb">${botonIco('', '← Volver a la lista', 'data-solvolver="1"')}<span class="tit">Solicitud N.º ${x.numero}</span>${acc.join('')}</div>
    <div class="doc">
      <div class="doc-cab"><div><h3>${tipoSolTxt(x) === 'LIMPIEZA' ? '🧽 MATERIALES DE LIMPIEZA' : '✏️ ÚTILES DE ESCRITORIO'}</h3><div class="sub">Solicitud N.º <b>${x.numero}</b> · ${esc(x.centroNombre || x.centro)}</div>${est}</div>
        ${entregada ? `<div style="text-align:right"><div class="nota">Costo de lo entregado</div><div style="font-size:24px;font-weight:bold">S/ ${n2(x.totalCosto)}</div></div>` : `<div style="text-align:right"><div class="nota">Materiales</div><div style="font-size:24px;font-weight:bold">${(x.items || []).length}</div></div>`}</div>
      ${par ? `<div class="aviso-par">Este pedido va junto con la <button type="button" data-solsel="${esc(par.id)}">Solicitud N.º ${par.numero} (${tipoSolTxt(par) === 'LIMPIEZA' ? 'limpieza' : 'escritorio'})</button>${x.estado === 'PENDIENTE' ? '. Al atender se abren las dos juntas.' : '.'}</div>` : ''}
      <div class="doc-datos">${datos.map(([k, v]) => `<div>${k}<b>${v}</b></div>`).join('')}</div>
      ${x.nota ? `<div class="aviso">Comentario de la sucursal: “${esc(x.nota)}”</div>` : ''}${x.motivo ? `<div class="aviso error">Motivo del rechazo: ${esc(x.motivo)}</div>` : ''}
      <div class="tabla"><table><thead><tr>${entregada ? '<th>#</th><th>Material</th><th class="num">Pidió</th><th class="num">Entregado</th><th>Observación</th><th class="num">C. unit.</th><th class="num">C. total</th>' : '<th>#</th><th>Material</th><th class="num">Pidió</th><th class="num">Stock actual</th>'}</tr></thead><tbody>${filas || '<tr><td colspan="7" class="vacio">Sin materiales.</td></tr>'}</tbody></table></div>
      ${entregada ? `<div class="tots"><span class="g">Total</span><b class="g">S/ ${n2(x.totalCosto)}</b></div>` : ''}
    </div>`;
}
$('solEstado').addEventListener('change', () => { if ($('solEstado').value === 'PENDIENTE') $('solMes').value = ''; cargarSolicitudes(); });
$('solMes').addEventListener('change', cargarSolicitudes);
$('solBuscar').addEventListener('input', pintarSolicitudes);
$('solTipo').addEventListener('change', pintarSolicitudes);
const tipoSolTxt = x => x.tipo === 'LIMPIEZA' ? 'LIMPIEZA' : 'ESCRITORIO';
$('solCsv').addEventListener('click', () => {
  const f = [['N.º', 'Tipo', 'Fecha solicitud', 'Sucursal', 'Solicitado por', 'Estado', 'Fecha entrega', 'Material pedido', 'Cant. pedida', 'Código', 'Material entregado', 'Cant. entregada', 'Costo unit.', 'Costo total', 'Observación', 'Recibido por', 'Entregado por']];
  filtrarSolicitudes().forEach(x => (x.entrega || x.items || []).forEach(i => f.push([x.numero, tipoSolTxt(x), fmtF(x.fecha), x.centroNombre || x.centro, x.solicitante, estSol(x.estado), fmtF(x.fechaEntrega), i.desc, String(i.cantSol ?? i.cant).replace('.', ','), i.codigo || '', i.producto || '', x.entrega ? String(i.cant).replace('.', ',') : '', x.entrega ? numCSV(i.cu) : '', x.entrega ? numCSV(i.ct) : '', i.obs || (x.entrega && !(i.cant > 0) ? 'NO ATENDIDO' : ''), x.recibidoPor || '', x.entregadoPor || ''])));
  descargarCSV(`solicitudes_${$('solMes').value || 'pendientes'}.csv`, f);
});
$('solMD').addEventListener('click', async e => {
  const a = e.target.closest('[data-sol]'), xl = e.target.closest('[data-solxls]'), del = e.target.closest('[data-soldel]'), rev = e.target.closest('[data-solrev]');
  if (rev) { const x = SOLS.lista.find(y => y.id === rev.dataset.solrev); if (x) volverAPendiente(x, rev); return; }
  const sel = e.target.closest('[data-solsel]'), imp = e.target.closest('[data-solimp]');
  if (sel) { e.preventDefault(); SOLS.sel = sel.dataset.solsel; pintarDetSolicitud(); window.scrollTo(0, 0); return; }
  if (e.target.closest('[data-solvolver]')) { SOLS.sel = null; pintarDetSolicitud(); return; }
  if (imp) { const x = SOLS.lista.find(y => y.id === imp.dataset.solimp), par = x && parejaDe(x); if (x) { if (par) imprimirSucursalUnaHoja(x.centroNombre || x.centro, [x, par]); else imprimirSolicitud(x); } return; }
  if (a) abrirSolicitud(SOLS.lista.find(x => x.id === a.dataset.sol));
  if (xl) { const x = SOLS.lista.find(y => y.id === xl.dataset.solxls); if (x) excelSolicitud(x, xl); }
  if (del) {
    const x = SOLS.lista.find(y => y.id === del.dataset.soldel); if (!x) return;
    const extra = x.estado === 'ATENDIDA' ? '\n\nYa fue entregada: las salidas que registró en el kardex NO se borran (si hace falta, elimínalas en Salida de materiales).' : '';
    if (!confirm(`¿Borrar la solicitud N.º ${x.numero} (${tipoSolTxt(x).toLowerCase()}) de ${x.centroNombre || x.centro}?${extra}\n\nNo se puede deshacer.`)) return;
    ocupado(del, true);
    try { await deleteDoc(doc(db, 'solicitudes', x.id)); toast(`Solicitud N.º ${x.numero} borrada.`); SOLS.lista = SOLS.lista.filter(y => y.id !== x.id); pintarSolicitudes(); }
    catch (err) { toast(errorTexto(err), true); ocupado(del, false); }
  }
});

// Volver a pendiente (solo ADMIN): borra las salidas que registró la entrega, recalcula el stock y deja la solicitud como nueva
async function volverAPendiente(x, b) {
  const entregada = x.estado === 'ATENDIDA';
  if (!confirm(`¿Volver a PENDIENTE la solicitud N.º ${x.numero} (${tipoSolTxt(x).toLowerCase()}) de ${x.centroNombre || x.centro}?` +
    (entregada ? '\n\nSe borrarán las salidas que registró en el kardex y el stock volverá a como estaba antes de la entrega.' : '\n\nSe quitará el rechazo.'))) return;
  ocupado(b, true, 'Revirtiendo…');
  try {
    if (entregada) {
      const ms = await getDocs(query(collection(db, 'movimientos'), where('solicitudId', '==', x.id)));
      const pids = new Set(ms.docs.map(d => d.data().productoId));
      let lote = writeBatch(db), n = 0;
      for (const d of ms.docs) { lote.delete(d.ref); if (++n % 450 === 0) { await lote.commit(); lote = writeBatch(db); } }
      if (n % 450) await lote.commit();
      for (const pid of pids) if (pid) await recalcularProducto(pid); // stock, valor y costo promedio sin esas salidas
    }
    const quitar = {}; ['fechaEntrega', 'entregadoPor', 'recibidoPor', 'entrega', 'totalCosto', 'atendidoPor', 'atendidoMs', 'motivo'].forEach(c => { quitar[c] = deleteField(); });
    await updateDoc(doc(db, 'solicitudes', x.id), { estado: 'PENDIENTE', ...quitar });
    toast(`Solicitud N.º ${x.numero} otra vez pendiente.${entregada ? ' Se borraron sus salidas del kardex.' : ''}`);
    cargarSolicitudes();
  } catch (err) { toast(errorTexto(err), true); ocupado(b, false); }
}

/* Excel (.xlsx) de solicitudes */
async function libroXlsx() { await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'); return window.XLSX; }
function hojaXlsx(X, filas, anchos) { const ws = X.utils.aoa_to_sheet(filas); ws['!cols'] = anchos.map(w => ({ wch: w })); return ws; }
const sucTxt = x => x.centroNombre || x.centro;
// Una solicitud: datos de cabecera y sus materiales
async function excelSolicitud(x, b) {
  ocupado(b, true, '…');
  try {
    const X = await libroXlsx(), entregada = !!x.entrega;
    const filas = [[`FORMATO DE CONSUMO DE MATERIALES DE ${tipoSolTxt(x)}`], [],
      ['N.º correlativo', x.numero], ['Fecha de solicitud', fmtF(x.fecha)], ['Sucursal / centro de costo', sucTxt(x)], ['Solicitado por', x.solicitante], ['Estado', estSol(x.estado)],
      ...(entregada ? [['Fecha de entrega', fmtF(x.fechaEntrega)], ['Entregado por', x.entregadoPor || ''], ['Recibido por', x.recibidoPor || '']] : []),
      ...(x.nota ? [['Comentario', x.nota]] : []), [],
      entregada ? ['#', 'Material pedido', 'Cant. pedida', 'Código', 'Material entregado', 'Cant. entregada', 'Unidad', 'Costo unit.', 'Costo total', 'Estado', 'Observación'] : ['#', 'Material', 'Cantidad', 'Unidad', 'Código', 'Stock actual']];
    (x.entrega || x.items || []).forEach((i, k) => filas.push(entregada
      ? [k + 1, i.desc, i.cantSol ?? '', i.codigo || '', i.producto || '', i.cant, i.unidad || '', r2(i.cu || 0), r2(i.ct || 0), !(i.cant > 0) ? 'NO ATENDIDO' : i.cantSol && i.cant < i.cantSol ? 'PARCIAL' : 'ENTREGADO', i.obs || '']
      : [k + 1, i.desc, i.cant, i.unidad || '', i.codigo || '', i.prodId && PRODUCTOS.get(i.prodId) ? PRODUCTOS.get(i.prodId).stock : '']));
    if (entregada) filas.push([], ['', '', '', '', '', '', '', 'TOTAL S/', r2(x.totalCosto || 0)]);
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, hojaXlsx(X, filas, [24, 34, 12, 10, 32, 14, 10, 12, 12, 14, 40]), `Solicitud ${x.numero}`);
    X.writeFile(wb, `solicitud_${x.numero}_${tipoSolTxt(x).toLowerCase()}_${String(x.centro).replace(/\W+/g, '')}.xlsx`);
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
}
// Todas las pendientes de un tipo: resumen por material (para comprar o preparar) y detalle por sucursal
async function excelPendientes(tipo, b) {
  ocupado(b, true, 'Preparando…');
  try {
    const X = await libroXlsx();
    const s = await getDocs(query(collection(db, 'solicitudes'), where('estado', '==', 'PENDIENTE')));
    const l = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => (x.tipo || 'ESCRITORIO') === tipo)
      .sort((a, c) => String(a.centro).localeCompare(String(c.centro), 'es', { numeric: true }) || a.numero - c.numero);
    if (!l.length) { toast(`No hay solicitudes pendientes de ${tipo === 'LIMPIEZA' ? 'limpieza' : 'escritorio'}.`); ocupado(b, false); return; }
    const res = new Map();
    l.forEach(x => (x.items || []).forEach(i => {
      const p = i.prodId ? PRODUCTOS.get(i.prodId) : buscarProd(i.desc), k = p ? 'p:' + p.id : 'd:' + norm(i.desc) + '|' + norm(i.unidad);
      const r = res.get(k) || { codigo: p?.codigo || '', desc: (p?.nombre || i.desc).toUpperCase(), unidad: p?.unidad || i.unidad || '', total: 0, sucs: new Set(), stock: p ? p.stock : null };
      r.total = r4(r.total + (Number(i.cant) || 0)); r.sucs.add(sucTxt(x)); res.set(k, r);
    }));
    const resumen = [[`PENDIENTES DE ${tipo} · ${l.length} solicitudes · al ${fmtF(hoyISO())}`], [], ['Código', 'Material', 'Unidad', 'Total pedido', 'Stock actual', 'Falta comprar', 'Sucursales que lo piden']];
    [...res.values()].sort((a, c) => a.desc.localeCompare(c.desc, 'es')).forEach(r => resumen.push([r.codigo, r.desc, r.unidad, r.total, r.stock ?? 'no está en kardex', r.stock === null ? r.total : Math.max(0, r4(r.total - r.stock)), [...r.sucs].join(', ')]));
    const det = [['N.º', 'Fecha', 'Sucursal / centro de costo', 'Solicitado por', 'Material', 'Cantidad', 'Unidad', 'Código', 'Comentario']];
    l.forEach(x => (x.items || []).forEach(i => det.push([x.numero, fmtF(x.fecha), sucTxt(x), x.solicitante, i.desc, i.cant, i.unidad || '', i.codigo || '', x.nota || ''])));
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, hojaXlsx(X, resumen, [10, 38, 10, 13, 13, 14, 60]), 'Resumen por material');
    X.utils.book_append_sheet(wb, hojaXlsx(X, det, [7, 12, 34, 28, 38, 10, 10, 10, 40]), 'Detalle por sucursal');
    X.writeFile(wb, `pendientes_${tipo.toLowerCase()}_${hoyISO()}.xlsx`);
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
}
$('solXlsE').addEventListener('click', e => excelPendientes('ESCRITORIO', e.currentTarget));
$('solXlsL').addEventListener('click', e => excelPendientes('LIMPIEZA', e.currentTarget));


// Atender: cada línea se enlaza con un material del kardex y se registra la salida.
// Si la sucursal pidió escritorio y limpieza en el mismo envío, se atienden juntos en la misma ventana.
let SOL = null;
const lineasDe = x => (x.entrega || x.items || []).map(i => {
  const p = (i.prodId && PRODUCTOS.get(i.prodId)) || buscarProd(i.producto || i.desc);
  return { desc: i.desc, cantSol: i.cantSol ?? i.cant, unidadSol: i.unidad || '', prodId: p?.id || null, entregar: x.entrega ? i.cant : (i.cant || 0), cu: i.cu, obs: i.obs || '', nuevo: !!i.nuevo };
});
// La otra mitad del mismo pedido: misma sucursal, fecha y solicitante, el otro tipo y número correlativo seguido
const parejaDe = x => SOLS.lista.find(y => y.id !== x.id && y.estado === x.estado && String(y.centro) === String(x.centro) && y.fecha === x.fecha
  && y.solicitante === x.solicitante && tipoSolTxt(y) !== tipoSolTxt(x) && Math.abs((y.numero || 0) - (x.numero || 0)) === 1);
const nums = l => l.map(p => p.x.numero).join(' y ');
function abrirSolicitud(x) {
  if (!x) return;
  const editable = x.estado === 'PENDIENTE' && puede('kardex');
  const xs = [x, parejaDe(x)].filter(Boolean).sort((a, b) => (tipoSolTxt(a) === 'ESCRITORIO' ? 0 : 1) - (tipoSolTxt(b) === 'ESCRITORIO' ? 0 : 1));
  SOL = { editable, partes: xs.map(y => ({ x: y, lineas: lineasDe(y) })) };
  SOL.x = SOL.partes[0].x; // compatibilidad
  const dos = SOL.partes.length > 1;
  $('solTit').textContent = `${dos ? 'Solicitudes' : 'Solicitud'} N.º ${nums(SOL.partes)} · ${dos ? 'Escritorio y limpieza' : tipoSolTxt(x) === 'LIMPIEZA' ? 'Limpieza' : 'Escritorio'} · ${x.centroNombre || x.centro}`;
  $('solInfo').innerHTML = `Solicitado por <b>${esc(x.solicitante)}</b> el ${fmtF(x.fecha)} · Estado: <b>${esc(estSol(x.estado))}</b>${dos ? ' · <b>Escritorio y limpieza del mismo pedido: se atienden juntos</b>' : ''}`
    + SOL.partes.map(p => (p.x.nota ? ` · Comentario: “${esc(p.x.nota)}”` : '') + (p.x.motivo ? ` · Motivo${dos ? ' N.º ' + p.x.numero : ''}: ${esc(p.x.motivo)}` : '')).filter((t, i, a) => a.indexOf(t) === i).join('')
    + (x.atendidoPor ? ` · Registró: ${esc(x.atendidoPor)}` : '');
  $('solFEnt').value = x.fechaEntrega || hoyISO(); $('solEntPor').value = x.entregadoPor || YO.nombre; $('solRecPor').value = x.recibidoPor || x.solicitante || '';
  ['solFEnt', 'solEntPor', 'solRecPor'].forEach(id => { $(id).disabled = !editable; });
  $('solEntregar').hidden = $('solRechazar').hidden = !editable;
  $('solMsg').textContent = '';
  pintarLineasSol();
  cargarPersonalSilencioso();
  $('dSol').showModal();
}
function pintarLineasSol() {
  const dis = SOL.editable ? '' : ' disabled'; let tot = 0;
  const dos = SOL.partes.length > 1;
  $('solItems').innerHTML = SOL.partes.map((parte, pi) => {
    let sub = 0;
    const filas = parte.lineas.map((l, i) => {
      const p = l.prodId ? PRODUCTOS.get(l.prodId) : null, cu = SOL.editable ? (p?.cProm || 0) : (l.cu || 0), ct = r2(cu * (Number(l.entregar) || 0)); sub += ct;
      // stock que queda contando lo que ya se entrega del mismo material en otras líneas
      const usado = SOL.partes.flatMap(q => q.lineas).filter(o => o !== l && o.prodId && o.prodId === l.prodId).reduce((a, o) => a + (Number(o.entregar) || 0), 0);
      const falta = SOL.editable && p && Number(l.entregar) + usado > p.stock + 1e-9;
      const no = !(Number(l.entregar) > 0), parcial = !no && Number(l.entregar) < Number(l.cantSol);
      const id = `${pi}-${i}`;
      return `<tr data-i="${id}" class="${no ? 'sol-no' : parcial ? 'sol-parcial' : ''}"><td class="c">${i + 1}</td><td>${esc(l.desc)}${l.nuevo ? '<br><span class="pill AJUSTE">MATERIAL NUEVO</span>' : ''}</td><td class="num">${nq(l.cantSol)} <small class="nota">${esc(l.unidadSol)}</small></td>
        <td><input data-f="prod" data-bp autocomplete="off" value="${p ? esc(etiquetaProd(p)) : ''}" placeholder="Escribe para buscar el material"${dis} aria-label="Material del kardex para la línea ${i + 1}" style="min-width:240px"></td>
        <td class="num"${falta ? ' style="color:var(--rojo);font-weight:bold" title="No alcanza el stock"' : ''}>${p ? nq(p.stock) + ' ' + esc(p.unidad) : '—'}</td>
        <td class="num"><input class="w6 num" type="number" min="0" step="any" data-f="cant" value="${l.entregar}"${dis} aria-label="Cantidad a entregar en la línea ${i + 1}"></td>
        <td>${SOL.editable ? `<input data-f="obs" list="dlObs" maxlength="120" value="${esc(l.obs || '')}" class="${no && !limpio(l.obs) ? 'obs-req' : ''}" placeholder="${no ? '¿Por qué no se entrega?' : parcial ? '¿Por qué se entrega menos?' : 'Opcional'}" aria-label="Observación de la línea ${i + 1}" style="min-width:190px">`
          : (l.obs ? `<span class="obs-txt">${esc(l.obs)}</span>` : (no ? '<span class="obs-txt">No atendido</span>' : ''))}</td>
        <td class="num">${n2(cu)}</td><td class="num">${n2(ct)}</td></tr>`;
    }).join('');
    tot += sub;
    const lim = tipoSolTxt(parte.x) === 'LIMPIEZA';
    const cab = dos ? `<tr class="sol-sec ${lim ? 'lim' : 'esc'}"><td colspan="8">${lim ? '🧽 Materiales de limpieza' : '✏️ Útiles de escritorio'} · Solicitud N.º ${parte.x.numero}</td><td class="num">${n2(sub)}</td></tr>` : '';
    return cab + filas;
  }).join('');
  $('solTotal').textContent = n2(tot);
}
const lineaSol = tr => { const [pi, i] = tr.dataset.i.split('-').map(Number); return SOL.partes[pi].lineas[i]; };
$('solItems').addEventListener('change', e => {
  const tr = e.target.closest('tr[data-i]'); if (!tr || !SOL?.editable) return;
  const l = lineaSol(tr);
  if (e.target.dataset.f === 'prod') { const p = buscarProd(e.target.value); l.prodId = p?.id || null; if (e.target.value && !p) toast('Elige un material de la lista del kardex.', true); }
  if (e.target.dataset.f === 'obs') { l.obs = limpio(e.target.value).toUpperCase(); e.target.value = l.obs; e.target.classList.toggle('obs-req', !(Number(l.entregar) > 0) && !l.obs); return; }
  if (e.target.dataset.f === 'cant') {
    l.entregar = r4(Math.max(0, num(e.target.value)));
    const p = l.prodId ? PRODUCTOS.get(l.prodId) : null;
    if (!(l.entregar > 0) && !l.obs && (!p || !(p.stock > 0))) l.obs = 'SIN STOCK'; // sugerencia automática
  }
  pintarLineasSol();
  if (e.target.dataset.f === 'cant') { const o = $('solItems').querySelector(`tr[data-i="${tr.dataset.i}"] [data-f="obs"]`); if (o && !(l.entregar > 0) && !l.obs) o.focus(); }
});
$('solItems').addEventListener('input', e => { if (e.target.dataset.f === 'obs' && SOL?.editable) { const l = lineaSol(e.target.closest('tr')); l.obs = limpio(e.target.value).toUpperCase(); } });
$('solCerrar').addEventListener('click', () => $('dSol').close());
$('solImprimir').addEventListener('click', () => {
  if (!SOL) return;
  if (SOL.partes.length === 1) return imprimirSolicitud(SOL.x, SOL.editable ? SOL.partes[0] : null);
  // los dos del mismo pedido en una sola hoja (escritorio arriba, limpieza abajo)
  const l = SOL.partes.map(({ x, lineas }) => !SOL.editable ? x : {
    ...x, fechaEntrega: $('solFEnt').value, entregadoPor: limpio($('solEntPor').value), recibidoPor: limpio($('solRecPor').value),
    entrega: lineas.map(li => { const p = li.prodId ? PRODUCTOS.get(li.prodId) : null, cu = p?.cProm || 0, cant = Number(li.entregar) || 0; return { codigo: p?.codigo || '', cant, unidad: p?.unidad || li.unidadSol, producto: p?.nombre || li.desc, desc: li.desc, cu, ct: r2(cu * cant), obs: li.obs, cantSol: li.cantSol }; })
  });
  imprimirSucursalUnaHoja(SOL.x.centroNombre || SOL.x.centro, l);
});
$('solRechazar').addEventListener('click', async e => {
  const dos = SOL.partes.length > 1;
  const motivo = prompt(`Motivo del rechazo${dos ? ` (se rechazan las solicitudes N.º ${nums(SOL.partes)})` : ''} (la sucursal lo verá):`); if (motivo === null) return;
  const b = e.currentTarget; ocupado(b, true);
  try {
    const lote = writeBatch(db);
    SOL.partes.forEach(p => lote.update(doc(db, 'solicitudes', p.x.id), { estado: 'RECHAZADA', motivo: limpio(motivo), atendidoPor: YO.nombre, atendidoMs: Date.now() }));
    await lote.commit();
    $('dSol').close(); toast(dos ? `Solicitudes N.º ${nums(SOL.partes)} rechazadas.` : 'Solicitud rechazada.'); cargarSolicitudes();
  } catch (err) { $('solMsg').textContent = errorTexto(err); }
  ocupado(b, false);
});
$('fSolAt').addEventListener('submit', async e => {
  e.preventDefault(); if (!SOL?.editable) return;
  const fecha = $('solFEnt').value, recibe = limpio($('solRecPor').value).toUpperCase(), entrega = limpio($('solEntPor').value).toUpperCase();
  const msg = t => { $('solMsg').textContent = t; };
  if (!fecha) return msg('Falta la fecha de entrega.');
  if (!recibe) return msg('Escribe quién recibe.');
  const dos = SOL.partes.length > 1, nombreParte = p => dos ? (tipoSolTxt(p.x) === 'LIMPIEZA' ? 'limpieza' : 'escritorio') + ' ' : '';
  const partes = SOL.partes.map(p => ({ x: p.x, lineas: p.lineas.map(l => ({ ...l, entregar: r4(Number(l.entregar) || 0) })) }));
  const todas = partes.flatMap(p => p.lineas);
  if (todas.some(l => l.entregar > 0 && !l.prodId)) return msg('Hay materiales a entregar sin elegir su material del kardex (o pon 0 si no se entrega).');
  if (!todas.some(l => l.entregar > 0)) return msg('No hay nada para entregar. Si no se atenderá, usa “Rechazar”.');
  const sinObs = partes.flatMap(p => p.lineas.map((l, i) => !(l.entregar > 0) && !limpio(l.obs) ? nombreParte(p) + (i + 1) : '')).filter(Boolean);
  if (sinObs.length) { pintarLineasSol(); return msg(`Escribe la observación de lo que no se entrega (línea${sinObs.length > 1 ? 's' : ''} ${sinObs.join(', ')}). Por ejemplo: SIN STOCK.`); }
  const b = $('solEntregar'); ocupado(b, true, 'Registrando…'); msg('');
  try {
    await runTransaction(db, async tx => {
      const refs = partes.map(p => doc(db, 'solicitudes', p.x.id));
      for (const r of refs) { const s = await tx.get(r); if (!s.exists() || s.data().estado !== 'PENDIENTE') throw new Error('Una de las solicitudes ya fue atendida o rechazada por otra persona.'); }
      const est = new Map();
      for (const pid of new Set(todas.filter(l => l.entregar > 0).map(l => l.prodId))) { const ps = await tx.get(doc(db, 'productos', pid)); if (!ps.exists()) throw new Error('Un material ya no existe en el kardex.'); est.set(pid, ps.data()); }
      let ms = Date.now();
      partes.forEach((parte, k) => {
        const x = parte.x; let total = 0;
        const detalle = parte.lineas.map(l => {
          const obs = limpio(l.obs).toUpperCase();
          if (!(l.entregar > 0)) return { desc: l.desc, cantSol: l.cantSol, prodId: l.prodId, codigo: '', producto: '', unidad: l.unidadSol, cant: 0, cu: 0, ct: 0, obs };
          const p = est.get(l.prodId);
          if (l.entregar > p.stock + 1e-9) throw new Error(`Stock insuficiente de ${p.nombre}: hay ${nq(p.stock)} ${p.unidad}.`);
          const cu = p.cProm || 0, ct = r2(l.entregar * cu);
          p.stock = r4(p.stock - l.entregar); p.valor = p.stock <= 1e-9 ? 0 : r2(p.valor - ct); p.cProm = p.stock > 0 ? r4(p.valor / p.stock) : 0; total += ct;
          tx.set(doc(collection(db, 'movimientos')), {
            productoId: l.prodId, codigo: p.codigo, producto: p.nombre, unidad: p.unidad, fecha, ms: ms++, tipo: 'SALIDA', origen: 'CONSUMO',
            documento: `Solicitud N.º ${x.numero}`, solicitudId: x.id, tercero: x.centro, persona: recibe, ...(obs ? { obs } : {}), cantSol: l.cantSol,
            cant: l.entregar, cu, ct, saldoCant: p.stock, cProm: p.cProm, saldoValor: p.valor, usuario: YO.nombre, uid: YO.uid, creado: serverTimestamp()
          });
          return { desc: l.desc, cantSol: l.cantSol, prodId: l.prodId, codigo: p.codigo, producto: p.nombre, unidad: p.unidad, cant: l.entregar, cu, ct, obs };
        });
        tx.update(refs[k], { estado: 'ATENDIDA', fechaEntrega: fecha, entregadoPor: entrega, recibidoPor: recibe, entrega: detalle, totalCosto: r2(total), atendidoPor: YO.nombre, atendidoMs: Date.now() });
      });
      for (const [pid, p] of est) tx.update(doc(db, 'productos', pid), { stock: p.stock, valor: p.valor, cProm: p.cProm, actMs: Date.now(), ultMov: fecha });
    });
    $('dSol').close(); toast(`${dos ? 'Solicitudes' : 'Solicitud'} N.º ${nums(partes)} ${dos ? 'entregadas' : 'entregada'} y descontada${dos ? 's' : ''} del kardex.`); cargarSolicitudes();
  } catch (err) { msg(errorTexto(err)); }
  ocupado(b, false);
});

// Formato impreso como el de papel: "Formato de consumo de materiales de escritorio"
function htmlFormato(x, borrador) {
  const filas = borrador ? borrador.lineas.map(l => { const p = l.prodId ? PRODUCTOS.get(l.prodId) : null, cu = p?.cProm || 0; return { codigo: p?.codigo || '', cant: l.entregar, unidad: p?.unidad || l.unidadSol, desc: p?.nombre || l.desc, cu, ct: r2(cu * l.entregar), obs: l.obs, pedido: l.desc, cantSol: l.cantSol }; })
    : x.entrega ? x.entrega.map(i => ({ codigo: i.codigo, cant: i.cant, unidad: i.unidad, desc: i.producto || i.desc, cu: i.cu, ct: i.ct, pedido: i.desc, cantSol: i.cantSol, obs: i.obs }))
      : (x.items || []).map(i => ({ codigo: i.codigo, cant: i.cant, unidad: i.unidad, desc: i.desc, cu: null, ct: null }));
  const tot = filas.reduce((a, f) => a + (f.ct || 0), 0);
  return `<section class="hoja">
    <div class="cab"><h1>FORMATO DE CONSUMO DE MATERIALES DE ${tipoSolTxt(x)}</h1><img src="${esc(new URL('logo.png', location.href).href)}" alt=""></div>
    <div class="datos">
      <div>Fecha de solicitud <b>${fmtF(x.fecha)}</b></div><div>N.º correlativo <b>${x.numero}</b></div>
      <div>Fecha de entrega <b>${fmtF(borrador ? $('solFEnt').value : x.fechaEntrega) || '&nbsp;'}</b></div><div>Centro de costo <b>${esc(x.centroNombre || x.centro)}</b></div>
    </div>
    <table><thead><tr><th>Código</th><th>Cantidad</th><th>Descripción</th><th>Costo unitario</th><th>Costo total</th></tr></thead><tbody>
    ${filas.map(f => `<tr><td>${esc(f.codigo || '')}</td><td>${f.cant ? nq(f.cant) + ' ' + esc(f.unidad || '') : (x.entrega || borrador ? '<b class="noat">NO ATENDIDO</b>' : '')}</td><td>${esc(f.desc)}${f.pedido && f.pedido !== f.desc ? `<br><span class="nota">Pidió: ${esc(f.pedido)} (${nq(f.cantSol)})</span>` : ''}${(x.entrega || borrador) && f.cant && f.cantSol && f.cant < f.cantSol ? `<br><span class="nota">Pidió ${nq(f.cantSol)}; se entregó ${nq(f.cant)}</span>` : ''}${f.obs ? `<br><span class="obs">Obs.: ${esc(f.obs)}</span>` : ''}</td><td class="n">${f.cu === null ? '' : n2(f.cu)}</td><td class="n">${f.ct === null ? '' : n2(f.ct)}</td></tr>`).join('')}
    ${Array.from({ length: Math.max(0, 8 - filas.length) }, () => '<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td></tr>').join('')}
    </tbody>${x.entrega || borrador ? `<tfoot><tr><td colspan="4" class="n">TOTAL S/</td><td class="n">${n2(tot)}</td></tr></tfoot>` : ''}</table>
    <p class="nota">Solicitado por: ${esc(x.solicitante)}${x.nota ? ' · ' + esc(x.nota) : ''}</p>
    <div class="firmas"><div>Entregado por: ${esc(borrador ? limpio($('solEntPor').value) : x.entregadoPor || '')}</div><div>Recibido por: ${esc(borrador ? limpio($('solRecPor').value) : x.recibidoPor || '')}</div></div>
  </section>`;
}
function abrirImpresion(titulo, hojas) {
  const w = window.open('', '_blank'); if (!w) return toast('El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.', true);
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>
    body{font-family:Arial,Helvetica,sans-serif;color:#222;margin:28px;font-size:13px}
    .hoja+.hoja{page-break-before:always;break-before:page;margin-top:40px}
    .cab{display:flex;justify-content:space-between;align-items:center}.cab img{width:70px}
    h1{font-size:17px;text-decoration:underline;margin:0}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;margin:18px 0}
    .datos div{display:flex;gap:8px;align-items:center}.datos b{border:1.5px solid #222;padding:4px 10px;min-width:120px;display:inline-block}
    table{width:100%;border-collapse:collapse;margin-top:6px}th,td{border:1.5px solid #222;padding:6px 8px}th{background:#e8e8e8}
    td.n{text-align:right}tfoot td{font-weight:bold}
    .firmas{display:flex;justify-content:space-between;margin-top:60px}.firmas div{width:40%;text-align:center;border-top:1.5px solid #222;padding-top:6px}
    .nota{color:#666;font-size:11px}
    .obs{color:#b3261e;font-size:11px;font-weight:bold}.noat{color:#b3261e}
    @media print{body{margin:10mm}.hoja+.hoja{margin-top:0}}
  </style></head><body>${hojas.join('')}
    <script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}
// Imprimir por sucursal en UNA sola hoja A4: útiles de escritorio en la mitad de arriba y limpieza en la de abajo.
// Si hay muchos materiales, la letra se achica sola y, si hace falta, la tabla pasa a dos columnas para que siempre entre.
function filasImpresion(x) {
  return x.entrega ? x.entrega.map(i => ({ codigo: i.codigo, cant: i.cant, unidad: i.unidad, desc: i.producto || i.desc, cu: i.cant > 0 ? i.cu : null, ct: i.cant > 0 ? i.ct : null, obs: i.obs, cantSol: i.cantSol }))
    : (x.items || []).map(i => ({ codigo: i.codigo, cant: i.cant, unidad: i.unidad, desc: i.desc, cu: null, ct: null }));
}
function htmlMedia(tipo, l, nombreSuc) {
  const tit = `FORMATO DE CONSUMO DE MATERIALES DE ${tipo}`;
  if (!l.length) return `<section class="media vacia"><div class="cab"><h1>${tit}</h1></div><p class="sin">${esc(nombreSuc)} no tiene solicitudes de ${tipo === 'LIMPIEZA' ? 'materiales de limpieza' : 'útiles de escritorio'} en este estado.</p></section>`;
  const unicos = v => [...new Set(v.filter(Boolean))];
  const filas = l.flatMap(filasImpresion), conCosto = l.some(x => x.entrega), tot = filas.reduce((a, f) => a + (f.ct || 0), 0);
  const tabla = fs => `<table><thead><tr><th>Código</th><th>Cantidad</th><th>Descripción</th>${conCosto ? '<th>C. unit.</th><th>C. total</th>' : ''}</tr></thead><tbody>${fs.map(f => `<tr><td>${esc(f.codigo || '')}</td><td class="nw">${f.cant > 0 ? nq(f.cant) + ' ' + esc(f.unidad || '') : '<b class="noat">NO ATENDIDO</b>'}</td><td>${esc(f.desc)}${f.cant > 0 && f.cantSol && f.cant < f.cantSol ? ` <span class="nota">(pidió ${nq(f.cantSol)})</span>` : ''}${f.obs ? `<br><span class="obs">Obs.: ${esc(f.obs)}</span>` : ''}</td>${conCosto ? `<td class="n">${f.cu === null ? '' : n2(f.cu)}</td><td class="n">${f.ct === null ? '' : n2(f.ct)}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  const mitad = Math.ceil(filas.length / 2);
  return `<section class="media">
    <div class="cab"><h1>${tit}</h1><img src="${esc(new URL('logo.png', location.href).href)}" alt=""></div>
    <div class="datos">
      <div>Fecha de solicitud <b>${unicos(l.map(x => fmtF(x.fecha))).join(', ')}</b></div><div>N.º correlativo <b>${unicos(l.flatMap(x => String(x.numero).split(', ')).filter(n => n !== '—')).join(', ') || '—'}</b></div>
      <div>Fecha de entrega <b>${unicos(l.map(x => fmtF(x.fechaEntrega))).join(', ') || '&nbsp;'}</b></div><div>Centro de costo <b>${esc(nombreSuc)}</b></div>
    </div>
    <div class="una">${tabla(filas)}</div>
    <div class="dos" hidden><div>${tabla(filas.slice(0, mitad))}</div><div>${tabla(filas.slice(mitad))}</div></div>
    ${conCosto ? `<p class="tot">TOTAL S/ ${n2(tot)}</p>` : ''}
    <p class="nota">Solicitado por: ${esc(unicos(l.flatMap(x => String(x.solicitante || '').split(', '))).join(', '))}${unicos(l.map(x => x.nota)).length ? ' · ' + esc(unicos(l.map(x => x.nota)).join(' · ')) : ''}</p>
    <div class="firmas"><div>Entregado por: ${esc(unicos(l.flatMap(x => String(x.entregadoPor || '').split(', '))).join(', '))}</div><div>Recibido por: ${esc(unicos(l.flatMap(x => String(x.recibidoPor || '').split(', '))).join(', '))}</div></div>
  </section>`;
}
function imprimirSucursalUnaHoja(nombreSuc, l) {
  const de = t => l.filter(x => tipoSolTxt(x) === t).sort((a, b) => a.numero - b.numero);
  const w = window.open('', '_blank'); if (!w) return toast('El navegador bloqueó la ventana. Permite las ventanas emergentes para imprimir.', true);
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Sucursal ${esc(nombreSuc)}</title><style>
    @page{size:A4 portrait;margin:8mm}
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;color:#222;width:194mm;margin:0 auto}
    .hoja{height:279mm;display:flex;flex-direction:column}
    .media{height:139mm;overflow:hidden;padding:2mm 1mm;display:flex;flex-direction:column;gap:1.6mm;font-size:11px}
    .media+.media{border-top:1.5px dashed #888;padding-top:3mm}
    .cab{display:flex;justify-content:space-between;align-items:center}.cab img{height:9mm}
    h1{font-size:1.3em;text-decoration:underline;margin:0}
    .datos{display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm}
    .datos div{display:flex;gap:2mm;align-items:center}.datos b{border:1.2px solid #222;padding:.5mm 2mm;flex:1}
    table{width:100%;border-collapse:collapse}th,td{border:1px solid #222;padding:.35em .6em;vertical-align:top}th{background:#e8e8e8}
    td.n{text-align:right}td.nw{white-space:nowrap}
    .dos{display:grid;grid-template-columns:1fr 1fr;gap:2mm}.dos[hidden],.una[hidden]{display:none}
    .tot{margin:0;text-align:right;font-weight:bold}
    .nota{color:#555;font-size:.85em;margin:0}
    .obs{color:#b3261e;font-size:.9em;font-weight:bold}.noat{color:#b3261e;font-size:.9em}
    .firmas{display:flex;justify-content:space-between;margin-top:auto;padding-top:7mm}.firmas div{width:42%;text-align:center;border-top:1.2px solid #222;padding-top:1mm;font-size:.9em}
    .sin{color:#777;font-style:italic;margin:6mm 0}
  </style></head><body><div class="hoja">${htmlMedia('ESCRITORIO', de('ESCRITORIO'), nombreSuc)}${htmlMedia('LIMPIEZA', de('LIMPIEZA'), nombreSuc)}</div>
    <script>
      // achica la letra de cada mitad hasta que entre; si no alcanza, pasa la tabla a dos columnas
      function cabe(m) { return m.scrollHeight <= m.clientHeight + 1; }
      document.querySelectorAll('.media:not(.vacia)').forEach(function (m) {
        var t = 11; m.style.fontSize = t + 'px';
        while (!cabe(m) && t > 7.5) { t -= 0.5; m.style.fontSize = t + 'px'; }
        if (!cabe(m)) { m.querySelector('.una').hidden = true; m.querySelector('.dos').hidden = false; t = 10; m.style.fontSize = t + 'px'; while (!cabe(m) && t > 4.5) { t -= 0.5; m.style.fontSize = t + 'px'; } }
      });
      window.onload = function () { window.print(); };
    <\/script></body></html>`);
  w.document.close();
}
function imprimirSolicitud(x, borrador) { if (x) abrirImpresion(`Solicitud N.º ${x.numero}`, [htmlFormato(x, borrador)]); }

/* ================= Toma de inventario: cuadrar el kardex con el conteo físico ================= */
// El conteo escrito se guarda en este navegador para poder seguir otro día; al registrar se crean ajustes AJUSTE+ / AJUSTE-
const INV = { conteo: {}, costo: {}, ultCu: {} };
try { const g = JSON.parse(localStorage.getItem('inv-conteo') || '{}') || {}; if (g.conteo) { INV.conteo = g.conteo; INV.costo = g.costo || {}; } else INV.conteo = g; } catch (e) { }
const guardarConteo = () => { try { localStorage.setItem('inv-conteo', JSON.stringify({ conteo: INV.conteo, costo: INV.costo })); } catch (e) { } };
// si solo se escribió el precio (sin conteo), se toma como conteo el stock del sistema
const contInv = p => INV.conteo[p.id] !== undefined ? INV.conteo[p.id] : INV.costo[p.id] !== undefined ? r4(p.stock || 0) : undefined;
const difInv = p => contInv(p) === undefined ? null : r4(contInv(p) - (p.stock || 0));
// Costo que se usará: el escrito; si no, el costo promedio actual; si está en 0, el de la última compra
const costoBase = p => r4(p.cProm || INV.ultCu[p.id] || 0);
const costoInv = p => INV.costo[p.id] !== undefined ? INV.costo[p.id] : costoBase(p);
const cambiaCosto = p => INV.costo[p.id] !== undefined && Math.abs(INV.costo[p.id] - (p.cProm || 0)) > 1e-4;
// el material entra al cuadre si tiene diferencia de cantidad o un precio nuevo
const ajustaInv = p => contInv(p) !== undefined && (Math.abs(difInv(p)) > 1e-9 || (cambiaCosto(p) && contInv(p) > 0));
const valorDifInv = p => { const c = contInv(p); if (c === undefined) return 0; return r2(c * costoInv(p) - (p.valor || 0)); };
async function cargarUltimosCostos() { // último costo de entrada de los materiales sin costo promedio
  const sin = [...PRODUCTOS.values()].filter(p => !(p.cProm > 0) && INV.ultCu[p.id] === undefined);
  for (const p of sin) {
    try {
      const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', p.id)));
      const ent = ordenarMovs(s.docs.map(x => x.data())).filter(m => esEntrada(m) && m.cu > 0).pop();
      INV.ultCu[p.id] = r4(ent?.cu || 0);
    } catch (e) { INV.ultCu[p.id] = 0; }
  }
  if (sin.length && modActual === 'inventario' && !$('invFilas').contains(document.activeElement)) pintarInventario();
}
function abrirInventario() {
  const cats = [...new Set([...PRODUCTOS.values()].map(p => p.categoria || 'SIN CATEGORÍA'))].sort();
  const ant = $('invCat').value;
  $('invCat').innerHTML = '<option value="">Todas</option>' + cats.map(c => `<option>${esc(c)}</option>`).join('');
  $('invCat').value = cats.includes(ant) ? ant : '';
  if (!$('invFecha').value) $('invFecha').value = hoyISO();
  pintarInventario();
  cargarUltimosCostos();
}
function filtrarInventario() {
  const cat = $('invCat').value, ver = $('invVer').value, q = norm($('invQ').value);
  return [...PRODUCTOS.values()].filter(p => (!cat || (p.categoria || 'SIN CATEGORÍA') === cat) && (!q || norm(p.codigo + ' ' + p.nombre).includes(q))
    && (!ver || (ver === 'DIF' ? ajustaInv(p) : ver === 'CONT' ? INV.conteo[p.id] !== undefined : INV.conteo[p.id] === undefined)))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
}
function resumenInventario() {
  const todos = [...PRODUCTOS.values()], cont = todos.filter(p => INV.conteo[p.id] !== undefined), aj = todos.filter(ajustaInv);
  const val = aj.reduce((a, p) => a + valorDifInv(p), 0);
  $('invRes').innerHTML = `<span>Contados: <b>${cont.length}</b> de ${todos.length}</span><span>Con diferencia: <b style="color:${aj.length ? 'var(--rojo)' : 'var(--ok)'}">${aj.filter(p => Math.abs(difInv(p)) > 1e-9).length}</b></span><span>Sobrantes: <b>${aj.filter(p => difInv(p) > 0).length}</b> · Faltantes: <b>${aj.filter(p => difInv(p) < 0).length}</b></span><span>Con precio nuevo: <b>${todos.filter(cambiaCosto).length}</b></span><span>Valor de la diferencia: <b>S/ ${n2(val)}</b></span>`;
}
const celDif = d => d === null ? '' : `<b style="color:${Math.abs(d) < 1e-9 ? 'var(--ok)' : d < 0 ? 'var(--rojo)' : 'var(--ambar)'}">${Math.abs(d) < 1e-9 ? 'OK' : (d > 0 ? '+' : '') + nq(d)}</b>`;
const claseInv = p => { const d = difInv(p); return d && Math.abs(d) > 1e-9 ? (d < 0 ? 'sol-no' : 'sol-parcial') : ''; };
function pintarInventario() {
  const l = filtrarInventario();
  $('invFilas').innerHTML = l.length ? l.map(p => {
    const c = INV.conteo[p.id], cu = INV.costo[p.id], base = costoBase(p);
    return `<tr data-pid="${esc(p.id)}" class="${claseInv(p)}"><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}<span class="sub">${esc(p.unidad)}${p.categoria ? ' · ' + esc(p.categoria) : ''}</span></td>
      <td class="num">${nq(p.stock)}</td>
      <td class="num"><input class="w6 num" type="number" min="0" step="any" inputmode="decimal" data-inv="${esc(p.id)}" value="${c === undefined ? '' : c}" placeholder="—" aria-label="Conteo físico de ${esc(p.nombre)}" style="max-width:110px"></td>
      <td class="num" data-c="dif">${celDif(difInv(p))}</td>
      <td class="num">${n2(p.cProm)}${!(p.cProm > 0) && INV.ultCu[p.id] > 0 ? `<span class="sub">últ. compra ${n2(INV.ultCu[p.id])}</span>` : ''}</td>
      <td class="num"><input class="w6 num" type="number" min="0" step="any" inputmode="decimal" data-invc="${esc(p.id)}" value="${cu === undefined ? '' : cu}" placeholder="${n2(base)}" title="Vacío = se usa ${n2(base)}" aria-label="Costo unitario nuevo de ${esc(p.nombre)}" style="max-width:110px"></td>
      <td class="num" data-c="val">${!ajustaInv(p) ? '' : n2(valorDifInv(p))}</td></tr>`;
  }).join('') : '<tr><td colspan="8" class="vacio">No hay materiales con este filtro.</td></tr>';
  resumenInventario();
}
['invCat', 'invVer'].forEach(id => $(id).addEventListener('change', pintarInventario));
$('invQ').addEventListener('input', pintarInventario);
// escribir el conteo o el costo: actualiza esa fila sin repintar toda la tabla
$('invFilas').addEventListener('input', e => {
  const i = e.target.closest('[data-inv],[data-invc]'); if (!i) return;
  const p = PRODUCTOS.get(i.dataset.inv || i.dataset.invc); if (!p) return;
  const mapa = i.dataset.inv ? INV.conteo : INV.costo;
  if (i.value === '') delete mapa[p.id]; else mapa[p.id] = r4(Math.max(0, num(i.value)));
  guardarConteo();
  const tr = i.closest('tr');
  tr.className = claseInv(p);
  tr.querySelector('[data-c="dif"]').innerHTML = celDif(difInv(p));
  tr.querySelector('[data-c="val"]').textContent = !ajustaInv(p) ? '' : n2(valorDifInv(p));
  resumenInventario();
});
// ↑ ↓ y Enter pasan a la misma columna de la fila de arriba o de abajo, como en Excel
$('invFilas').addEventListener('keydown', e => {
  const i = e.target.closest('[data-inv],[data-invc]'); if (!i || !['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
  e.preventDefault();
  const sel = i.dataset.inv ? '[data-inv]' : '[data-invc]';
  const tods = [...$('invFilas').querySelectorAll(sel)], k = tods.indexOf(i) + (e.key === 'ArrowUp' ? -1 : 1);
  if (tods[k]) { tods[k].focus(); tods[k].select(); }
});
$('invLimpiar').addEventListener('click', () => {
  if (!Object.keys(INV.conteo).length && !Object.keys(INV.costo).length) return toast('No hay conteo escrito.');
  if (!confirm('¿Borrar todo el conteo y los precios escritos? (no cambia el kardex)')) return;
  INV.conteo = {}; INV.costo = {}; guardarConteo(); pintarInventario();
});
// Excel para contar a mano en el almacén y luego subirlo (con precio opcional)
$('invXls').addEventListener('click', async e => {
  const b = e.currentTarget; ocupado(b, true, 'Preparando…');
  try {
    const X = await libroXlsx(), l = filtrarInventario();
    const filas = [[`TOMA DE INVENTARIO · ${fmtF($('invFecha').value || hoyISO())}`], ['Escribe lo que cuentas en “Conteo físico”. “Costo unitario nuevo” es opcional: si lo dejas vacío se usa el costo actual (o el de la última compra). No cambies la columna Código.'], [],
      ['Código', 'Material', 'Unidad', 'Categoría', 'Stock sistema', 'Conteo físico', 'Costo actual', 'Costo unitario nuevo', 'Observación']];
    l.forEach(p => filas.push([p.codigo, p.nombre, p.unidad, p.categoria || '', p.stock, INV.conteo[p.id] ?? '', costoBase(p), INV.costo[p.id] ?? '', '']));
    const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, hojaXlsx(X, filas, [10, 42, 10, 22, 13, 14, 13, 20, 30]), 'Conteo');
    X.writeFile(wb, `toma_inventario_${$('invFecha').value || hoyISO()}.xlsx`);
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});
$('invSubir').addEventListener('click', () => $('invFile').click());
$('invFile').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try {
    const X = await libroXlsx(), wb = X.read(await f.arrayBuffer(), { type: 'array' });
    const filas = X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null });
    const h = filas.findIndex(r => (r || []).some(v => norm(v) === 'codigo') && (r || []).some(v => /conteo/.test(norm(v))));
    if (h < 0) throw new Error('No encontré las columnas “Código” y “Conteo físico”.');
    const cab = filas[h].map(norm);
    const cCod = cab.findIndex(v => v === 'codigo'), cCon = cab.findIndex(v => /conteo/.test(v));
    const cCu = cab.findIndex(v => /costo/.test(v) && /nuevo|unitario/.test(v) && !/actual/.test(v)); // columna de precio (opcional)
    const porCod = new Map([...PRODUCTOS.values()].map(p => [norm(p.codigo), p]));
    let n = 0, nc = 0, noEnc = 0;
    filas.slice(h + 1).forEach(r => {
      const cod = norm((r || [])[cCod]); if (!cod) return;
      const p = porCod.get(cod), v = (r || [])[cCon], cu = cCu >= 0 ? (r || [])[cCu] : null;
      if ((v === null || v === '') && (cu === null || cu === '')) return;
      if (!p) { noEnc++; return; }
      if (v !== null && v !== '') { INV.conteo[p.id] = r4(Math.max(0, num(v))); n++; }
      if (cu !== null && cu !== '') { INV.costo[p.id] = r4(Math.max(0, num(cu))); nc++; }
    });
    guardarConteo(); pintarInventario();
    toast(`Conteo cargado: ${n} materiales${nc ? ` y ${nc} precios` : ''}.${noEnc ? ` ${noEnc} códigos no existen en el kardex.` : ''}`);
  } catch (err) { toast('No se pudo leer el Excel: ' + errorTexto(err), true); }
});
// Registrar el cuadre: el stock queda igual al conteo y, si se escribió precio, valorizado a ese precio
$('invOk').addEventListener('click', async e => {
  const fecha = $('invFecha').value || hoyISO();
  const l = [...PRODUCTOS.values()].filter(ajustaInv);
  if (!l.length) return toast(Object.keys(INV.conteo).length || Object.keys(INV.costo).length ? 'Todo lo contado coincide con el sistema: no hay nada que ajustar.' : 'Primero escribe el conteo físico de los materiales.', true);
  const mas = l.filter(p => difInv(p) > 0), menos = l.filter(p => difInv(p) < 0), prec = l.filter(cambiaCosto), val = l.reduce((a, p) => a + valorDifInv(p), 0);
  const motivo = prompt(`Se ajustarán ${l.length} materiales al ${fmtF(fecha)}:\n• ${mas.length} sobrantes (ajuste +)\n• ${menos.length} faltantes (ajuste −)\n• ${prec.length} con precio nuevo\nValor de la diferencia: S/ ${n2(val)}\n\nEscribe el motivo o nombre del inventario (se verá en el kardex):`, `TOMA DE INVENTARIO ${fmtF(fecha)}`);
  if (motivo === null) return;
  const docTxt = limpio(motivo).toUpperCase() || 'TOMA DE INVENTARIO';
  const b = e.currentTarget; ocupado(b, true, 'Registrando…');
  try {
    let lote = writeBatch(db), ops = 0, ms = Date.now(), hechos = 0;
    const mov = (p, origen, cant, cu, saldoCant, saldoValor, texto) => {
      lote.set(doc(collection(db, 'movimientos')), {
        productoId: p.id, codigo: p.codigo, producto: p.nombre, unidad: p.unidad, fecha, ms: ms++, tipo: 'AJUSTE', origen,
        documento: texto, tercero: '', cant: r4(cant), cu: r4(cu), ct: r2(cant * cu),
        saldoCant: r4(saldoCant), cProm: saldoCant > 0 ? r4(saldoValor / saldoCant) : 0, saldoValor: Math.max(0, r2(saldoValor)), usuario: YO.nombre, uid: YO.uid, creado: serverTimestamp()
      });
      ops++;
    };
    for (const p of l) {
      const cont = r4(contInv(p)), stock = r4(p.stock || 0), d = r4(cont - stock);
      if (cambiaCosto(p) && cont > 0) {
        // precio nuevo: sale lo que había a su costo actual y entra lo contado al precio escrito
        const cu = INV.costo[p.id];
        if (stock > 0) mov(p, 'AJUSTE-', stock, p.cProm || 0, 0, 0, `${docTxt} · SALE A COSTO ANTERIOR`);
        mov(p, 'AJUSTE+', cont, cu, cont, cont * cu, `${docTxt} · ENTRA A S/ ${n2(cu)}`);
      } else if (d > 0) {
        const cu = costoInv(p);
        mov(p, 'AJUSTE+', d, cu, cont, (p.valor || 0) + d * cu, docTxt);
      } else {
        const cu = p.cProm || 0;
        mov(p, 'AJUSTE-', -d, cu, cont, cont <= 1e-9 ? 0 : (p.valor || 0) + d * cu, docTxt);
      }
      if (ops >= 440) { await lote.commit(); lote = writeBatch(db); ops = 0; }
      hechos++; b.textContent = `Registrando… ${hechos}/${l.length}`;
    }
    if (ops) await lote.commit();
    // recalcula cada material en orden de fecha para que saldos y costo promedio queden exactos
    let k = 0; for (const p of l) { await recalcularProducto(p.id); b.textContent = `Recalculando… ${++k}/${l.length}`; }
    l.forEach(p => { delete INV.conteo[p.id]; delete INV.costo[p.id]; }); guardarConteo();
    toast(`Cuadre registrado: ${l.length} materiales ajustados. El kardex ya coincide con el conteo.`);
    pintarInventario();
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});

// Detector de posibles duplicados: compara los nombres de los productos (sin tildes, plurales ni palabras de relleno)
const DUP_RELLENO = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'para', 'con', 'x', 'y', 'por', 'en', 'un', 'una']);
const DUP_TAMANO = /^(grande|pequeno|pequena|mediano|mediana|chico|chica|mini|jumbo|doble|simple|xl|l|m|s|delgado|delgada|grueso|gruesa|fino|fina|negro|negra|azul|rojo|roja|verde|amarillo|amarilla|blanco|blanca|color)$/;
const tokensDup = n => norm(n).replace(/[^a-z0-9.]+/g, ' ').split(' ').filter(Boolean).filter(t => !DUP_RELLENO.has(t))
  .map(t => t.length > 4 && t.endsWith('es') && !/[aeiou]es$/.test(t.slice(-3)) ? t.slice(0, -2) : t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t);
function levenshtein(a, b) {
  const m = a.length, n = b.length, d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
// devuelve { nivel: 3 alta, 2 media, 1 baja, motivo } o null
function parecidoDup(a, b) {
  const ta = tokensDup(a.nombre), tb = tokensDup(b.nombre); if (!ta.length || !tb.length) return null;
  const A = new Set(ta), B = new Set(tb), inter = [...A].filter(t => B.has(t)).length, union = new Set([...A, ...B]).size;
  const soloA = [...A].filter(t => !B.has(t)), soloB = [...B].filter(t => !A.has(t)), extra = [...soloA, ...soloB];
  const numA = soloA.filter(t => /\d/.test(t)), numB = soloB.filter(t => /\d/.test(t));
  const medidasDistintas = numA.length && numB.length; // ej. 3 OZ y 1.5 OZ
  const tamanos = extra.filter(t => DUP_TAMANO.test(t));
  if (!extra.length) return { nivel: 3, motivo: 'Mismo nombre (cambia solo la forma de escribirlo)' };
  const lev = levenshtein(ta.join(' '), tb.join(' ')), largo = Math.max(ta.join(' ').length, tb.join(' ').length), ratio = 1 - lev / largo;
  if (ratio >= 0.9 && !medidasDistintas) return { nivel: 3, motivo: 'Nombre casi igual (posible error de escritura)' };
  if (!soloA.length || !soloB.length) { // uno contiene al otro
    const mas = soloA.length ? soloA : soloB;
    if (tamanos.length) return { nivel: 2, motivo: `Uno dice además “${mas.join(' ').toUpperCase()}”: revisa si es otro tamaño o color` };
    return { nivel: 2, motivo: `Uno agrega “${mas.join(' ').toUpperCase()}” al nombre` };
  }
  if (medidasDistintas) return inter / union >= 0.5 ? { nivel: 1, motivo: 'Mismo producto con medidas distintas: probablemente son diferentes' } : null;
  if (soloA.some(t => DUP_TAMANO.test(t)) && soloB.some(t => DUP_TAMANO.test(t))) return inter / union >= 0.5 ? { nivel: 1, motivo: `Variantes distintas (${soloA.join(' ').toUpperCase()} / ${soloB.join(' ').toUpperCase()}): probablemente son diferentes` } : null;
  if (inter / union >= 0.6 || ratio >= 0.8) return { nivel: 2, motivo: 'Nombres muy parecidos' };
  return null;
}
const DUP_DESC = (() => { try { return new Set(JSON.parse(localStorage.getItem('dup-descartados') || '[]')); } catch (e) { return new Set(); } })();
const claveDup = (a, b) => [a.id, b.id].sort().join('|');
let DUP_VER_DESC = false;
function buscarDuplicados() {
  const l = [...PRODUCTOS.values()], pares = [];
  for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
    const r = parecidoDup(l[i], l[j]); if (!r) continue;
    const [a, b] = [l[i], l[j]].sort((x, y) => x.codigo.localeCompare(y.codigo)); // A = el código más antiguo
    pares.push({ a, b, ...r, desc: DUP_DESC.has(claveDup(a, b)) });
  }
  return pares.sort((x, y) => y.nivel - x.nivel || x.a.nombre.localeCompare(y.a.nombre, 'es'));
}
function pintarDuplicados() {
  const todos = buscarDuplicados(), ver = todos.filter(p => (DUP_VER_DESC || !p.desc) && ($('dupTodos').checked || p.nivel >= 2));
  const nAlta = todos.filter(p => !p.desc && p.nivel === 3).length, nMedia = todos.filter(p => !p.desc && p.nivel === 2).length;
  $('dupMsg').innerHTML = `Se revisaron <b>${PRODUCTOS.size}</b> productos. <b>${nAlta}</b> pares muy probables y <b>${nMedia}</b> para revisar. Revisa cada par: si es el mismo material, pulsa <b>Unir</b> (pasa todo el kardex al de la izquierda). Si son distintos, pulsa <b>No es duplicado</b> y no volverá a aparecer.`;
  const ficha = p => `<b>${esc(p.codigo)}</b> · ${esc(p.nombre)}<span class="sub">${esc(p.unidad)} · stock ${nq(p.stock)} · S/ ${n2(p.valor)}${p.categoria ? ' · ' + esc(p.categoria) : ''}</span>`;
  const etiq = { 3: '<span class="estado no">MUY PROBABLE</span>', 2: '<span class="estado am">REVISAR</span>', 1: '<span class="estado gr">POCO PROBABLE</span>' };
  $('dupFilas').innerHTML = ver.length ? ver.map(p => `<tr style="cursor:default"${p.desc ? ' class="anulado"' : ''}><td>${etiq[p.nivel]}<span class="sub">${esc(p.motivo)}</span>${p.a.unidad !== p.b.unidad ? '<span class="sub" style="color:var(--rojo)">Unidades distintas</span>' : ''}</td>
      <td>${ficha(p.a)}</td><td>${ficha(p.b)}</td>
      <td><div class="acciones"><button class="btn chico" type="button" data-dupunir="${esc(p.a.id)}|${esc(p.b.id)}" title="Pasa todo el kardex de ${esc(p.b.codigo)} a ${esc(p.a.codigo)}">Unir</button><button class="btn sec chico" type="button" data-dupinv="${esc(p.a.id)}|${esc(p.b.id)}" title="Unir al revés: se queda ${esc(p.b.codigo)}">⇄</button><button class="btn sec chico" type="button" data-dupno="${esc(claveDup(p.a, p.b))}">${p.desc ? 'Volver a mostrar' : 'No es duplicado'}</button></div></td></tr>`).join('')
    : '<tr><td colspan="4" class="vacio">No se encontraron productos duplicados. ✔</td></tr>';
}
$('invDup').addEventListener('click', () => { DUP_VER_DESC = false; $('dupTodos').checked = false; pintarDuplicados(); $('dDup').showModal(); });
$('dupCerrar').addEventListener('click', () => $('dDup').close());
$('dupTodos').addEventListener('change', pintarDuplicados);
$('dupOcultos').addEventListener('click', () => { DUP_VER_DESC = !DUP_VER_DESC; $('dupOcultos').textContent = DUP_VER_DESC ? 'Ocultar descartados' : 'Mostrar descartados'; pintarDuplicados(); });
$('dupFilas').addEventListener('click', e => {
  const u = e.target.closest('[data-dupunir],[data-dupinv]'), no = e.target.closest('[data-dupno]');
  if (no) {
    const k = no.dataset.dupno; if (DUP_DESC.has(k)) DUP_DESC.delete(k); else DUP_DESC.add(k);
    try { localStorage.setItem('dup-descartados', JSON.stringify([...DUP_DESC])); } catch (err) { }
    return pintarDuplicados();
  }
  if (u) {
    let [ida, idb] = (u.dataset.dupunir || u.dataset.dupinv).split('|'); if (u.dataset.dupinv) [ida, idb] = [idb, ida];
    const a = PRODUCTOS.get(ida), b = PRODUCTOS.get(idb); if (!a || !b) return;
    $('dDup').close();
    $('fUnir').reset(); $('unMsg').textContent = '';
    $('unA').value = etiquetaProd(a); $('unB').value = etiquetaProd(b); $('unA').dispatchEvent(new Event('input'));
    DUP_REABRIR = true; $('dUnir').showModal();
  }
});
let DUP_REABRIR = false; // al terminar de unir (o cancelar) se vuelve a la lista de duplicados
$('dUnir').addEventListener('close', () => { if (DUP_REABRIR) { DUP_REABRIR = false; setTimeout(() => { pintarDuplicados(); $('dDup').showModal(); }, 300); } });

// Unir productos duplicados: todo el kardex del duplicado pasa al que se queda
$('invUnir').addEventListener('click', () => { $('fUnir').reset(); $('unInfo').textContent = ''; $('unMsg').textContent = ''; $('dUnir').showModal(); });
$('unCerrar').addEventListener('click', () => $('dUnir').close());
['unA', 'unB'].forEach(id => $(id).addEventListener('input', () => {
  const a = buscarProd($('unA').value), b = buscarProd($('unB').value);
  $('unInfo').innerHTML = [a && `Se queda: <b>${esc(a.codigo)} · ${esc(a.nombre)}</b> (${nq(a.stock)} ${esc(a.unidad)})`, b && `Se elimina: <b>${esc(b.codigo)} · ${esc(b.nombre)}</b> (${nq(b.stock)} ${esc(b.unidad)})`,
    a && b && `Stock después de unir: <b>${nq((a.stock || 0) + (b.stock || 0))} ${esc(a.unidad)}</b>`, a && b && a.unidad !== b.unidad && `<span style="color:var(--rojo)">⚠ Tienen distinta unidad (${esc(a.unidad)} y ${esc(b.unidad)}). Únelos solo si es la misma presentación.</span>`].filter(Boolean).join('<br>');
}));
$('fUnir').addEventListener('submit', async e => {
  e.preventDefault();
  const a = buscarProd($('unA').value), b = buscarProd($('unB').value), msg = t => { $('unMsg').textContent = t; };
  if (!a || !b) return msg('Elige los dos productos de la lista.');
  if (a.id === b.id) return msg('Elige dos productos distintos.');
  if (!confirm(`¿Unir ${b.codigo} · ${b.nombre} dentro de ${a.codigo} · ${a.nombre}?\n\nTodo su kardex pasará a ${a.codigo} y ${b.codigo} se eliminará. No se puede deshacer.`)) return;
  const btn = e.submitter; ocupado(btn, true, 'Uniendo…'); msg('');
  try {
    const ms = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', b.id)));
    let lote = writeBatch(db), n = 0;
    for (const d of ms.docs) { lote.update(d.ref, { productoId: a.id, codigo: a.codigo, producto: a.nombre, unidad: a.unidad }); if (++n % 450 === 0) { await lote.commit(); lote = writeBatch(db); } }
    if (n % 450) await lote.commit();
    // facturas de compra que tenían el duplicado
    const cs = await getDocs(query(collection(db, 'comprobantes'), where('clase', '==', 'COMPRA')));
    for (const c of cs.docs) {
      const lin = c.data().lineas || [];
      if (lin.some(l => l.prodId === b.id)) await updateDoc(c.ref, { lineas: lin.map(l => l.prodId === b.id ? { ...l, prodId: a.id, codigo: a.codigo } : l) });
    }
    await recalcularProducto(a.id);
    await deleteDoc(doc(db, 'productos', b.id));
    $('dUnir').close(); toast(`${b.codigo} se unió a ${a.codigo}: ${n} movimientos pasaron a ${a.nombre}.`);
    delete INV.conteo[b.id]; delete INV.costo[b.id]; guardarConteo();
  } catch (err) { msg(errorTexto(err)); }
  ocupado(btn, false);
});

/* ================= Salida de materiales (módulo aparte; el kardex solo se consulta) ================= */
const SAL = { lista: [], abiertos: new Set(), grupos: new Map() };
function abrirSalidas() {
  $('sNueva').hidden = !puede('kardex');
  if (!$('sMes').value) $('sMes').value = mesISO();
  cargarSalidas();
}
async function cargarSalidas() {
  const mes = $('sMes').value || mesISO();
  $('sFilas').innerHTML = '<div class="vacio">Cargando…</div>';
  try {
    const [s, at] = await Promise.all([
      getDocs(query(collection(db, 'movimientos'), where('fecha', '>=', mes + '-01'), where('fecha', '<=', mes + '-31'))),
      getDocs(query(collection(db, 'solicitudes'), where('estado', '==', 'ATENDIDA'))).catch(() => ({ docs: [] }))
    ]);
    // lo que se pidió y no se entregó (con su observación), de las solicitudes atendidas este mes
    const tipoDeSol = new Map(at.docs.map(d => [d.id, d.data().tipo === 'LIMPIEZA' ? 'LIMPIEZA' : 'ESCRITORIO']));
    const noAt = at.docs.map(d => ({ id: d.id, ...d.data() })).filter(x => (x.fechaEntrega || '').startsWith(mes))
      .flatMap(x => (x.entrega || []).filter(i => !(i.cant > 0)).map((i, k) => ({
        id: `noat-${x.id}-${k}`, noAt: true, tipo: 'SALIDA', fecha: x.fechaEntrega, codigo: '', producto: i.desc, cant: 0, cantSol: i.cantSol, unidad: i.unidad || '',
        tercero: x.centro, persona: x.recibidoPor || '', documento: `Solicitud N.º ${x.numero}`, solicitudId: x.id, obs: i.obs || '', ct: 0, usuario: x.atendidoPor || '', ms: x.atendidoMs || 0, tipoSol: x.tipo === 'LIMPIEZA' ? 'LIMPIEZA' : 'ESCRITORIO'
      })));
    SAL.lista = s.docs.map(d => ({ id: d.id, ...d.data() }))
      .filter(m => (m.tipo === 'SALIDA' && m.origen !== 'ANULACION') || (m.tipo === 'AJUSTE' && m.origen !== 'SALDO INICIAL'))
      .map(m => m.solicitudId && tipoDeSol.has(m.solicitudId) ? { ...m, tipoSol: tipoDeSol.get(m.solicitudId) } : m)
      .concat(noAt)
      .sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.ms || 0) - (a.ms || 0));
    pintarSalidas();
  } catch (e) { $('sFilas').innerHTML = `<div class="aviso error">${esc(errorTexto(e))}</div>`; }
}
function filtrarSalidas() {
  const t = $('sTipo').value, q = norm($('sBuscar').value);
  return SAL.lista.filter(m => (!t || (t === 'NOAT' ? m.noAt : m.tipo === t)) && (!q || norm([m.codigo, m.producto, nombreCC(m.tercero), m.persona, m.documento, m.obs].join(' ')).includes(q)));
}
// Una fila de material (en la lista de ajustes y dentro de cada entrega desplegada)
function filaSalida(m, conDestino) {
  const adm = YO.rol === 'ADMIN', parcial = !m.noAt && m.cantSol && m.cant < m.cantSol;
  const tipo = m.tipo === 'AJUSTE' ? '' : tipoSalida(m) === 'LIMPIEZA' ? '🧽' : '✏️';
  return `<tr class="${m.noAt ? 'sol-no' : parcial ? 'sol-parcial' : ''}">${conDestino ? `<td>${fmtF(m.fecha)}</td>` : `<td title="${tipo === '🧽' ? 'Limpieza' : 'Escritorio'}">${tipo}</td>`}<td>${esc(m.codigo)}</td><td>${esc(m.producto)}${m.tipo === 'AJUSTE' ? ` <span class="pill AJUSTE">${esc(m.origen)}</span>` : ''}${m.noAt ? ' <span class="pill RECHAZADO">NO ATENDIDO</span>' : ''}</td>
    <td class="num">${m.noAt ? `<b>0</b> <small class="nota">de ${nq(m.cantSol)} ${esc(m.unidad || '')}</small>` : `<b>${nq(m.cant)}</b> <small class="nota">${esc(m.unidad || '')}${parcial ? ` de ${nq(m.cantSol)}` : ''}</small>`}</td>
    ${conDestino ? `<td>${esc(nombreCC(m.tercero))}</td>` : ''}<td>${esc(m.documento || '')}</td><td>${m.obs ? `<span class="obs-txt">${esc(m.obs)}</span>` : ''}</td>
    <td class="num">${m.noAt ? '' : n2(m.ct)}</td><td><small>${esc(m.usuario || '')}</small></td><td>${adm && !m.noAt ? `<button class="btn peligro chico" type="button" data-sdel="${esc(m.id)}">Eliminar</button>` : ''}</td></tr>`;
}
const tipoSalida = m => m.tipoSol || (/LIMPIEZA/i.test(PRODUCTOS.get(m.productoId)?.categoria || '') ? 'LIMPIEZA' : 'ESCRITORIO');
const numsSol = l => [...new Set(l.map(m => (/N\.º\s*(\d+)/.exec(m.documento || '') || [])[1]).filter(Boolean))].sort((a, b) => a - b);
// Las salidas se agrupan por sucursal y fecha (una entrega); cada entrega se despliega y se imprime
function pintarSalidas() {
  const l = filtrarSalidas(), t = $('sTipo').value;
  const tot = r2(l.filter(m => m.tipo === 'SALIDA').reduce((a, m) => a + (m.ct || 0), 0)), nNo = l.filter(m => m.noAt).length;
  if (t === 'AJUSTE') { // ajustes: lista simple
    $('sRes').innerHTML = `<span><b>${l.length}</b> ajustes</span>`;
    $('sFilas').innerHTML = l.length ? `<table class="lst"><thead><tr><th>Fecha</th><th>Código</th><th>Producto</th><th class="num">Cantidad</th><th>Destino</th><th>Motivo / documento</th><th>Observación</th><th class="num">Costo total</th><th>Registró</th><th></th></tr></thead><tbody>${l.map(m => filaSalida(m, true)).join('')}</tbody></table>` : '<div class="vacio">No hay ajustes con este filtro.</div>';
    return;
  }
  const grupos = new Map();
  l.forEach(m => { const k = `${m.tipo === 'AJUSTE' ? '~AJUSTE' : m.tercero || ''}|${m.fecha}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(m); });
  const lista = [...grupos.entries()].sort((a, b) => b[0].split('|')[1].localeCompare(a[0].split('|')[1]) || a[0].localeCompare(b[0], 'es', { numeric: true }));
  SAL.grupos = new Map(lista);
  $('sRes').innerHTML = `<span><b>${lista.length}</b> entregas</span><span><b>${l.length - nNo}</b> materiales entregados</span>${nNo ? `<span style="color:var(--rojo)">No atendidos: <b>${nNo}</b></span>` : ''}<span>Costo de lo entregado: <b>S/ ${n2(tot)}</b></span>`;
  $('sFilas').innerHTML = lista.length ? `<table class="lst ent"><thead><tr><th></th><th>Fecha</th><th>Sucursal / centro de costo</th><th>Solicitudes</th><th class="opc">Recibió</th><th class="num">Materiales</th><th class="num">Costo total</th><th></th></tr></thead><tbody>${lista.map(([k, ms]) => {
    const [cc, f] = k.split('|'), aj = cc === '~AJUSTE', abierto = SAL.abiertos.has(k);
    const ent = ms.filter(m => !m.noAt), no = ms.length - ent.length, total = r2(ent.reduce((a, m) => a + (m.ct || 0), 0));
    const nums = numsSol(ms), tipos = n => [...new Set(ms.filter(m => (m.documento || '').includes('N.º ' + n)).map(tipoSalida))].map(x => x === 'LIMPIEZA' ? '🧽' : '✏️').join('');
    const sols = aj ? '<span class="nota">Ajustes de inventario</span>' : nums.length ? nums.map(n => `<span>N.º ${n} ${tipos(n)}</span>`).join('') + (ms.some(m => !/N\.º/.test(m.documento || '')) ? '<span class="nota">+ salida manual</span>' : '') : '<span class="nota">Salida manual</span>';
    const fila = `<tr class="grp${abierto ? ' abierto' : ''}" data-sg="${esc(k)}"><td class="flecha">${abierto ? '▾' : '▸'}</td><td>${fmtF(f)}</td><td><b>${esc(aj ? 'AJUSTE DE INVENTARIO' : nombreCC(cc) || 'SIN DESTINO')}</b></td><td class="sols">${sols}</td>
      <td class="opc">${esc([...new Set(ms.map(m => m.persona).filter(Boolean))].join(', '))}</td><td class="num">${ent.length}${no ? `<span class="sub" style="color:var(--rojo)">${no} no atendido${no > 1 ? 's' : ''}</span>` : ''}</td><td class="num"><b>S/ ${n2(total)}</b></td>
      <td>${aj ? '' : `<button class="btn chico" type="button" data-simp="${esc(k)}" title="Imprime esta entrega en una hoja">Imprimir</button>`}</td></tr>`;
    const det = abierto ? `<tr class="det"><td colspan="8"><table><thead><tr><th></th><th>Código</th><th>Material</th><th class="num">Cantidad</th><th>Documento</th><th>Observación</th><th class="num">Costo total</th><th>Registró</th><th></th></tr></thead><tbody>${ms.slice().sort((a, b) => tipoSalida(a).localeCompare(tipoSalida(b)) || (a.documento || '').localeCompare(b.documento || '')).map(m => filaSalida(m, false)).join('')}</tbody></table></td></tr>` : '';
    return fila + det;
  }).join('')}</tbody></table><div class="lst-pie">Total — ${lista.length} entregas</div>` : '<div class="vacio">No hay salidas con este filtro.</div>';
}
$('sMes').addEventListener('change', cargarSalidas);
// Imprimir una entrega (sucursal + fecha) en una sola hoja: escritorio arriba y limpieza abajo
async function imprimirEntrega(c, dia, b) {
  const nom = nombreCC(c) || c;
  const movs = SAL.lista.filter(m => m.tipo === 'SALIDA' && String(m.tercero) === String(c) && (!dia || m.fecha === dia));
  if (!movs.length) return toast(`No hay salidas para ${nom}.`, true);
  ocupado(b, true, '…');
  try {
    // datos de las solicitudes de origen (N.º y fecha de solicitud), si las salidas vinieron de una
    const sols = new Map();
    for (const id of new Set(movs.map(m => m.solicitudId).filter(Boolean))) { try { const d = await getDoc(doc(db, 'solicitudes', id)); if (d.exists()) sols.set(id, d.data()); } catch (err) { } }
    const tipoDe = m => { const s0 = m.solicitudId && sols.get(m.solicitudId); if (s0) return s0.tipo === 'LIMPIEZA' ? 'LIMPIEZA' : 'ESCRITORIO'; return /LIMPIEZA/i.test(PRODUCTOS.get(m.productoId)?.categoria || '') ? 'LIMPIEZA' : 'ESCRITORIO'; };
    const unicos = v => [...new Set(v.filter(Boolean))];
    const grupo = tipo => {
      const ms = movs.filter(m => tipoDe(m) === tipo).sort((a, b2) => (a.fecha || '').localeCompare(b2.fecha || '') || (a.ms || 0) - (b2.ms || 0)); if (!ms.length) return [];
      return unicos(ms.map(m => m.fecha)).map(f => {
        const md = ms.filter(m => m.fecha === f), ss = unicos(md.map(m => m.solicitudId)).map(id => sols.get(id)).filter(Boolean);
        return {
          tipo, numero: ss.length ? ss.map(x => x.numero).join(', ') : '—', fecha: ss.length ? ss.map(x => x.fecha).sort()[0] : '', fechaEntrega: f,
          solicitante: unicos(ss.map(x => x.solicitante)).join(', '), nota: '',
          entregadoPor: unicos(ss.map(x => x.entregadoPor)).join(', ') || unicos(md.map(m => m.usuario)).join(', '), recibidoPor: unicos(md.map(m => m.persona)).join(', '),
          entrega: md.map(m => ({ codigo: m.codigo, cant: m.cant, unidad: m.unidad, producto: m.producto, desc: m.producto, cu: m.cu || 0, ct: m.ct || 0, obs: m.obs || '', cantSol: m.cantSol }))
        };
      });
    };
    imprimirSucursalUnaHoja(nom, [...grupo('ESCRITORIO'), ...grupo('LIMPIEZA')]);
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
}
['sTipo', 'sBuscar'].forEach(i => $(i).addEventListener('input', pintarSalidas));
$('sCsv').addEventListener('click', () => descargarCSV(`salidas_${$('sMes').value}.csv`, [['Fecha', 'Estado', 'Código', 'Producto', 'Cant. pedida', 'Cant. entregada', 'Unidad', 'Centro de costo', 'Entregado a', 'Documento', 'Observación', 'Costo unit.', 'Costo total', 'Registró']]
  .concat(filtrarSalidas().map(m => [fmtF(m.fecha), m.noAt ? 'NO ATENDIDO' : m.tipo === 'AJUSTE' ? m.origen : m.cantSol && m.cant < m.cantSol ? 'PARCIAL' : 'ENTREGADO', m.codigo || '', m.producto, m.cantSol ? String(m.cantSol).replace('.', ',') : '', String(m.cant).replace('.', ','), m.unidad || '', nombreCC(m.tercero), m.persona || '', m.documento || '', m.obs || '', m.noAt ? '' : numCSV(m.cu), m.noAt ? '' : numCSV(m.ct), m.usuario || '']))));
$('sFilas').addEventListener('click', async e => {
  const imp = e.target.closest('[data-simp]');
  if (imp) { const [c, f] = imp.dataset.simp.split('|'); return imprimirEntrega(c, f, imp); }
  const g = e.target.closest('tr.grp');
  if (g && !e.target.closest('button')) { const k = g.dataset.sg; if (SAL.abiertos.has(k)) SAL.abiertos.delete(k); else SAL.abiertos.add(k); return pintarSalidas(); }
  const b = e.target.closest('[data-sdel]'); if (!b) return;
  const m = SAL.lista.find(x => x.id === b.dataset.sdel); if (!m) return;
  if (!confirm(`¿Eliminar esta salida?\n${fmtF(m.fecha)} · ${m.producto} · ${nq(m.cant)} ${m.unidad || ''} · ${nombreCC(m.tercero)}\n\nEl stock y el kardex se recalculan solos.`)) return;
  ocupado(b, true);
  try { await deleteDoc(doc(db, 'movimientos', m.id)); await recalcularProducto(m.productoId); toast('Salida eliminada.'); cargarSalidas(); }
  catch (err) { toast(errorTexto(err), true); ocupado(b, false); }
});

/* Salidas y ajustes */
$('sNueva').addEventListener('click', () => {
  $('fMov').reset(); $('mFecha').value = hoyISO(); $('mMsg').textContent = ''; $('mInfo').textContent = '';
  // Destino = centro de costo (código), igual que las salidas del Excel y de las solicitudes
  $('mDestino').innerHTML = '<option value="">— Elegir —</option>' + ((LISTAS.codigosCC || []).length ? LISTAS.codigosCC.map(c => `<option value="${esc(c.codigo)}">${esc(c.codigo + (c.nombre ? ' · ' + c.nombre : ''))}</option>`) : LISTAS.areas.map(a => `<option>${esc(a)}</option>`)).join('');
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
  if (tipoSel === 'SALIDA' && !$('mDestino').value) return $('mMsg').textContent = 'Elige el centro de costo.';
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
    $('dMov').close(); toast('Salida registrada.');
    if (modActual === 'salidas') cargarSalidas();
    if (kSel === p.id) { const s = await getDocs(query(collection(db, 'movimientos'), where('productoId', '==', kSel))); kMovs = ordenarMovs(s.docs.map(d => ({ id: d.id, ...d.data() }))); pintarDetKardex(); }
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
  $('uRoles').innerHTML = '<b>Roles:</b><br>' + ROLES.map(r => `<b>${rolTxt(r)}</b>: ${esc(DESC_ROL[r])}`).join('<br>');
  $('uFilas').innerHTML = '<tr><td colspan="5" class="vacio">Cargando…</td></tr>';
  try {
    const s = await getDocs(collection(db, 'usuarios'));
    const l = s.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => a.usuario.localeCompare(b.usuario));
    $('uFilas').innerHTML = l.map(u => `<tr><td>${esc(u.usuario)}</td><td>${esc(u.nombre)}</td><td><select data-rol="${esc(u.uid)}" aria-label="Rol"${u.uid === YO.uid ? ' disabled' : ''}>${ROLES.map(r => `<option value="${r}"${r === u.rol ? ' selected' : ''}>${rolTxt(r)}</option>`).join('')}</select></td><td><span class="pill ${u.activo ? 'APROBADO' : 'ANULADO'}">${u.activo ? 'ACTIVO' : 'INACTIVO'}</span></td><td>${u.uid === YO.uid ? '<small class="nota">Tú</small>' : `<button class="btn sec chico" data-act="${esc(u.uid)}" data-v="${u.activo ? '0' : '1'}">${u.activo ? 'Desactivar' : 'Activar'}</button>`}</td></tr>`).join('');
  } catch (e) { $('uFilas').innerHTML = `<tr><td colspan="5"><div class="aviso error">${esc(errorTexto(e))}</div></td></tr>`; }
}
$('uFilas').addEventListener('change', async e => { const s = e.target.closest('[data-rol]'); if (!s) return; try { await updateDoc(doc(db, 'usuarios', s.dataset.rol), { rol: s.value }); toast('Rol actualizado.'); } catch (err) { toast(errorTexto(err), true); } });
$('uFilas').addEventListener('click', async e => { const b = e.target.closest('[data-act]'); if (!b) return; ocupado(b, true); try { await updateDoc(doc(db, 'usuarios', b.dataset.act), { activo: b.dataset.v === '1' }); abrirUsuarios(); } catch (err) { toast(errorTexto(err), true); ocupado(b, false); } });
$('uNuevo').addEventListener('click', () => { $('fUsr').reset(); $('uMsg').textContent = ''; $('uRol').innerHTML = ROLES.map(r => `<option value="${r}"${r === 'LOGISTICA' ? ' selected' : ''}>${rolTxt(r)}</option>`).join(''); $('dUsr').showModal(); });
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
  $('cfClave').value = IA?.clave || ''; $('cfModelo').value = !IA?.modelo || MODELOS_RETIRADOS.includes(IA.modelo) ? MODELO_IA : IA.modelo;
  $('cfEmpresas').value = LISTAS.empresas.map(e => e.nombre + (e.ruc ? ' | ' + e.ruc : '')).join('\n');
  $('cfAreas').value = LISTAS.areas.join('\n'); $('cfGastos').value = LISTAS.gastos.join('\n'); $('cfFormas').value = LISTAS.formas.join('\n');
  $('cfCond').value = LISTAS.condiciones.join('\n'); $('cfUnid').value = LISTAS.unidades.join('\n'); $('cfCargos').value = LISTAS.cargos.join('\n');
  $('cfCodCC').value = (LISTAS.codigosCC || []).map(c => c.codigo + ' | ' + c.nombre).join('\n');
}
$('cfGuardar').addEventListener('click', async e => {
  const lin = id => [...new Set($(id).value.split('\n').map(x => limpio(x).toUpperCase()).filter(Boolean))];
  const l = {
    empresas: lin('cfEmpresas').map(x => { const [n, r] = x.split('|').map(limpio); return { nombre: n, ruc: (r || '').replace(/\D/g, '') }; }),
    areas: lin('cfAreas'), gastos: lin('cfGastos'), formas: lin('cfFormas'), condiciones: lin('cfCond'), unidades: lin('cfUnid'), cargos: lin('cfCargos'),
    codigosCC: lin('cfCodCC').map(x => { const [c, n] = x.split('|').map(limpio); return { codigo: c, nombre: n || '' }; }).filter(c => c.codigo)
  };
  if (Object.entries(l).some(([k, v]) => k !== 'codigosCC' && !v.length)) return toast('Ninguna lista puede quedar vacía.', true);
  const b = e.currentTarget; ocupado(b, true, 'Guardando…');
  try {
    await setDoc(doc(db, 'config', 'listas'), l);
    await setDoc(doc(db, 'config', 'ia'), { clave: limpio($('cfClave').value), modelo: limpio($('cfModelo').value) || MODELO_IA });
    await cargarBase(); toast('Configuración guardada.');
  } catch (err) { toast(errorTexto(err), true); }
  ocupado(b, false);
});
