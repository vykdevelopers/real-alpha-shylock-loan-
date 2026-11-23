/*
  Real Alpha Shylock Loan: script.js
  ----------------------------------
  Settings (Supabase URL and key) live in js/config.js, not here.

  Sections: helpers, hero slider, form checks, Supabase connection,
  signed-out area (log in, sign up, reset password), signed-in area
  (application form and personal dashboard), staff review, animations.
*/

"use strict";

const CONFIG = window.APP_CONFIG || {};
const $=s=>document.querySelector(s);
const labelText=i=>{
  const l=i.labels&&i.labels[0];
  return l?l.textContent.replace(/\*/g,"").trim():"this field"
};
function flag(input,msg){
  input.setCustomValidity(msg);
  input.reportValidity();
  const clear=()=>{
    input.setCustomValidity("");
    input.removeEventListener("input",clear);
    input.removeEventListener("change",clear)
  };
  input.addEventListener("input",clear);
  input.addEventListener("change",clear);
}

$("#year").textContent=new Date().getFullYear();
$("#portalBtn").onclick=()=>$("#apply").scrollIntoView({behavior:"smooth"});

// Hero amount slider feeds the application form.
const amt=$("#amt"),out=$("#amtOut");
const fmt=n=>"KSh "+Number(n).toLocaleString("en-KE");
amt.oninput=()=>{
  out.textContent=fmt(amt.value)
};
$("#useAmt").onclick=()=>{
  $("#loanAmount").value=amt.value
};
document.querySelectorAll("[data-type]").forEach(a=>a.onclick=()=>{
  $("#loanType").value=a.dataset.type
});

// Spouse name is needed only when married.
const ms=$("#maritalStatus"),sp=$("#spouseName");
function spouse(){
  const m=ms.value==="Married";
  sp.disabled=!m;
  sp.required=m;
  if(!m)sp.value=""
}

ms.onchange=spouse;
spouse();

const phoneOk=v=>/^(?:\+254|0)[17]\d{8}$/.test(v.trim());
function imageError(i){
  const f=i.files&&i.files[0],n=labelText(i);
  if(!f)return "Please select your "+n+".";
  if(!["image/jpeg","image/png","image/webp"].includes(f.type))return "Use a JPG, PNG or WebP image for "+n+".";
  if(f.size>5*1024*1024)return n+" must be 5 MB or smaller.";
  return "";
}

// ============================================================
// SUPABASE CONNECTION
// ============================================================
// URL and key come from js/config.js. Without them the page still loads,
// but accounts stay switched off and a notice explains why.
const sb = CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY && window.supabase
  ? window.supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY)
  : null;

const STATUS_LABEL = {
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Not approved"
};

// ---------- Small helpers ----------
function say(box, text, kind) {
  box.textContent = text;
  box.className = "msg show " + kind;
}

function clearMsg(box) {
  box.className = "msg";
  box.textContent = "";
}

function el(tag, text, cls) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (cls) node.className = cls;
  return node;
}

const money = (n) => "KSh " + Number(n).toLocaleString("en-KE");
const dateOf = (t) => new Date(t).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
const refOf = (id) => "RAS-" + String(id).slice(0, 8).toUpperCase();

function friendly(error, fallback) {
  const m = (error && error.message) || "";
  if (/rate limit|too many|seconds/i.test(m)) return "Too many attempts. Please wait a few minutes and try again.";
  if (/invalid login/i.test(m)) return "Wrong email or password.";
  return fallback || m || "Something went wrong. Please try again.";
}

function strongPassword(pw) {
  return pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw);
}

function needSb(box) {
  if (sb) return false;
  say(box, "Accounts are not connected yet. The site owner needs to add the Supabase settings.", "err");
  return true;
}

// ============================================================
// SIGNED-OUT AREA: log in, create account, confirm email, reset password
// ============================================================
const VIEWS = ["login", "signup", "verify", "forgot", "reset"];
let pendingEmail = ""; // email waiting for a confirmation or reset code
let recovering = false; // true while a password reset is half-finished
let justSignedIn = false; // used to scroll to the application after login

