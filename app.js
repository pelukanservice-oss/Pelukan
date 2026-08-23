// ============================================================
// Pelukan — lógica de la app (MVP v1: auth, fichas, catálogo)
// Vanilla JS, sin paso de compilación. Cliente de Supabase vía CDN (UMD),
// expuesto como window.supabase — por eso el cliente propio se llama
// "sb" y no "supabase", para no pisar ese nombre global.
// ============================================================

const sb = window.supabase.createClient(
  window.SUPABASE_CONFIG.SUPABASE_URL,
  window.SUPABASE_CONFIG.SUPABASE_ANON_KEY
);

// ---------- Estado ----------
let currentUser = null;
let currentProfile = null; // { id, business_id, role, full_name }
let currentBusiness = null;

const isOwner = () => currentProfile?.role === "owner";

// ============================================================
// AUTENTICACIÓN
// ============================================================

document.querySelectorAll(".auth-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".auth-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.getElementById("login-form").hidden = tab !== "login";
    document.getElementById("signup-form").hidden = tab !== "signup";
  });
});

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("login-error");
  errorEl.hidden = true;
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = "No se pudo entrar: " + error.message;
    errorEl.hidden = false;
    return;
  }
  await bootAfterLogin();
});

document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById("signup-error");
  errorEl.hidden = true;

  const businessName = document.getElementById("signup-business-name").value.trim();
  const fullName = document.getElementById("signup-full-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  const { data: signUpData, error: signUpError } = await sb.auth.signUp({ email, password });
  if (signUpError) {
    errorEl.textContent = "No se pudo registrar: " + signUpError.message;
    errorEl.hidden = false;
    return;
  }
  if (!signUpData.session) {
    errorEl.textContent =
      "Tu cuenta se creó pero necesita confirmarse por correo antes de poder entrar. " +
      "Si esto no lo esperabas, en Supabase → Authentication → Providers → Email, " +
      "desactiva 'Confirm email' mientras pruebas la app.";
    errorEl.hidden = false;
    return;
  }

  const userId = signUpData.user.id;

  // OJO: generamos el id del negocio aquí mismo (en vez de pedirle a
  // Supabase que nos regrese la fila con .select()) a propósito — en este
  // punto todavía no existe tu perfil, así que la política de LECTURA de
  // "businesses" (que exige ya pertenecer al negocio) no te dejaría leer
  // de vuelta la fila recién creada. Insertando con un id que ya conocemos
  // evitamos necesitar esa lectura.
  const businessId = crypto.randomUUID();
  const { error: bizError } = await sb
    .from("businesses")
    .insert({ id: businessId, name: businessName });
  if (bizError) {
    errorEl.textContent = "No se pudo crear el negocio: " + bizError.message;
    errorEl.hidden = false;
    return;
  }

  const { error: profileError } = await sb.from("profiles").insert({
    id: userId,
    business_id: businessId,
    role: "owner",
    full_name: fullName,
  });
  if (profileError) {
    errorEl.textContent = "No se pudo crear tu perfil: " + profileError.message;
    errorEl.hidden = false;
    return;
  }

  await bootAfterLogin();
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUser = null;
  currentProfile = null;
  currentBusiness = null;
  document.getElementById("main-screen").hidden = true;
  document.getElementById("auth-screen").hidden = false;
});

async function bootAfterLogin() {
  const { data: sessionData } = await sb.auth.getSession();
  currentUser = sessionData.session?.user ?? null;
  if (!currentUser) return;

  const { data: profile, error: profileError } = await sb
    .from("profiles")
    .select("*")
    .eq("id", currentUser.id)
    .single();
  if (profileError || !profile) {
    alert("No se encontró tu perfil de negocio. Contacta soporte.");
    await sb.auth.signOut();
    return;
  }
  currentProfile = profile;

  const { data: business } = await sb
    .from("businesses")
    .select("*")
    .eq("id", profile.business_id)
    .single();
  currentBusiness = business;
  if (currentBusiness) {
    document.getElementById("business-opens").value = (currentBusiness.opens_at || "09:00").slice(0, 5);
    document.getElementById("business-closes").value = (currentBusiness.closes_at || "18:00").slice(0, 5);
    updateBusinessHoursSummary();
  }

  document.body.classList.toggle("is-groomer", !isOwner());
  document.getElementById("user-info").textContent =
    `${currentProfile.full_name} · ${isOwner() ? "Dueño(a)" : "Groomer"} · ${currentBusiness?.name ?? ""}`;

  document.getElementById("auth-screen").hidden = true;
  document.getElementById("main-screen").hidden = false;

  await Promise.all([loadFichas(), loadServices(), loadGroomers(), loadAppointments(), loadTransactions()]);
  renderGroomers();
}

// Si ya había una sesión abierta (recargaste la página), entra directo
(async function initSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) await bootAfterLogin();
})();

// ============================================================
// NAVEGACIÓN
// ============================================================

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => (v.hidden = true));
    document.getElementById("view-" + btn.dataset.view).hidden = false;
    if (btn.dataset.view === "calendario") loadAppointments();
    if (btn.dataset.view === "finanzas") loadTransactions();
    if (btn.dataset.view === "personal") loadGroomers().then(renderGroomers);
  });
});

// ============================================================
// MODAL genérico
// ============================================================

const modalOverlay = document.getElementById("modal-overlay");
const modalBox = document.getElementById("modal-box");

function openModal(html) {
  modalBox.innerHTML = html;
  modalOverlay.hidden = false;
}
function closeModal() {
  modalOverlay.hidden = true;
  modalBox.innerHTML = "";
}
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});

// ============================================================
// FOTOS (Supabase Storage, bucket "photos")
// ============================================================

async function uploadPhoto(file, path) {
  if (!file) return null;
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const fullPath = `${currentProfile.business_id}/${path}.${ext}`;
  const { error } = await sb.storage.from("photos").upload(fullPath, file, { upsert: true });
  if (error) throw error;
  const { data } = sb.storage.from("photos").getPublicUrl(fullPath);
  return data.publicUrl;
}

// ============================================================
// FICHAS
// ============================================================

let fichasCache = []; // pets con su pet_owner (y contacto si eres dueño)
let pendingEditRequests = [];

async function loadFichas() {
  const { data: pets, error } = await sb
    .from("pets")
    .select(
      "*, pet_owners(id, full_name, review_status, pet_owner_contacts(phone, address, email))"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return;
  }
  fichasCache = pets ?? [];

  if (isOwner()) {
    const { data: editReqs } = await sb
      .from("pet_edit_requests")
      .select("*, pets(name)")
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    pendingEditRequests = editReqs ?? [];
  } else {
    pendingEditRequests = [];
  }

  renderFichas();
}

