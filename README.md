# ERP Socorro

Sistema web de Farmacia Socorro (GitHub Pages + Firebase).

**Módulos:** ingreso de servicios, ingreso de materiales (compras con kardex), kardex de almacén único con costo promedio, personal (RR. HH.), cargo de entrega de útiles, usuarios y configuración.

**Lectura de facturas con IA:** al subir la foto o PDF, Google Gemini llena proveedor, serie, montos e ítems. La clave se pone en Configuración (se guarda en Firestore, no en este repositorio).

## Puesta en marcha
1. Crear el proyecto Firebase "ERP Socorro" con la cuenta corporativa (plan Spark).
2. Activar Authentication → Correo electrónico/contraseña.
3. Crear Firestore Database y publicar las reglas de `firestore.rules`.
4. Registrar una app web y pegar su configuración en `firebase-config.js`.
5. Abrir la página: la primera vez pide crear el administrador.