function showView(name) {
  VIEWS.forEach((v) => $("#" + v + "Form").classList.toggle("hidden", v !== name));
  $("#authTabs").classList.toggle("hidden", name !== "login" && name !== "signup");
  document.querySelectorAll("#authTabs .tab").forEach((tab) => {
    const on = tab.dataset.view === name;
    tab.classList.toggle("on", on);
    tab.setAttribute("aria-selected", String(on));
  });
  document.querySelectorAll(".view .msg").forEach(clearMsg);
}

document.querySelectorAll("#authTabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => showView(tab.dataset.view));
});
document.querySelectorAll("[data-goto]").forEach((link) => {
  link.addEventListener("click", () => showView(link.dataset.goto));
});

// Show / hide password buttons
document.querySelectorAll(".eye").forEach((btn) => {
  btn.addEventListener("click", () => {
    const input = $("#" + btn.dataset.for);
    const reveal = input.type === "password";
    input.type = reveal ? "text" : "password";
    btn.textContent = reveal ? "Hide" : "Show";
    btn.setAttribute("aria-pressed", String(reveal));
  });
});

// Create account
$("#signupForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = $("#signupMsg");
  clearMsg(msg);
  if (needSb(msg) || !form.reportValidity()) return;

  const name = $("#suName").value.trim();
  const email = $("#suEmail").value.trim().toLowerCase();
  const pw = $("#suPass").value;
  if (!strongPassword(pw)) return say(msg, "Use at least 8 characters with letters and numbers.", "err");
  if (pw !== $("#suPass2").value) return say(msg, "The passwords do not match.", "err");

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  const { data, error } = await sb.auth.signUp({
    email,
    password: pw,
    options: { data: { full_name: name } }
  });
  btn.disabled = false;

  if (error) return say(msg, friendly(error), "err");
  // Supabase returns an empty identities list when the email is already taken.
  if (data.user && data.user.identities && data.user.identities.length === 0) {
    return say(msg, "This email already has an account. Please log in or reset your password.", "err");
  }
  form.reset();
  if (data.session) { justSignedIn = true; return; } // email confirmation is switched off
  pendingEmail = email;
  $("#verifyEmail").textContent = email;
  showView("verify");
});

// Confirm email with the 6-digit code
$("#verifyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#verifyMsg");
  clearMsg(msg);
  if (needSb(msg) || !e.currentTarget.reportValidity()) return;
  justSignedIn = true;
  const { error } = await sb.auth.verifyOtp({
    email: pendingEmail,
    token: $("#vCode").value.trim(),
    type: "signup"
  });
  if (error) {
    justSignedIn = false;
    return say(msg, "That code is wrong or has expired. Request a new one.", "err");
  }
  e.currentTarget.reset();
});

$("#resendBtn").addEventListener("click", async () => {
  const msg = $("#verifyMsg");
  if (needSb(msg) || !pendingEmail) return;
  const { error } = await sb.auth.resend({ type: "signup", email: pendingEmail });
  error ? say(msg, friendly(error), "err") : say(msg, "A new code is on its way.", "ok");
});

// Log in
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = $("#loginMsg");
  clearMsg(msg);
  if (needSb(msg) || !form.reportValidity()) return;

  const email = $("#liEmail").value.trim().toLowerCase();
  const requestedRole = $("#loginRole").value;
  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  checkingRole = true; // keep the page unchanged until the role is confirmed
  const finish = () => { checkingRole = false; btn.disabled = false; };
  const reject = async (text) => {
    await sb.auth.signOut();
    finish();
    say(msg, text, "err");
  };

  const { data: signIn, error } = await sb.auth.signInWithPassword({ email, password: $("#liPass").value });
  if (error) {
    finish();
    if (/not confirmed/i.test(error.message)) {
      pendingEmail = email;
      $("#verifyEmail").textContent = email;
      await sb.auth.resend({ type: "signup", email });
      showView("verify");
      return say($("#verifyMsg"), "Please confirm your email first. We sent you a new code.", "ok");
    }
    return say(msg, friendly(error), "err");
  }

  const { data: staffRecord, error: roleError } = await sb
    .from("staff").select("user_id").eq("user_id", signIn.user.id).maybeSingle();
  if (roleError) return reject("Could not verify account permissions. Please try again.");

  const isStaff = !!staffRecord;
  if (requestedRole === "staff" && !isStaff) {
    return reject("This account has not been authorised for staff access. Contact the system administrator.");
  }
  if (requestedRole === "customer" && isStaff) {
    return reject("This is a staff account. Please choose \u201cReal Alpha staff\u201d to sign in.");
  }

  form.reset();
  justSignedIn = !isStaff; // customers jump to their application; staff open the review screen
  finish();
  applySession(signIn.session);
  if (isStaff) openStaff();
});