function renderFichas() {
  const pendingPanel = document.getElementById("pending-review-panel");
  const pendingList = document.getElementById("pending-review-list");
  const list = document.getElementById("fichas-list");

  const pendingFichas = fichasCache.filter(
    (p) => p.review_status === "pending" || p.pet_owners?.review_status === "pending"
  );

  if (isOwner() && (pendingFichas.length > 0 || pendingEditRequests.length > 0)) {
    pendingPanel.hidden = false;
    pendingList.innerHTML =
      pendingFichas
        .map(
          (p) => `
      <div class="card">
        <div class="card-main">
          <strong>${escapeHtml(p.name)}</strong> — dueño: ${escapeHtml(p.pet_owners?.full_name ?? "?")}
          <span class="card-meta">Ficha nueva propuesta por personal, pendiente de revisión</span>
        </div>
        <div class="card-actions">
          <button class="btn-secondary" data-approve-ficha="${p.id}">Aprobar</button>
          <button class="btn-danger" data-reject-ficha="${p.id}">Rechazar</button>
        </div>
      </div>`
        )
        .join("") +
      pendingEditRequests
        .map(
          (r) => `
      <div class="card">
        <div class="card-main">
          <strong>Cambio propuesto — ${escapeHtml(r.pets?.name ?? "ficha")}</strong>
          <span class="card-meta">${escapeHtml(JSON.stringify(r.proposed_changes))}</span>
        </div>
        <div class="card-actions">
          <button class="btn-secondary" data-approve-edit="${r.id}">Aplicar</button>
          <button class="btn-danger" data-reject-edit="${r.id}">Rechazar</button>
        </div>
      </div>`
        )
        .join("");
  } else {
    pendingPanel.hidden = true;
  }

  list.innerHTML = fichasCache
    .map((p) => {
      const contact = p.pet_owners?.pet_owner_contacts;
      const contactLine = isOwner()
        ? contact
          ? [contact.phone, contact.address].filter(Boolean).join(" · ") || "sin datos de contacto"
          : "sin datos de contacto"
        : "contacto protegido";
      const statusBadge =
        p.review_status === "pending"
          ? '<span class="badge pending">pendiente de revisión</span>'
          : "";
      const photoImg = p.photo_url
        ? `<img class="card-photo" src="${p.photo_url}" alt="Foto de ${escapeHtml(p.name)}" />`
        : "";
      return `
      <div class="card">
        <div class="card-row">
          ${photoImg}
          <div class="card-main">
            <strong>${escapeHtml(p.name)}</strong> ${statusBadge}
            <span class="card-meta">Dueño: ${escapeHtml(p.pet_owners?.full_name ?? "?")} · ${escapeHtml(contactLine)}</span>
            <span class="card-meta">${escapeHtml(p.breed || "raza no especificada")} · ${escapeHtml(p.size || "")} ${p.allergies ? "· ⚠ " + escapeHtml(p.allergies) : ""}</span>
          </div>
        </div>
        <div class="card-actions">
          <button class="btn-secondary" data-view-history="${p.id}">Ver historial</button>
          <button class="btn-secondary" data-propose-edit="${p.id}">Proponer cambio</button>
        </div>
      </div>`;
    })
    .join("");

  if (fichasCache.length === 0) {
    list.innerHTML = '<p class="coming-soon">Todavía no hay fichas registradas.</p>';
  }
}

document.getElementById("btn-new-ficha").addEventListener("click", () => openNewFichaModal());

function openNewFichaModal(onCreated) {
  const existingOwners = [...new Map(fichasCache.map((p) => [p.pet_owners.id, p.pet_owners])).values()];
  openModal(`
    <h3>Nueva ficha</h3>
    <form class="modal-form" id="ficha-form">
      <label>Cliente
        <select id="ficha-owner-select">
          <option value="new">— Cliente nuevo —</option>
          ${existingOwners.map((o) => `<option value="${o.id}">${escapeHtml(o.full_name)}</option>`).join("")}
        </select>
      </label>

      <div id="new-owner-fields">
        <p class="fieldset-title">Datos del dueño</p>
        <label>Nombre completo <input type="text" id="owner-full-name" required /></label>
        <label>Teléfono <input type="text" id="owner-phone" /></label>
        <label>Domicilio <input type="text" id="owner-address" /></label>
        <label>Correo (opcional) <input type="email" id="owner-email" /></label>
      </div>

      <p class="fieldset-title">Datos de la mascota</p>
      <label>Foto (opcional) <input type="file" id="pet-photo" accept="image/*" /></label>
      <label>Nombre <input type="text" id="pet-name" required /></label>
      <label>Raza <input type="text" id="pet-breed" /></label>
      <label>Tamaño
        <select id="pet-size">
          <option value="chico">Chico</option>
          <option value="mediano">Mediano</option>
          <option value="grande">Grande</option>
        </select>
      </label>
      <label>Edad (años) <input type="number" id="pet-age" min="0" step="0.5" /></label>
      <label>Temperamento <input type="text" id="pet-temperament" placeholder="Ej. tranquilo, nervioso, juguetón" /></label>
      <label>Alergias / condiciones especiales <textarea id="pet-allergies" rows="2"></textarea></label>

      ${!isOwner() ? '<p class="form-hint">Como groomer, esta ficha queda <strong>pendiente de revisión</strong> del dueño del negocio antes de quedar en firme — pero ya la puedes usar mientras tanto.</p>' : ""}
      <p class="form-error" id="ficha-form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="ficha-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Guardar</button>
      </div>
    </form>
  `);

  const ownerSelect = document.getElementById("ficha-owner-select");
  const newOwnerFields = document.getElementById("new-owner-fields");
  ownerSelect.addEventListener("change", () => {
    newOwnerFields.hidden = ownerSelect.value !== "new";
  });

  document.getElementById("ficha-cancel").addEventListener("click", closeModal);
  document.getElementById("ficha-form").addEventListener("submit", (e) => submitNewFicha(e, onCreated));
}

