# Pelukan

SaaS para peluquerías/estéticas caninas (grooming): fichas de mascotas,
calendario de citas, catálogo de servicios, panel financiero con margen
real por servicio, y cuentas de personal (dueño/groomer).

A diferencia de Todo Guau, Casa Guau y Paseadores, este **no es un proyecto
de uso personal** — es un producto que se vende a otros negocios de
grooming, cada uno con sus datos completamente aislados del resto
(multi-tenant). Vive en su propia cuenta de Supabase, su propia cuenta de
GitHub y su propia cuenta de Vercel (`pelukanservice-oss`), separado de
todo lo demás.

**En línea:** https://pelukan.vercel.app/

## Estado actual (2026-08-23)

✅ Base de datos (MVP v1) creada y funcionando en Supabase
✅ App desplegada en Vercel, conectada a la base de datos real
✅ Módulos: **Fichas** (con flujo de revisión pendiente), **Catálogo de
servicios** (con margen), **Calendario** (agenda por día), **Finanzas**
(ingresos/egresos + margen real, con ingreso automático al completar una
cita), **Personal** (el dueño crea cuentas de groomer desde la app)
🔲 Falta: Stripe (cobro por tiers de groomers)

## 1. Terminar de configurar Supabase (una sola vez, si no lo has hecho)

1. Ve a tu proyecto Pelukan en Supabase → **SQL Editor** → **New query**
2. Corre en orden, cada uno por separado: [`supabase/patch-001-security-and-signup.sql`](supabase/patch-001-security-and-signup.sql),
   [`supabase/patch-002-fix-rls-recursion.sql`](supabase/patch-002-fix-rls-recursion.sql),
   [`supabase/patch-003-fix-business-insert.sql`](supabase/patch-003-fix-business-insert.sql)

Si vas a crear el proyecto desde cero, solo corre
[`supabase/schema.sql`](supabase/schema.sql) — ya trae todas las
correcciones incluidas, no necesitas los patches.

### Desactivar confirmación de correo (mientras pruebas)

Ve a **Authentication → Providers → Email** y desactiva **"Confirm
email"** mientras pruebas. Actívalo de nuevo antes de tener clientes
reales (o deja que cada dueño confirme su correo al registrarse — las
cuentas de groomer que crea el dueño desde la app **no** necesitan esto,
quedan confirmadas automáticamente).

## 2. Configurar la función de backend (para crear cuentas de groomer)

El módulo **Personal** necesita una función en el servidor
(`api/create-groomer.js`) que usa la llave `service_role` de Supabase —
esa llave da acceso total a la base de datos, por eso nunca va en
`config.js` ni en ningún archivo que se suba al navegador. Vive solo como
variable de entorno en Vercel:

1. En Supabase: **Project Settings → API → API Keys**, copia la
   **`service_role`** key (dice "secret", con un botón para revelarla)
2. En Vercel: entra al proyecto **Pelukan** → **Settings → Environment
   Variables**, y agrega dos variables:
   - `SUPABASE_URL` = la misma Project URL que ya tienes en `config.js`
   - `SUPABASE_SERVICE_ROLE_KEY` = la llave que acabas de copiar
3. Vuelve a desplegar (**Deployments** → en el más reciente, menú `...` →
   **Redeploy**) para que Vercel tome las variables nuevas

## 3. Probar la app en tu computadora

1. Abre PowerShell en esta carpeta y corre:
   ```
   ./serve.ps1
   ```
2. Abre [http://localhost:5500](http://localhost:5500) en tu navegador.

Nota: el módulo de **Personal** (crear groomers) solo funciona en la
versión desplegada en Vercel (`pelukan.vercel.app`), no en local — porque
la función de backend vive ahí, no en `serve.ps1`.

## Próximos pasos

- Integrar Stripe para el cobro recurrente por tiers de groomers.
- Definir precio final por tier.
- Elegir nombre de dominio propio (opcional, `pelukan.vercel.app` ya
  funciona igual).

## Estructura del proyecto

- `index.html`, `style.css`, `app.js` — la app (sin paso de compilación).
- `api/create-groomer.js` — función de backend (Vercel Serverless
  Function) para que el dueño cree cuentas de groomer.
- `config.js` — tus credenciales de Supabase (URL y anon key — estas sí
  son públicas a propósito, la protección real la hace RLS en la base de
  datos, no el secreto de esta llave).
- `supabase/schema.sql` — esquema completo, para instalaciones nuevas.
- `supabase/patch-00X-*.sql` — correcciones para el proyecto que ya
  creaste (corre cada uno una sola vez, en orden).
- `serve.ps1` — solo para pruebas locales en esta computadora.