// Forgot password: email a reset code
$("#forgotForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#forgotMsg");
  clearMsg(msg);
  if (needSb(msg) || !e.currentTarget.reportValidity()) return;

  const email = $("#fgEmail").value.trim().toLowerCase();
  const { error } = await sb.auth.resetPasswordForEmail(email);
  if (error && /rate limit|too many|seconds/i.test(error.message)) return say(msg, friendly(error), "err");

  // Same message whether or not the account exists, so nobody can probe for emails.
  pendingEmail = email;
  showView("reset");
  say($("#resetMsg"), "If an account exists for " + email + ", a reset code is on its way.", "ok");
});

// Enter the reset code and choose a new password
$("#resetForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = $("#resetMsg");
  if (needSb(msg) || !form.reportValidity()) return;

  const pw = $("#rsPass").value;
  if (!strongPassword(pw)) return say(msg, "Use at least 8 characters with letters and numbers.", "err");
  if (pw !== $("#rsPass2").value) return say(msg, "The passwords do not match.", "err");

  recovering = true; // keep the form on screen until the new password is saved
  const check = await sb.auth.verifyOtp({ email: pendingEmail, token: $("#rsCode").value.trim(), type: "recovery" });
  if (check.error) {
    recovering = false;
    return say(msg, "That code is wrong or has expired. Request a new one.", "err");
  }
  const save = await sb.auth.updateUser({ password: pw });
  if (save.error) {
    recovering = false;
    return say(msg, friendly(save.error, "Could not save the new password. Please try again."), "err");
  }
  recovering = false;
  form.reset();
  justSignedIn = true;
  const { data } = await sb.auth.getSession();
  applySession(data.session);
});

// ============================================================
// SIGNED-IN AREA: application form and personal dashboard
// ============================================================
let currentUser = null;
let sessionStarted = false; // false until the first session check has drawn the page
let checkingRole = false; // true while login is confirming customer/staff role

// Wipe everything personal from the screen (used on logout or when the user changes).
function clearPrivateScreens() {
  staffApps = [];
  ["#staffBody", "#kpis", "#staffDetail", "#myApps", "#myKpis", "#mySavings"].forEach((sel) => {
    const node = $(sel);
    if (node) node.textContent = "";
  });
  $("#staffDetail").classList.add("hidden");
  $("#staffDash").classList.add("hidden");
  staffBox.classList.add("hidden");
  staffHint("");
  $("#loanForm").reset();
  spouse();
  clearMsg($("#loanMsg"));
  clearMsg($("#dashMsg"));
}

function applySession(session) {
  const user = session ? session.user : null;
  if (user && currentUser && currentUser.id === user.id) return; // token refresh, nothing to redraw
  if (!user && !currentUser && sessionStarted) return; // already signed out, keep any message on screen
  sessionStarted = true;
  if (currentUser && (!user || currentUser.id !== user.id)) clearPrivateScreens();
  currentUser = user;
  $("#authBox").classList.toggle("hidden", !!user);
  $("#memberBox").classList.toggle("hidden", !user);

  if (!user) {
    showView("login");
    return;
  }
  const name = (user.user_metadata && user.user_metadata.full_name) || user.email;
  $("#who").textContent = name;
  $("#whoMail").textContent = user.email;
  prefillForm();
  switchPanel("apply"); // logging in takes you straight to your application
  if (justSignedIn) {
    justSignedIn = false;
    $("#apply").scrollIntoView({ behavior: "smooth" });
  }
}

function prefillForm() {
  if (!currentUser) return;
  $("#email").value = currentUser.email;
  const name = currentUser.user_metadata && currentUser.user_metadata.full_name;
  if (name && !$("#fullName").value) $("#fullName").value = name;
}