async function submitNewFicha(e, onCreated) {
  e.preventDefault();
  const errorEl = document.getElementById("ficha-form-error");
  errorEl.hidden = true;

  const reviewStatus = isOwner() ? "approved" : "pending";
  const ownerSelectValue = document.getElementById("ficha-owner-select").value;

  let petOwnerId = ownerSelectValue;

  if (ownerSelectValue === "new") {
    const fullName = document.getElementById("owner-full-name").value.trim();
    const phone = document.getElementById("owner-phone").value.trim();
    const address = document.getElementById("owner-address").value.trim();
    const email = document.getElementById("owner-email").value.trim();

    const { data: owner, error: ownerError } = await sb
      .from("pet_owners")
      .insert({
        business_id: currentProfile.business_id,
        full_name: fullName,
        review_status: reviewStatus,
        created_by: currentProfile.id,
      })
      .select()
      .single();
    if (ownerError) {
      errorEl.textContent = ownerError.message;
      errorEl.hidden = false;
      return;
    }
    petOwnerId = owner.id;

    const { error: contactError } = await sb.from("pet_owner_contacts").insert({
      pet_owner_id: owner.id,
      business_id: currentProfile.business_id,
      phone,
      address,
      email,
    });
    if (contactError) {
      errorEl.textContent = contactError.message;
      errorEl.hidden = false;
      return;
    }
  }

  const petId = crypto.randomUUID();
  const photoFile = document.getElementById("pet-photo").files[0];
  let photoUrl = null;
  if (photoFile) {
    try {
      photoUrl = await uploadPhoto(photoFile, `pets/${petId}`);
    } catch (err) {
      errorEl.textContent = "No se pudo subir la foto: " + err.message;
      errorEl.hidden = false;
      return;
    }
  }

  const { error: petError } = await sb.from("pets").insert({
    id: petId,
    business_id: currentProfile.business_id,
    pet_owner_id: petOwnerId,
    name: document.getElementById("pet-name").value.trim(),
    breed: document.getElementById("pet-breed").value.trim(),
    size: document.getElementById("pet-size").value,
    age_years: document.getElementById("pet-age").value || null,
    temperament: document.getElementById("pet-temperament").value.trim(),
    allergies: document.getElementById("pet-allergies").value.trim(),
    photo_url: photoUrl,
    review_status: reviewStatus,
    created_by: currentProfile.id,
  });
  if (petError) {
    errorEl.textContent = petError.message;
    errorEl.hidden = false;
    return;
  }

  await loadFichas();
  if (onCreated) {
    onCreated(petId);
  } else {
    closeModal();
  }
}

// ---- Aprobar / rechazar fichas nuevas pendientes (solo dueño) ----
document.getElementById("pending-review-list").addEventListener("click", async (e) => {
  const approveId = e.target.dataset.approveFicha;
  const rejectId = e.target.dataset.rejectFicha;
  const approveEditId = e.target.dataset.approveEdit;
  const rejectEditId = e.target.dataset.rejectEdit;

  if (approveId) {
    const ficha = fichasCache.find((p) => p.id === approveId);
    await sb
      .from("pets")
      .update({ review_status: "approved", reviewed_by: currentProfile.id, reviewed_at: new Date().toISOString() })
      .eq("id", approveId);
    if (ficha?.pet_owners?.review_status === "pending") {
      await sb
        .from("pet_owners")
        .update({ review_status: "approved", reviewed_by: currentProfile.id, reviewed_at: new Date().toISOString() })
        .eq("id", ficha.pet_owners.id);
    }
    await loadFichas();
  }

  if (rejectId) {
    if (!confirm("¿Rechazar y borrar esta ficha propuesta?")) return;
    await sb.from("pets").delete().eq("id", rejectId);
    await loadFichas();
  }

  if (approveEditId) {
    const req = pendingEditRequests.find((r) => r.id === approveEditId);
    if (req) {
      await sb.from("pets").update(req.proposed_changes).eq("id", req.pet_id);
      await sb
        .from("pet_edit_requests")
        .update({ status: "approved", reviewed_by: currentProfile.id, reviewed_at: new Date().toISOString() })
        .eq("id", approveEditId);
    }
    await loadFichas();
  }

  if (rejectEditId) {
    await sb
      .from("pet_edit_requests")
      .update({ status: "rejected", reviewed_by: currentProfile.id, reviewed_at: new Date().toISOString() })
      .eq("id", rejectEditId);
    await loadFichas();
  }
});

// ---- Ver historial de servicios de una ficha ----
document.getElementById("fichas-list").addEventListener("click", async (e) => {
  const petId = e.target.dataset.viewHistory;
  if (!petId) return;
  const pet = fichasCache.find((p) => p.id === petId);
  const { data: history, error } = await sb
    .from("appointments")
    .select("scheduled_at, service_notes, result_photo_url, services(name)")
    .eq("pet_id", petId)
    .eq("status", "completado")
    .order("scheduled_at", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  const rows = (history ?? [])
    .map((h) => {
      const date = new Date(h.scheduled_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" });
      const photo = h.result_photo_url ? `<img class="card-photo" src="${h.result_photo_url}" alt="Resultado" />` : "";
      return `
      <div class="card">
        <div class="card-row">
          ${photo}
          <div class="card-main">
            <strong>${date} — ${escapeHtml(h.services?.name ?? "Servicio")}</strong>
            <span class="card-meta">${escapeHtml(h.service_notes || "sin notas")}</span>
          </div>
        </div>
      </div>`;
    })
    .join("");
  openModal(`
    <h3>Historial — ${escapeHtml(pet?.name ?? "")}</h3>
    <div class="card-list">${rows || '<p class="coming-soon">Todavía no tiene servicios completados.</p>'}</div>
    <div class="modal-actions"><button type="button" class="btn-secondary" id="history-close">Cerrar</button></div>
  `);
  document.getElementById("history-close").addEventListener("click", closeModal);
});

// ---- Proponer cambio a una ficha existente ----
document.getElementById("fichas-list").addEventListener("click", (e) => {
  const petId = e.target.dataset.proposeEdit;
  if (!petId) return;
  const pet = fichasCache.find((p) => p.id === petId);
  openModal(`
    <h3>Proponer cambio — ${escapeHtml(pet.name)}</h3>
    <form class="modal-form" id="edit-request-form">
      <label>Temperamento <input type="text" id="edit-temperament" value="${escapeHtml(pet.temperament || "")}" /></label>
      <label>Alergias / condiciones especiales <textarea id="edit-allergies" rows="2">${escapeHtml(pet.allergies || "")}</textarea></label>
      <p class="form-hint">${isOwner() ? "Como eres el dueño, este cambio se aplica directo." : "Este cambio queda pendiente de tu aprobación como dueño(a) del negocio."}</p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="edit-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Guardar</button>
      </div>
    </form>
  `);
  document.getElementById("edit-cancel").addEventListener("click", closeModal);
  document.getElementById("edit-request-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const changes = {
      temperament: document.getElementById("edit-temperament").value.trim(),
      allergies: document.getElementById("edit-allergies").value.trim(),
    };
    if (isOwner()) {
      await sb.from("pets").update(changes).eq("id", petId);
    } else {
      await sb.from("pet_edit_requests").insert({
        business_id: currentProfile.business_id,
        pet_id: petId,
        proposed_changes: changes,
        submitted_by: currentProfile.id,
      });
    }
    closeModal();
    await loadFichas();
  });
});

