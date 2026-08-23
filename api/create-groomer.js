// Función de backend (Vercel Serverless Function) para que el dueño de un
// negocio cree cuentas de groomer.
//
// Usa la llave "service_role" de Supabase, que NUNCA debe estar en el
// navegador (le da acceso total, sin RLS, a toda la base de datos). Por eso
// esto vive aquí, en el servidor, y no en app.js.
//
// No usa ningún paquete de npm a propósito (fetch ya viene incluido en el
// runtime de Node de Vercel) — así seguimos sin necesitar paso de
// compilación ni package.json, igual que el resto del proyecto.
//
// Variables de entorno requeridas en Vercel (Project Settings -> Environment
// Variables): SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    res.status(500).json({ error: "Faltan variables de entorno en el servidor (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)" });
    return;
  }

  const authHeader = req.headers.authorization || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "");
  if (!callerToken) {
    res.status(401).json({ error: "Falta el token de autenticación" });
    return;
  }

  const { fullName, email, password } = req.body || {};
  if (!fullName || !email || !password) {
    res.status(400).json({ error: "Faltan datos (nombre, correo o contraseña)" });
    return;
  }

  try {
    // 1. ¿Quién está llamando? (valida el token del dueño que hizo la petición)
    const whoAmIResp = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${callerToken}` },
    });
    if (!whoAmIResp.ok) {
      res.status(401).json({ error: "Sesión inválida o expirada" });
      return;
    }
    const callerUser = await whoAmIResp.json();

    // 2. ¿Es dueño de un negocio? (con la service key, sin pasar por RLS)
    const profileResp = await fetch(
      `${SUPABASE_URL}/rest/v1/profiles?id=eq.${callerUser.id}&select=business_id,role`,
      { headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}` } }
    );
    const profiles = await profileResp.json();
    const callerProfile = profiles?.[0];
    if (!callerProfile || callerProfile.role !== "owner") {
      res.status(403).json({ error: "Solo el dueño del negocio puede crear cuentas de personal" });
      return;
    }

    // 3. Crea la cuenta de autenticación del groomer (ya confirmada, sin
    //    necesidad de que confirme su correo)
    const createUserResp = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password, email_confirm: true }),
    });
    const newUser = await createUserResp.json();
    if (!createUserResp.ok) {
      res.status(400).json({ error: newUser?.msg || newUser?.message || "No se pudo crear la cuenta" });
      return;
    }

    // 4. Crea su perfil como groomer, ligado al negocio del dueño que llamó
    const insertProfileResp = await fetch(`${SUPABASE_URL}/rest/v1/profiles`, {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        id: newUser.id,
        business_id: callerProfile.business_id,
        role: "groomer",
        full_name: fullName,
      }),
    });
    if (!insertProfileResp.ok) {
      const errBody = await insertProfileResp.json().catch(() => ({}));
      res.status(400).json({ error: errBody?.message || "No se pudo crear el perfil del groomer" });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Error inesperado: " + err.message });
  }
};