function switchPanel(name) {
  $("#applyPanel").classList.toggle("hidden", name !== "apply");
  $("#dashPanel").classList.toggle("hidden", name !== "dash");
  document.querySelectorAll(".mtab").forEach((tab) => {
    const on = tab.dataset.panel === name;
    tab.classList.toggle("on", on);
    tab.setAttribute("aria-selected", String(on));
  });
  if (name === "dash") loadMyApps();
}

document.querySelectorAll(".mtab").forEach((tab) => {
  tab.addEventListener("click", () => switchPanel(tab.dataset.panel));
});

$("#logoutBtn").addEventListener("click", async () => {
  if (sb) await sb.auth.signOut();
});

if (sb) {
  // Do not call Supabase inside this callback: hand off with setTimeout.
  sb.auth.onAuthStateChange((event, session) => {
    if (recovering || checkingRole) return;
    setTimeout(() => applySession(session), 0);
  });
  sb.auth.getSession().then(({ data }) => {
    if (!recovering) applySession(data.session);
  });
} else {
  $("#cfgWarn").classList.remove("hidden");
}

// ---------- Submit an application ----------
$("#loanForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const msg = $("#loanMsg");
  clearMsg(msg);
  if (needSb(msg)) return;
  if (!currentUser) return say(msg, "Please log in first.", "err");

  const amountInput = $("#loanAmount");
  const amount = Number(amountInput.value);
  if (amountInput.value && (!Number.isFinite(amount) || amount < 5000 || amount > 50000)) {
    return flag(amountInput, "Enter an amount between KSh 5,000 and KSh 50,000.");
  }
  if (amountInput.value && amount % 500 !== 0) return flag(amountInput, "Enter an amount in steps of KSh 500.");

  const phone = $("#phone");
  const gPhone = $("#guarantorPhone");
  if (phone.value && !phoneOk(phone.value)) return flag(phone, "Enter a valid Kenyan mobile number, for example 0712345678.");
  if (gPhone.value && !phoneOk(gPhone.value)) return flag(gPhone, "Enter a valid Kenyan mobile number for the guarantor.");
  if (phone.value && gPhone.value && phone.value.trim() === gPhone.value.trim()) {
    return flag(gPhone, "The guarantor's phone number must differ from yours.");
  }
  const idNumber = $("#idNumber");
  if (idNumber.value && !/^\d{6,10}$/.test(idNumber.value.trim())) return flag(idNumber, "Enter a valid National ID number (digits only).");
  if (!form.reportValidity()) return;

  const files = { passport: $("#passportPhoto"), id_front: $("#idFront"), id_back: $("#idBack") };
  for (const input of Object.values(files)) {
    const problem = imageError(input);
    if (problem) return say(msg, problem, "err");
  }

  const btn = form.querySelector("button[type=submit]");
  btn.disabled = true;
  say(msg, "Uploading your documents and application. Please wait...", "ok");

  try {
    const id = crypto.randomUUID();
    const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const paths = {};
    for (const [key, input] of Object.entries(files)) {
      const file = input.files[0];
      const path = currentUser.id + "/" + id + "/" + key + "." + ext[file.type];
      const { error } = await sb.storage.from("documents").upload(path, file, { contentType: file.type });
      if (error) throw error;
      paths[key] = path;
    }
    const v = (field) => $("#" + field).value.trim();
    const { error } = await sb.from("applications").insert({
      id,
      full_name: v("fullName"),
      phone: v("phone"),
      id_number: v("idNumber"),
      loan_amount: amount,
      loan_type: v("loanType"),
      marital_status: v("maritalStatus"),
      spouse_name: v("spouseName") || null,
      guarantor_name: v("guarantorName"),
      guarantor_phone: v("guarantorPhone"),
      purpose_details: v("purposeDetails"),
      passport_path: paths.passport,
      id_front_path: paths.id_front,
      id_back_path: paths.id_back
    });
    if (error) throw error;

    clearMsg(msg);
    form.reset();
    spouse();
    prefillForm();
    switchPanel("dash");
    say($("#dashMsg"), "Application " + refOf(id) + " submitted. We will review it and update your progress here.", "ok");
  } catch (err) {
    say(msg, friendly(err, "Could not submit your application. Please try again."), "err");
  }
  btn.disabled = false;
});