// ============================================================
// CATÁLOGO DE SERVICIOS
// ============================================================

let servicesCache = [];

async function loadServices() {
  const { data, error } = await sb.from("services").select("*").order("name");
  if (error) {
    console.error(error);
    return;
  }
  servicesCache = data ?? [];
  renderServices();
}

function renderServices() {
  const tbody = document.getElementById("services-tbody");
  tbody.innerHTML = servicesCache
    .map((s) => {
      const margin = (Number(s.price) - Number(s.estimated_supply_cost)).toFixed(2);
      return `
      <tr>
        <td>${escapeHtml(s.name)}${s.active ? "" : ' <span class="badge">inactivo</span>'}</td>
        <td>${s.duration_minutes} min</td>
        <td>$${Number(s.price).toFixed(2)}</td>
        <td class="owner-only">$${Number(s.estimated_supply_cost).toFixed(2)}</td>
        <td class="owner-only">$${margin}</td>
        <td class="owner-only">
          <button class="btn-secondary" data-edit-service="${s.id}">Editar</button>
          <button class="btn-danger" data-delete-service="${s.id}">Eliminar</button>
        </td>
      </tr>`;
    })
    .join("");
  if (servicesCache.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="coming-soon">Todavía no hay servicios en el catálogo.</td></tr>';
  }
}

document.getElementById("btn-new-service").addEventListener("click", () => openServiceModal(null));

document.getElementById("services-tbody").addEventListener("click", async (e) => {
  const editId = e.target.dataset.editService;
  const deleteId = e.target.dataset.deleteService;
  if (editId) {
    const service = servicesCache.find((s) => s.id === editId);
    openServiceModal(service);
  }
  if (deleteId) {
    if (!confirm("¿Eliminar este servicio del catálogo?")) return;
    await sb.from("services").delete().eq("id", deleteId);
    await loadServices();
  }
});

function openServiceModal(service) {
  const editing = Boolean(service);
  openModal(`
    <h3>${editing ? "Editar servicio" : "Nuevo servicio"}</h3>
    <form class="modal-form" id="service-form">
      <label>Nombre <input type="text" id="service-name" required value="${editing ? escapeHtml(service.name) : ""}" /></label>
      <label>Descripción <input type="text" id="service-description" value="${editing ? escapeHtml(service.description || "") : ""}" /></label>
      <label>Duración (minutos) <input type="number" id="service-duration" required min="1" value="${editing ? service.duration_minutes : 30}" /></label>
      <label>Precio <input type="number" id="service-price" required min="0" step="0.01" value="${editing ? service.price : ""}" /></label>
      <label>Costo estimado de insumos <input type="number" id="service-cost" min="0" step="0.01" value="${editing ? service.estimated_supply_cost : 0}" /></label>
      <label><input type="checkbox" id="service-active" ${editing && !service.active ? "" : "checked"} style="width:auto" /> Activo (visible para agendar)</label>
      <p class="form-error" id="service-form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="service-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Guardar</button>
      </div>
    </form>
  `);

  document.getElementById("service-cancel").addEventListener("click", closeModal);
  document.getElementById("service-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("service-form-error");
    const payload = {
      name: document.getElementById("service-name").value.trim(),
      description: document.getElementById("service-description").value.trim(),
      duration_minutes: Number(document.getElementById("service-duration").value),
      price: Number(document.getElementById("service-price").value),
      estimated_supply_cost: Number(document.getElementById("service-cost").value || 0),
      active: document.getElementById("service-active").checked,
    };
    const { error } = editing
      ? await sb.from("services").update(payload).eq("id", service.id)
      : await sb.from("services").insert({ ...payload, business_id: currentProfile.business_id });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    closeModal();
    await loadServices();
  });
}

// ============================================================
// CALENDARIO
// ============================================================

let selectedDate = new Date();
let appointmentsCache = [];
let groomersCache = []; // profiles con role = 'groomer'

async function loadGroomers() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, full_name")
    .eq("role", "groomer")
    .order("full_name");
  if (error) {
    console.error(error);
    return;
  }
  groomersCache = data ?? [];
}

