# Pelukan

SaaS para peluquerías/estéticas caninas (grooming): fichas de mascotas,
calendario de citas, catálogo de servicios, panel financiero con margen
real por servicio, y cuentas de personal (dueño/groomer).

A diferencia de Todo Guau, Casa Guau y Paseadores, este **no es un proyecto
de uso personal** — es un producto que se vende a otros negocios de
grooming, cada uno con sus datos completamente aislados del resto
(multi-tenant). Vive en su propia cuenta de Supabase, separado de todo lo
demás.

## Estado actual (2026-08-22)

✅ Base de datos (MVP v1) creada y funcionando en Supabase
✅ App: login/registro del negocio, módulo de **Fichas** (con flujo de
revisión pendiente para lo que registra un groomer) y **Catálogo de
servicios**
🔲 Faltan: Calendario, Finanzas, Personal (estos dos últimos necesitan
Stripe y una función de backend, respectivamente — ver "Próximos pasos")

## 1. Terminar de configurar Supabase (una sola vez)

Si ya creaste el proyecto y corriste el `schema.sql` original, **falta
correr un patch** que corrige un problema de seguridad y habilita el
registro:

1. Ve a tu proyecto Pelukan en Supabase → **SQL Editor** → **New query**
2. Abre [`supabase/patch-001-security-and-signup.sql`](supabase/patch-001-security-and-signup.sql),
   copia todo su contenido, pégalo y dale **Run**

Si vas a crear el proyecto desde cero (por ejemplo lo borraste y empiezas
de nuevo), solo corre [`supabase/schema.sql`](supabase/schema.sql) — ya
trae las correcciones incluidas, no necesitas el patch.

### Desactivar confirmación de correo (mientras pruebas)

Por default, Supabase pide que confirmes tu correo antes de poder iniciar
sesión después de registrarte — esto complica las pruebas. Ve a
**Authentication → Providers → Email** y desactiva **"Confirm email"**
mientras estás probando. Actívalo de nuevo antes de tener clientes reales.

## 2. Probar la app en tu computadora

1. Abre PowerShell en esta carpeta y corre:
   ```
   ./serve.ps1
   ```
2. Abre [http://localhost:5500](http://localhost:5500) en tu navegador.
3. En la pestaña **"Registrar mi negocio"**, crea tu cuenta de prueba como
   dueño(a) (puedes usar un negocio ficticio para probar).
4. Ya adentro, prueba crear una ficha y un servicio en el catálogo.

Para probar cómo se ve desde un groomer, necesitas crear esa cuenta
directo en Supabase por ahora (**Authentication → Users → Add user**, y
luego en **Table Editor → profiles**, agrega una fila a mano con
`role = 'groomer'` y el `business_id` de tu negocio de prueba) — el panel
para hacerlo desde la app todavía no está construido (ver abajo).

## Próximos pasos

- **Calendario**: agendar citas ligadas a fichas y servicios.
- **Finanzas**: registrar ingresos/egresos y ver el margen real (ya
  calculado en el catálogo, falta conectarlo a movimientos reales).
- **Personal**: el dueño necesita poder crear cuentas de groomer desde la
  app. Esto requiere una **función de backend** (Vercel serverless
  function) que use la `service_role` key de Supabase — esa key nunca
  debe estar en el navegador, por eso no se puede hacer solo con
  HTML/JS del cliente como el resto de la app.
- Subir a GitHub + desplegar en Vercel (mismo flujo que tus otras apps).
- Integrar Stripe para el cobro por tiers de groomers.

## Estructura del proyecto

- `index.html`, `style.css`, `app.js` — la app (sin paso de compilación).
- `config.js` — tus credenciales de Supabase (URL y anon key).
- `supabase/schema.sql` — esquema completo, para instalaciones nuevas.
- `supabase/patch-001-security-and-signup.sql` — corrección para el
  proyecto que ya creaste (corre esto una sola vez).
- `serve.ps1` — solo para pruebas locales en esta computadora.