// ---------- Personal dashboard ----------
function trackFor(status) {
  const step = status === "submitted" ? 0 : status === "under_review" ? 1 : 2;
  const last = status === "approved" ? "Approved" : status === "rejected" ? "Not approved" : "Decision";
  const labels = ["Submitted", "Under review", last];
  const list = el("ol", null, "track");
  labels.forEach((label, i) => {
    const li = el("li", label);
    if (i < step) li.className = "done";
    if (i === step) li.className = status === "rejected" ? "bad" : status === "approved" ? "done" : "now";
    list.append(li);
  });
  return list;
}

async function loadMyApps() {
  const box = $("#myApps");
  const kpis = $("#myKpis");
  box.textContent = "Loading...";
  const { data, error } = await sb
    .from("applications")
    .select("id, loan_type, loan_amount, status, staff_note, created_at, updated_at")
    .eq("user_id", currentUser.id)
    .order("created_at", { ascending: false });

  if (error) {
    box.textContent = "";
    return say($("#dashMsg"), "Could not load your applications. Please refresh.", "err");
  }
  box.textContent = "";
  kpis.textContent = "";
  const active = data.filter((a) => a.status === "submitted" || a.status === "under_review").length;
  const approved = data.filter((a) => a.status === "approved").length;
  [["Applications", data.length], ["In progress", active], ["Approved", approved]].forEach(([label, n]) => {
    const d = el("div");
    d.append(el("b", n), el("span", label));
    kpis.append(d);
  });

  const savingsBox = $("#mySavings");
  if (savingsBox) {
    const savingsResult = await sb.from("savings").select("id, amount, note, recorded_at")
      .eq("user_id", currentUser.id).order("recorded_at", { ascending: false });
    savingsBox.textContent = "";
    if (savingsResult.error) {
      savingsBox.textContent = "Savings information is not available right now.";
    } else if (!savingsResult.data.length) {
      savingsBox.textContent = "No savings entries have been recorded yet.";
    } else {
      const total = savingsResult.data.reduce((sum, item) => sum + Number(item.amount), 0);
      savingsBox.append(el("p", "Total recorded savings: " + money(total)));
      savingsResult.data.forEach(item => {
        const line = el("p", money(item.amount) + " · " + dateOf(item.recorded_at) + (item.note ? " · " + item.note : ""));
        savingsBox.append(line);
      });
    }
  }

  if (!data.length) {
    box.append(el("p", "You have not applied yet. Open the Loan application tab to start.", "empty"));
    return;
  }
  data.forEach((a) => {
    const card = el("article", null, "appcard");
    const head = document.createElement("header");
    const title = el("div");
    title.append(el("h3", a.loan_type + ", " + money(a.loan_amount)), el("small", "Reference " + refOf(a.id) + " · applied " + dateOf(a.created_at)));
    head.append(title, el("small", "Updated " + dateOf(a.updated_at)));
    card.append(head, trackFor(a.status));
    if (a.staff_note) card.append(el("div", "Message from our team: " + a.staff_note, "note-from-staff"));
    box.append(card);
  });
}
$("#refreshBtn").addEventListener("click", loadMyApps);

// ============================================================
// STAFF REVIEW (needs a staff account, see supabase/schema.sql)
// ============================================================
const staffBox = $("#staff");
let staffApps = [];

function staffHint(text) {
  const hint = $("#staffHint");
  hint.textContent = text;
  hint.classList.toggle("hidden", !text);
}

async function openStaff() {
  staffBox.classList.remove("hidden");
  $("#staffDash").classList.add("hidden");
  $("#staffDetail").classList.add("hidden");
  if (!sb) return staffHint("Accounts are not connected yet.");
  if (!currentUser) return staffHint("Log in with your staff account first, then open Staff again.");
  staffHint("Checking access...");
  const { data } = await sb.from("staff").select("user_id").eq("user_id", currentUser.id).maybeSingle();
  if (!data) return staffHint("This account does not have staff access.");
  staffHint("");
  $("#staffDash").classList.remove("hidden");
  await loadStaffApps();
}