function dayBoundsISO(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("es-MX", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

async function loadAppointments() {
  const { startISO, endISO } = dayBoundsISO(selectedDate);
  const { data, error } = await sb
    .from("appointments")
    .select("*, pets(name), services(name), groomer:profiles!groomer_id(full_name)")
    .gte("scheduled_at", startISO)
    .lt("scheduled_at", endISO)
    .order("scheduled_at");
  if (error) {
    console.error(error);
    return;
  }
  appointmentsCache = data ?? [];
  document.getElementById("day-label").textContent = DAY_LABEL_FORMAT.format(selectedDate);
  renderAppointments();
}

const STATUS_LABELS = {
  agendado: "Agendado",
  confirmado: "Confirmado",
  en_proceso: "En proceso",
  completado: "Completado",
  cancelado: "Cancelado",
  no_show: "No se presentó",
};

function renderAppointments() {
  const list = document.getElementById("appointments-list");
  if (appointmentsCache.length === 0) {
    list.innerHTML = '<p class="coming-soon">No hay citas agendadas este día.</p>';
    return;
  }
  list.innerHTML = appointmentsCache
    .map((a) => {
      const time = new Date(a.scheduled_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      const statusOptions = Object.entries(STATUS_LABELS)
        .map(([val, label]) => `<option value="${val}" ${a.status === val ? "selected" : ""}>${label}</option>`)
        .join("");
      return `
      <div class="card">
        <div class="card-main">
          <strong>${time} — ${escapeHtml(a.pets?.name ?? "?")}</strong>
          <span class="card-meta">${escapeHtml(a.services?.name ?? "?")} · ${a.duration_minutes} min · $${Number(a.price_charged).toFixed(2)}</span>
          <span class="card-meta">Groomer: ${escapeHtml(a.groomer?.full_name ?? "sin asignar")}</span>
        </div>
        <div class="card-actions owner-only">
          <select class="status-select" data-status-for="${a.id}">${statusOptions}</select>
          <button class="btn-danger" data-delete-appointment="${a.id}">Eliminar</button>
        </div>
        <div class="card-actions"><span class="badge">${STATUS_LABELS[a.status] ?? a.status}</span></div>
      </div>`;
    })
    .join("");
}

document.getElementById("day-prev").addEventListener("click", () => {
  selectedDate.setDate(selectedDate.getDate() - 1);
  loadAppointments();
});
document.getElementById("day-next").addEventListener("click", () => {
  selectedDate.setDate(selectedDate.getDate() + 1);
  loadAppointments();
});
document.getElementById("day-today").addEventListener("click", () => {
  selectedDate = new Date();
  loadAppointments();
});

// ---- Vista de mes (para ver disponibilidad en otros días) ----
let calMonthDate = new Date();
const WEEKDAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

document.getElementById("cal-mode-day").addEventListener("click", () => {
  document.getElementById("cal-mode-day").classList.add("active");
  document.getElementById("cal-mode-month").classList.remove("active");
  document.getElementById("cal-day-view").hidden = false;
  document.getElementById("cal-month-view").hidden = true;
});
document.getElementById("cal-mode-month").addEventListener("click", () => {
  document.getElementById("cal-mode-month").classList.add("active");
  document.getElementById("cal-mode-day").classList.remove("active");
  document.getElementById("cal-day-view").hidden = true;
  document.getElementById("cal-month-view").hidden = false;
  loadMonthGrid();
});
document.getElementById("cal-month-prev").addEventListener("click", () => {
  calMonthDate = new Date(calMonthDate.getFullYear(), calMonthDate.getMonth() - 1, 1);
  loadMonthGrid();
});
document.getElementById("cal-month-next").addEventListener("click", () => {
  calMonthDate = new Date(calMonthDate.getFullYear(), calMonthDate.getMonth() + 1, 1);
  loadMonthGrid();
});

async function loadMonthGrid() {
  const { startISO, endISO } = monthBoundsISO(calMonthDate);
  const { data, error } = await sb
    .from("appointments")
    .select("scheduled_at")
    .neq("status", "cancelado")
    .gte("scheduled_at", startISO)
    .lt("scheduled_at", endISO);
  if (error) {
    console.error(error);
    return;
  }

  const countsByDay = {};
  (data ?? []).forEach((a) => {
    const d = new Date(a.scheduled_at).getDate();
    countsByDay[d] = (countsByDay[d] || 0) + 1;
  });

  document.getElementById("cal-month-label").textContent = MONTH_LABEL_FORMAT.format(calMonthDate);

  const year = calMonthDate.getFullYear();
  const month = calMonthDate.getMonth();
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const today = new Date();

  let html = WEEKDAY_LABELS.map((l) => `<div class="weekday-label">${l}</div>`).join("");
  for (let i = 0; i < firstDayOfWeek; i++) {
    html += `<div class="month-day is-empty"></div>`;
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
    const count = countsByDay[day];
    html += `<div class="month-day ${isToday ? "is-today" : ""}" data-day="${day}">
      <span>${day}</span>
      ${count ? `<span class="count-badge">${count}</span>` : ""}
    </div>`;
  }
  document.getElementById("month-grid").innerHTML = html;
}

document.getElementById("month-grid").addEventListener("click", (e) => {
  const dayEl = e.target.closest(".month-day[data-day]");
  if (!dayEl) return;
  selectedDate = new Date(calMonthDate.getFullYear(), calMonthDate.getMonth(), Number(dayEl.dataset.day));
  loadAppointments();
  document.getElementById("cal-mode-day").click();
});

document.getElementById("appointments-list").addEventListener("change", async (e) => {
  const apptId = e.target.dataset.statusFor;
  if (!apptId) return;
  const newStatus = e.target.value;
  await sb.from("appointments").update({ status: newStatus }).eq("id", apptId);
  if (newStatus === "completado") {
    await autoCreateIncomeForAppointment(apptId);
    await loadAppointments();
    openServiceDetailsModal(apptId);
    return;
  }
  await loadAppointments();
});

// Al completar una cita, ofrece capturar qué se hizo + foto del resultado,
// para tenerlo de referencia en la ficha del perro la próxima visita.
function openServiceDetailsModal(apptId) {
  const appt = appointmentsCache.find((a) => a.id === apptId);
  openModal(`
    <h3>Detalles del servicio — ${escapeHtml(appt?.pets?.name ?? "")}</h3>
    <form class="modal-form" id="service-details-form">
      <label>¿Qué se le hizo? (para la próxima visita)
        <textarea id="service-notes" rows="3">${escapeHtml(appt?.service_notes || "")}</textarea>
      </label>
      <label>Foto del resultado (opcional) <input type="file" id="service-photo" accept="image/*" /></label>
      <p class="form-hint">Puedes omitirlo y agregarlo después desde el historial de la ficha.</p>
      <p class="form-error" id="service-details-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="service-details-skip">Omitir por ahora</button>
        <button type="submit" class="btn-primary">Guardar</button>
      </div>
    </form>
  `);
  document.getElementById("service-details-skip").addEventListener("click", closeModal);
  document.getElementById("service-details-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("service-details-error");
    const notes = document.getElementById("service-notes").value.trim();
    const photoFile = document.getElementById("service-photo").files[0];
    let photoUrl = appt?.result_photo_url || null;
    if (photoFile) {
      try {
        photoUrl = await uploadPhoto(photoFile, `appointments/${apptId}`);
      } catch (err) {
        errorEl.textContent = "No se pudo subir la foto: " + err.message;
        errorEl.hidden = false;
        return;
      }
    }
    await sb.from("appointments").update({ service_notes: notes, result_photo_url: photoUrl }).eq("id", apptId);
    closeModal();
    await loadAppointments();
  });
}

// Al completar una cita, registra el ingreso automáticamente en Finanzas
// (si no existe ya uno ligado a esa cita) para no capturarlo dos veces.
async function autoCreateIncomeForAppointment(apptId) {
  const { data: existing } = await sb
    .from("transactions")
    .select("id")
    .eq("appointment_id", apptId)
    .maybeSingle();
  if (existing) return;

  const appt = appointmentsCache.find((a) => a.id === apptId);
  if (!appt) return;

  await sb.from("transactions").insert({
    business_id: currentProfile.business_id,
    type: "ingreso",
    amount: appt.price_charged,
    description: `${appt.services?.name ?? "Servicio"} — ${appt.pets?.name ?? ""}`,
    category: "servicio",
    appointment_id: apptId,
    occurred_on: appt.scheduled_at.slice(0, 10),
    created_by: currentProfile.id,
  });
}

document.getElementById("appointments-list").addEventListener("click", async (e) => {
  const deleteId = e.target.dataset.deleteAppointment;
  if (!deleteId) return;
  if (!confirm("¿Eliminar esta cita?")) return;
  await sb.from("appointments").delete().eq("id", deleteId);
  await loadAppointments();
});

document.getElementById("btn-new-appointment").addEventListener("click", openNewAppointmentModal);

function openNewAppointmentModal(preselectPetId) {
  const approvedPets = fichasCache.filter((p) => p.review_status === "approved");
  const activeServices = servicesCache.filter((s) => s.active);
  const defaultDate = selectedDate.toISOString().slice(0, 10);

  openModal(`
    <h3>Nueva cita</h3>
    <form class="modal-form" id="appointment-form">
      <label>Mascota
        <select id="appt-pet" required>
          <option value="">— Selecciona —</option>
          ${approvedPets.map((p) => `<option value="${p.id}" ${p.id === preselectPetId ? "selected" : ""}>${escapeHtml(p.name)} (${escapeHtml(p.pet_owners?.full_name ?? "")})</option>`).join("")}
        </select>
        <button type="button" class="btn-link" id="appt-new-pet-btn" style="align-self:flex-start;margin-top:4px">+ Es un perrito nuevo, sin ficha</button>
      </label>
      <label>Servicio
        <select id="appt-service" required>
          <option value="">— Selecciona —</option>
          ${activeServices.map((s) => `<option value="${s.id}" data-duration="${s.duration_minutes}" data-price="${s.price}">${escapeHtml(s.name)} (${s.duration_minutes} min, $${Number(s.price).toFixed(2)})</option>`).join("")}
        </select>
      </label>
      <label>Groomer asignado (opcional)
        <select id="appt-groomer">
          <option value="">— Sin asignar —</option>
          ${groomersCache.map((g) => `<option value="${g.id}">${escapeHtml(g.full_name)}</option>`).join("")}
        </select>
      </label>
      <label>Fecha <input type="date" id="appt-date" required value="${defaultDate}" /></label>
      <label>Hora <input type="time" id="appt-time" required value="10:00" /></label>
      <label>Duración (minutos) <input type="number" id="appt-duration" required min="1" /></label>
      <label>Precio a cobrar <input type="number" id="appt-price" required min="0" step="0.01" /></label>
      <p class="form-error" id="appointment-form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="appointment-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Agendar</button>
      </div>
    </form>
  `);

  document.getElementById("appt-new-pet-btn").addEventListener("click", () => {
    openNewFichaModal((newPetId) => openNewAppointmentModal(newPetId));
  });

  const serviceSelect = document.getElementById("appt-service");
  serviceSelect.addEventListener("change", () => {
    const opt = serviceSelect.selectedOptions[0];
    if (opt && opt.dataset.duration) {
      document.getElementById("appt-duration").value = opt.dataset.duration;
      document.getElementById("appt-price").value = opt.dataset.price;
    }
  });

  document.getElementById("appointment-cancel").addEventListener("click", closeModal);
  document.getElementById("appointment-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("appointment-form-error");
    errorEl.hidden = true;
    const date = document.getElementById("appt-date").value;
    const time = document.getElementById("appt-time").value;
    const durationMinutes = Number(document.getElementById("appt-duration").value);
    const groomerId = document.getElementById("appt-groomer").value || null;
    const scheduledAt = new Date(`${date}T${time}:00`);
    const scheduledEnd = new Date(scheduledAt.getTime() + durationMinutes * 60000);

    // 1. Dentro del horario del negocio ("turno")
    const opens = currentBusiness?.opens_at?.slice(0, 5) || "00:00";
    const closes = currentBusiness?.closes_at?.slice(0, 5) || "23:59";
    const endTimeStr = scheduledEnd.toTimeString().slice(0, 5);
    if (time < opens || endTimeStr > closes) {
      errorEl.textContent = `El negocio abre de ${opens} a ${closes}. Esta cita (termina ${endTimeStr}) queda fuera de ese horario.`;
      errorEl.hidden = false;
      return;
    }

    // 2. El groomer elegido no puede tener ya otra cita encimada ese horario
    if (groomerId) {
      const { startISO: dayStart, endISO: dayEnd } = dayBoundsISO(scheduledAt);
      const { data: sameDay } = await sb
        .from("appointments")
        .select("scheduled_at, duration_minutes, pets(name)")
        .eq("groomer_id", groomerId)
        .neq("status", "cancelado")
        .gte("scheduled_at", dayStart)
        .lt("scheduled_at", dayEnd);
      const conflict = (sameDay ?? []).find((a) => {
        const existingStart = new Date(a.scheduled_at);
        const existingEnd = new Date(existingStart.getTime() + a.duration_minutes * 60000);
        return existingStart < scheduledEnd && existingEnd > scheduledAt;
      });
      if (conflict) {
        const groomerName = groomersCache.find((g) => g.id === groomerId)?.full_name ?? "Ese groomer";
        errorEl.textContent = `${groomerName} ya tiene una cita (${escapeHtml(conflict.pets?.name ?? "otro perro")}) en ese horario. Elige otro groomer o cambia la hora.`;
        errorEl.hidden = false;
        return;
      }
    }

    const { error } = await sb.from("appointments").insert({
      business_id: currentProfile.business_id,
      pet_id: document.getElementById("appt-pet").value,
      service_id: document.getElementById("appt-service").value,
      groomer_id: groomerId,
      scheduled_at: scheduledAt.toISOString(),
      duration_minutes: durationMinutes,
      price_charged: Number(document.getElementById("appt-price").value),
      created_by: currentProfile.id,
    });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    closeModal();
    selectedDate = new Date(`${date}T00:00:00`);
    await loadAppointments();
  });
}

// ============================================================
// FINANZAS
// ============================================================

let financeMonth = new Date();
let transactionsCache = [];

const MONTH_LABEL_FORMAT = new Intl.DateTimeFormat("es-MX", { month: "long", year: "numeric" });

function monthBoundsDateStr(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startStr: fmt(start), endStr: fmt(end) };
}