async function loadStaffApps() {
  const { data, error } = await sb.from("applications").select("*").order("created_at", { ascending: false });
  if (error) return staffHint("Could not load applications: " + error.message);
  staffApps = data;
  drawStaff();
}

function drawStaff() {
  const filter = $("#flt").value;
  const q = $("#q").value.trim().toLowerCase();
  const rows = staffApps.filter((a) =>
    (!filter || a.status === filter) &&
    (!q || [a.full_name, a.phone, a.email, refOf(a.id)].some((t) => String(t || "").toLowerCase().includes(q)))
  );

  const kpis = $("#kpis");
  kpis.textContent = "";
  const count = (s) => staffApps.filter((a) => a.status === s).length;
  [["Total", staffApps.length], ["Submitted", count("submitted")], ["Under review", count("under_review")], ["Approved", count("approved")], ["Not approved", count("rejected")]]
    .forEach(([label, n]) => {
      const d = el("div");
      d.append(el("b", n), el("span", label));
      kpis.append(d);
    });

  const body = $("#staffBody");
  body.textContent = "";
  if (!rows.length) {
    const tr = el("tr");
    const td = el("td", "No applications to show.");
    td.colSpan = 7;
    tr.append(td);
    body.append(tr);
    return;
  }
  rows.forEach((a) => {
    const tr = el("tr");
    const who = el("td", a.full_name);
    who.append(el("small", a.email || ""));
    const select = el("select", null, "statsel");
    select.setAttribute("aria-label", "Status for " + a.full_name);
    Object.entries(STATUS_LABEL).forEach(([value, label]) => {
      const o = el("option", label);
      o.value = value;
      o.selected = a.status === value;
      select.append(o);
    });
    select.addEventListener("change", () => saveStaff(a.id, { status: select.value }));
    const statusCell = el("td");
    statusCell.append(select);
    const view = el("button", "View", "act");
    view.type = "button";
    view.addEventListener("click", () => showDetail(a.id));
    const act = el("td");
    act.append(view);
    tr.append(el("td", refOf(a.id)), who, el("td", a.phone), el("td", a.loan_type), el("td", money(a.loan_amount)), statusCell, act);
    body.append(tr);
  });
}

async function saveStaff(id, patch) {
  const { error } = await sb.from("applications").update(patch).eq("id", id);
  if (error) {
    staffHint("Could not save: " + error.message);
    drawStaff();
    return false;
  }
  staffHint("");
  const row = staffApps.find((a) => a.id === id);
  if (row) Object.assign(row, patch);
  drawStaff();
  return true;
}

async function showDetail(id) {
  const a = staffApps.find((x) => x.id === id);
  const box = $("#staffDetail");
  box.textContent = "";
  box.classList.remove("hidden");
  box.append(el("h3", refOf(a.id) + ": " + a.full_name));

  const dl = el("dl");
  [["Email", a.email], ["Phone", a.phone], ["National ID", a.id_number], ["Loan", a.loan_type + ", " + money(a.loan_amount)],
   ["Marital status", a.marital_status + (a.spouse_name ? " (spouse: " + a.spouse_name + ")" : "")],
   ["Guarantor", a.guarantor_name + ", " + a.guarantor_phone], ["Purpose", a.purpose_details], ["Applied", dateOf(a.created_at)], ["Last reviewed", a.reviewed_at ? dateOf(a.reviewed_at) : "Not yet"]]
    .forEach(([k, v]) => dl.append(el("dt", k), el("dd", v || "")));
  box.append(dl);

  const docs = el("div", null, "docs");
  [["Passport photo", a.passport_path], ["ID front", a.id_front_path], ["ID back", a.id_back_path]].forEach(([label, path]) => {
    const b = el("button", "Open " + label, "act");
    b.type = "button";
    b.addEventListener("click", async () => {
      const { data, error } = await sb.storage.from("documents").createSignedUrl(path, 120); // link works for 2 minutes
      if (error) return staffHint("Could not open the document: " + error.message);
      window.open(data.signedUrl, "_blank", "noopener");
    });
    docs.append(b);
  });
  box.append(docs);

  const label = el("label", "Message shown to the customer (optional)");
  label.htmlFor = "staffNote";
  const note = el("textarea");
  note.id = "staffNote";
  note.rows = 3;
  note.maxLength = 1000;
  note.value = a.staff_note || "";
  const save = el("button", "Save message", "btn btn-gold");
  save.type = "button";
  save.addEventListener("click", async () => {
    if (await saveStaff(a.id, { staff_note: note.value.trim() || null })) staffHint("Message saved.");
  });
  box.append(label, note, save);

  const savingsTitle = el("h3", "Customer savings");
  box.append(savingsTitle);
  const savingsList = el("div");
  savingsList.textContent = "Loading savings…";
  box.append(savingsList);
  const savingsResult = await sb.from("savings").select("*").eq("user_id", a.user_id).order("recorded_at", { ascending: false });
  savingsList.textContent = "";
  if (savingsResult.error) {
    savingsList.textContent = "Could not load savings records.";
  } else {
    const total = savingsResult.data.reduce((sum, item) => sum + Number(item.amount), 0);
    savingsList.append(el("p", "Total recorded savings: " + money(total)));
    if (!savingsResult.data.length) savingsList.append(el("p", "No savings recorded."));
    savingsResult.data.forEach(item => savingsList.append(
      el("p", money(item.amount) + " · " + dateOf(item.recorded_at) + (item.note ? " · " + item.note : ""))
    ));
  }

  const addTitle = el("h4", "Record a savings entry");
  const amountInput = el("input");
  amountInput.type = "number"; amountInput.min = "1"; amountInput.step = "1";
  amountInput.placeholder = "Amount in KSh"; amountInput.required = true;
  amountInput.setAttribute("aria-label", "Savings amount in Kenyan shillings");
  const noteInput = el("input");
  noteInput.type = "text"; noteInput.maxLength = 250; noteInput.placeholder = "Note (optional)";
  noteInput.setAttribute("aria-label", "Savings note");
  const addButton = el("button", "Save savings entry", "btn btn-gold");
  addButton.type = "button";
  addButton.addEventListener("click", async () => {
    const amount = Number(amountInput.value);
    if (!Number.isSafeInteger(amount) || amount < 1) return staffHint("Enter a valid whole-number savings amount.");
    addButton.disabled = true;
    const result = await sb.from("savings").insert({
      user_id: a.user_id, application_id: a.id, amount, note: noteInput.value.trim() || null,
      recorded_by: currentUser.id
    });
    addButton.disabled = false;
    if (result.error) return staffHint("Could not record savings: " + result.error.message);
    staffHint("Savings entry recorded.");
    showDetail(a.id);
  });
  box.append(addTitle, amountInput, noteInput, addButton);
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#flt").addEventListener("change", drawStaff);
$("#q").addEventListener("input", drawStaff);

$("#csv").addEventListener("click", () => {
  const cell = (v) => {
    v = String(v == null ? "" : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v; // stops spreadsheet formula injection
    return '"' + v.replace(/"/g, '""') + '"';
  };
  const cols = ["id", "full_name", "email", "phone", "id_number", "loan_type", "loan_amount", "status", "guarantor_name", "guarantor_phone", "purpose_details", "created_at"];
  const csv = [cols.join(",")].concat(staffApps.map((a) => cols.map((c) => cell(a[c])).join(","))).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = "applications.csv";
  link.click();
  URL.revokeObjectURL(link.href);
});

$("#staffBtn").addEventListener("click", (e) => {
  e.preventDefault();
  openStaff();
});
$("#staffClose").addEventListener("click", () => staffBox.classList.add("hidden"));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") staffBox.classList.add("hidden");
});

// Reveal the CEO portrait when it scrolls into view.
document.documentElement.classList.add("js");
const pt=$("#portrait");
if("IntersectionObserver" in window){
  new IntersectionObserver((en,ob)=>en.forEach(x=>{
    if(x.isIntersecting){
      pt.classList.add("in");
      ob.disconnect()
    }
    }),{threshold:.25}).observe(pt)
}else{
  pt.classList.add("in")
}

// Small round photos reuse the main portrait image.
document.querySelectorAll(".av img").forEach(i=>{
  i.src="assets/ceo.webp";
  i.onerror=()=>{i.style.display="none"};
});