function monthBoundsISO(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

async function loadTransactions() {
  const { startStr, endStr } = monthBoundsDateStr(financeMonth);
  const { data, error } = await sb
    .from("transactions")
    .select("*")
    .gte("occurred_on", startStr)
    .lt("occurred_on", endStr)
    .order("occurred_on", { ascending: false });
  if (error) {
    console.error(error);
    return;
  }
  transactionsCache = data ?? [];

  // Margen real de servicios completados este mes (precio cobrado - costo
  // estimado de insumos del catálogo) — distinto del balance de caja, que
  // también incluye egresos que no son de un servicio puntual (renta, etc.)
  const { startISO, endISO } = monthBoundsISO(financeMonth);
  const { data: completedAppts } = await sb
    .from("appointments")
    .select("price_charged, services(estimated_supply_cost)")
    .eq("status", "completado")
    .gte("scheduled_at", startISO)
    .lt("scheduled_at", endISO);
  const margin = (completedAppts ?? []).reduce(
    (sum, a) => sum + (Number(a.price_charged) - Number(a.services?.estimated_supply_cost ?? 0)),
    0
  );

  document.getElementById("month-label").textContent = MONTH_LABEL_FORMAT.format(financeMonth);
  renderTransactions(margin);
}

function renderTransactions(margin) {
  const ingresos = transactionsCache.filter((t) => t.type === "ingreso").reduce((s, t) => s + Number(t.amount), 0);
  const egresos = transactionsCache.filter((t) => t.type === "egreso").reduce((s, t) => s + Number(t.amount), 0);

  document.getElementById("sum-ingresos").textContent = "$" + ingresos.toFixed(2);
  document.getElementById("sum-egresos").textContent = "$" + egresos.toFixed(2);
  document.getElementById("sum-balance").textContent = "$" + (ingresos - egresos).toFixed(2);
  document.getElementById("sum-margin").textContent = "$" + margin.toFixed(2);

  const list = document.getElementById("transactions-list");
  if (transactionsCache.length === 0) {
    list.innerHTML = '<p class="coming-soon">No hay movimientos este mes.</p>';
    return;
  }
  list.innerHTML = transactionsCache
    .map((t) => {
      const sign = t.type === "ingreso" ? "+" : "−";
      return `
      <div class="card">
        <div class="card-main">
          <strong>${sign}$${Number(t.amount).toFixed(2)} — ${escapeHtml(t.description || t.category || "")}</strong>
          <span class="card-meta">${t.occurred_on} · ${escapeHtml(t.category || "sin categoría")}${t.appointment_id ? " · generado por una cita" : ""}</span>
        </div>
        <div class="card-actions">
          <button class="btn-danger" data-delete-transaction="${t.id}">Eliminar</button>
        </div>
      </div>`;
    })
    .join("");
}

document.getElementById("month-prev").addEventListener("click", () => {
  financeMonth = new Date(financeMonth.getFullYear(), financeMonth.getMonth() - 1, 1);
  loadTransactions();
});
document.getElementById("month-next").addEventListener("click", () => {
  financeMonth = new Date(financeMonth.getFullYear(), financeMonth.getMonth() + 1, 1);
  loadTransactions();
});
document.getElementById("month-today").addEventListener("click", () => {
  financeMonth = new Date();
  loadTransactions();
});

document.getElementById("transactions-list").addEventListener("click", async (e) => {
  const deleteId = e.target.dataset.deleteTransaction;
  if (!deleteId) return;
  if (!confirm("¿Eliminar este movimiento?")) return;
  await sb.from("transactions").delete().eq("id", deleteId);
  await loadTransactions();
});

document.getElementById("btn-new-transaction").addEventListener("click", openNewTransactionModal);

function openNewTransactionModal() {
  const todayStr = new Date().toISOString().slice(0, 10);
  openModal(`
    <h3>Nuevo movimiento</h3>
    <form class="modal-form" id="transaction-form">
      <label>Tipo
        <select id="txn-type">
          <option value="ingreso">Ingreso</option>
          <option value="egreso">Egreso</option>
        </select>
      </label>
      <label>Monto <input type="number" id="txn-amount" required min="0" step="0.01" /></label>
      <label>Descripción <input type="text" id="txn-description" /></label>
      <label>Categoría
        <select id="txn-category">
          <option value="servicio">Servicio</option>
          <option value="insumos">Insumos</option>
          <option value="renta">Renta</option>
          <option value="sueldos">Sueldos</option>
          <option value="otro">Otro</option>
        </select>
      </label>
      <label>Fecha <input type="date" id="txn-date" required value="${todayStr}" /></label>
      <p class="form-error" id="transaction-form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="transaction-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Guardar</button>
      </div>
    </form>
  `);

  document.getElementById("transaction-cancel").addEventListener("click", closeModal);
  document.getElementById("transaction-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("transaction-form-error");
    const { error } = await sb.from("transactions").insert({
      business_id: currentProfile.business_id,
      type: document.getElementById("txn-type").value,
      amount: Number(document.getElementById("txn-amount").value),
      description: document.getElementById("txn-description").value.trim(),
      category: document.getElementById("txn-category").value,
      occurred_on: document.getElementById("txn-date").value,
      created_by: currentProfile.id,
    });
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    closeModal();
    await loadTransactions();
  });
}

// ============================================================
// PERSONAL
// ============================================================

function renderGroomers() {
  const list = document.getElementById("groomers-list");
  if (groomersCache.length === 0) {
    list.innerHTML = '<p class="coming-soon">Todavía no has dado de alta a ningún groomer.</p>';
    return;
  }
  list.innerHTML = groomersCache
    .map(
      (g) => `
      <div class="card">
        <div class="card-main"><strong>${escapeHtml(g.full_name)}</strong> <span class="card-meta">Groomer</span></div>
        <div class="card-actions">
          <button class="btn-secondary" data-edit-groomer-ficha="${g.id}">Ver/editar ficha</button>
          <button class="btn-danger" data-remove-groomer="${g.id}">Quitar del negocio</button>
        </div>
      </div>`
    )
    .join("");
}

document.getElementById("groomers-list").addEventListener("click", async (e) => {
  const removeId = e.target.dataset.removeGroomer;
  const editId = e.target.dataset.editGroomerFicha;

  if (removeId) {
    if (!confirm("¿Quitar a este groomer del negocio? Ya no podrá entrar a Pelukan (su cuenta de acceso no se borra, solo pierde el vínculo con tu negocio).")) return;
    await sb.from("profiles").delete().eq("id", removeId);
    await loadGroomers();
    renderGroomers();
    return;
  }

  if (editId) {
    await openGroomerFichaModal(editId);
  }
});

// ---- Ficha completa del groomer (igual a la de personal en Todo Guau,
// sin la sección de compensación/nómina) ----
async function openGroomerFichaModal(profileId) {
  const groomer = groomersCache.find((g) => g.id === profileId);
  const { data: details } = await sb.from("staff_details").select("*").eq("profile_id", profileId).maybeSingle();
  const d = details || {};

  openModal(`
    <h3>Ficha de personal — ${escapeHtml(groomer?.full_name ?? "")}</h3>
    <form class="modal-form" id="groomer-ficha-form">
      <p class="fieldset-title">Datos del groomer</p>
      <label>Teléfono <input type="tel" id="gf-phone" value="${escapeHtml(d.phone || "")}" /></label>
      <label>Fecha de nacimiento <input type="date" id="gf-birth-date" value="${d.birth_date || ""}" /></label>
      <label>Domicilio <input type="text" id="gf-address" value="${escapeHtml(d.address || "")}" /></label>
      <label>CURP <input type="text" id="gf-curp" value="${escapeHtml(d.curp || "")}" /></label>

      <p class="fieldset-title">Contacto de emergencia</p>
      <label>Nombre y relación <input type="text" id="gf-emergency-name" placeholder='Ej. "Lourdes, mamá"' value="${escapeHtml(d.emergency_contact_name || "")}" /></label>
      <label>Teléfono <input type="tel" id="gf-emergency-phone" value="${escapeHtml(d.emergency_contact_phone || "")}" /></label>

      <p class="fieldset-title">Médico</p>
      <label>Tipo de sangre <input type="text" id="gf-blood-type" placeholder="Ej. O+" value="${escapeHtml(d.blood_type || "")}" /></label>
      <label>Condiciones médicas <textarea id="gf-medical-conditions" rows="2">${escapeHtml(d.medical_conditions || "")}</textarea></label>
      <label>Medicamentos <textarea id="gf-medications" rows="2">${escapeHtml(d.medications || "")}</textarea></label>
      <label>Alergias <textarea id="gf-allergies" rows="2">${escapeHtml(d.allergies || "")}</textarea></label>

      <p class="fieldset-title">Otro</p>
      <label>Notas <textarea id="gf-notes" rows="2">${escapeHtml(d.notes || "")}</textarea></label>
      <label>Estado
        <select id="gf-status">
          <option value="activo" ${d.status !== "inactivo" ? "selected" : ""}>Activo</option>
          <option value="inactivo" ${d.status === "inactivo" ? "selected" : ""}>Inactivo</option>
        </select>
      </label>

      <p class="form-error" id="groomer-ficha-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="groomer-ficha-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Guardar</button>
      </div>
    </form>
  `);

  document.getElementById("groomer-ficha-cancel").addEventListener("click", closeModal);
  document.getElementById("groomer-ficha-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("groomer-ficha-error");
    const { error } = await sb.from("staff_details").upsert(
      {
        profile_id: profileId,
        business_id: currentProfile.business_id,
        phone: document.getElementById("gf-phone").value.trim(),
        birth_date: document.getElementById("gf-birth-date").value || null,
        address: document.getElementById("gf-address").value.trim(),
        curp: document.getElementById("gf-curp").value.trim(),
        emergency_contact_name: document.getElementById("gf-emergency-name").value.trim(),
        emergency_contact_phone: document.getElementById("gf-emergency-phone").value.trim(),
        blood_type: document.getElementById("gf-blood-type").value.trim(),
        medical_conditions: document.getElementById("gf-medical-conditions").value.trim(),
        medications: document.getElementById("gf-medications").value.trim(),
        allergies: document.getElementById("gf-allergies").value.trim(),
        notes: document.getElementById("gf-notes").value.trim(),
        status: document.getElementById("gf-status").value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id" }
    );
    if (error) {
      errorEl.textContent = error.message;
      errorEl.hidden = false;
      return;
    }
    closeModal();
  });
}

function updateBusinessHoursSummary() {
  const opens = (currentBusiness?.opens_at || "09:00").slice(0, 5);
  const closes = (currentBusiness?.closes_at || "18:00").slice(0, 5);
  document.getElementById("business-hours-summary-text").textContent = `${opens} a ${closes}`;
}

function toggleBusinessHoursForm(editing) {
  document.getElementById("business-hours-summary").hidden = editing;
  document.getElementById("business-hours-form").hidden = !editing;
}

document.getElementById("business-hours-edit-btn").addEventListener("click", () => toggleBusinessHoursForm(true));
document.getElementById("business-hours-cancel-btn").addEventListener("click", () => {
  document.getElementById("business-opens").value = (currentBusiness.opens_at || "09:00").slice(0, 5);
  document.getElementById("business-closes").value = (currentBusiness.closes_at || "18:00").slice(0, 5);
  toggleBusinessHoursForm(false);
});

document.getElementById("business-hours-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const opens = document.getElementById("business-opens").value;
  const closes = document.getElementById("business-closes").value;
  const { error } = await sb
    .from("businesses")
    .update({ opens_at: opens, closes_at: closes })
    .eq("id", currentProfile.business_id);
  if (!error) {
    currentBusiness.opens_at = opens;
    currentBusiness.closes_at = closes;
    updateBusinessHoursSummary();
    toggleBusinessHoursForm(false);
  }
});

document.getElementById("btn-new-groomer").addEventListener("click", () => {
  openModal(`
    <h3>Nuevo groomer</h3>
    <form class="modal-form" id="groomer-form">
      <label>Nombre completo <input type="text" id="groomer-full-name" required /></label>
      <label>Correo (con el que va a entrar a Pelukan) <input type="email" id="groomer-email" required /></label>
      <label>Contraseña <input type="password" id="groomer-password" required minlength="6" /></label>
      <p class="form-hint">Dale estos datos al groomer para que pueda iniciar sesión. No hay confirmación por correo, la cuenta queda lista de inmediato.</p>
      <p class="form-error" id="groomer-form-error" hidden></p>
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="groomer-cancel">Cancelar</button>
        <button type="submit" class="btn-primary">Crear cuenta</button>
      </div>
    </form>
  `);
  document.getElementById("groomer-cancel").addEventListener("click", closeModal);
  document.getElementById("groomer-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById("groomer-form-error");
    const submitBtn = e.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;

    const { data: sessionData } = await sb.auth.getSession();
    const token = sessionData.session?.access_token;

    try {
      const resp = await fetch("/api/create-groomer", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          fullName: document.getElementById("groomer-full-name").value.trim(),
          email: document.getElementById("groomer-email").value.trim(),
          password: document.getElementById("groomer-password").value,
        }),
      });
      const result = await resp.json();
      if (!resp.ok) {
        errorEl.textContent = result.error || "No se pudo crear la cuenta";
        errorEl.hidden = false;
        submitBtn.disabled = false;
        return;
      }
    } catch (err) {
      errorEl.textContent =
        "No se pudo contactar al servidor. Si estás probando en localhost, esto solo funciona una vez desplegado en Vercel.";
      errorEl.hidden = false;
      submitBtn.disabled = false;
      return;
    }

    closeModal();
    await loadGroomers();
    renderGroomers();
  });
});

// ============================================================
// Utilidades
// ============================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
