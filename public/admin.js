'use strict';

const root = document.getElementById('admin-root');

function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'text') node.textContent = value;
    else if (key === 'class') node.className = value;
    else if (value != null) node.setAttribute(key, value);
  }
  for (const kid of kids.flat()) {
    if (kid != null) node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'ServerDash' },
    ...opts,
  });
  let data = {};
  try { data = await res.json(); } catch { /* */ }
  if (!res.ok) throw new Error(data.error || 'تعذّر تنفيذ الطلب.');
  return data;
}

function login() {
  const email = el('input', { class: 'input ltr', type: 'email', placeholder: 'البريد الإلكتروني', required: 'true', autocomplete: 'email' });
  const password = el('input', { class: 'input ltr', type: 'password', placeholder: 'كلمة المرور', required: 'true', autocomplete: 'current-password' });
  const error = el('div', { class: 'alert hidden' });
  const form = el('form', {},
    el('div', { class: 'field' }, el('label', { text: 'البريد الإلكتروني' }), email),
    el('div', { class: 'field' }, el('label', { text: 'كلمة المرور' }), password),
    error,
    el('button', { class: 'btn primary', type: 'submit', text: 'دخول لوحة الإدارة' }),
  );
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    error.classList.add('hidden');
    try {
      await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: email.value, password: password.value }) });
      await boot();
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove('hidden');
    }
  });
  root.replaceChildren(el('section', { class: 'card login' },
    el('div', { class: 'brand' }, el('div', { class: 'logo', text: 'SD' }), el('div', {}, el('p', { class: 'eyebrow', text: 'ServerDash' }), el('h1', { text: 'لوحة الإدارة' }))),
    el('p', { class: 'sub', text: 'سجّل الدخول بحساب المدير للوصول إلى إحصاءات المنصة.' }),
    form,
  ));
  email.focus();
}

function formatDate(value) {
  return value ? new Date(value).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

function dashboard(data, user) {
  const users = data.users || [];
  const servers = data.servers || [];
  const online = servers.filter((server) => server.status === 'online').length;
  const userRows = users.map((item) => el('tr', {},
    el('td', { text: item.name }),
    el('td', { class: 'ltr', text: item.email }),
    el('td', {}, el('span', { class: `badge ${item.role === 'admin' ? '' : 'user'}`, text: item.role === 'admin' ? 'مدير' : 'مستخدم' })),
    el('td', { text: String(item.servers) }),
    el('td', { class: 'muted', text: formatDate(item.createdAt) }),
  ));
  const serverRows = servers.map((item) => el('tr', {},
    el('td', { text: item.name }),
    el('td', { class: 'ltr', text: `${item.host}:${item.port}` }),
    el('td', { class: 'ltr', text: item.username }),
    el('td', { text: item.status }),
    el('td', { class: 'muted', text: formatDate(item.createdAt) }),
  ));
  const table = (headers, rows, empty) => rows.length
    ? el('div', { class: 'table-wrap' }, el('table', {},
      el('thead', {}, el('tr', {}, headers.map((header) => el('th', { text: header })))),
      el('tbody', {}, rows),
    ))
    : el('div', { class: 'empty', text: empty });

  root.replaceChildren(el('div', { class: 'wrap' },
    el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('div', { class: 'logo', text: 'SD' }), el('div', {},
        el('p', { class: 'eyebrow', text: 'ServerDash' }),
        el('h1', { class: 'title', text: 'لوحة الإدارة' }),
        el('p', { class: 'sub', text: `مرحبًا ${user.name} — تحكم ومراقبة الحسابات والسيرفرات.` }),
      )),
      el('div', {},
        el('a', { class: 'btn', href: '/', text: 'العودة للتطبيق' }), ' ',
        el('button', { class: 'btn', text: 'خروج', onclick: async () => { await api('/api/auth/logout', { method: 'POST' }); login(); } }),
      ),
    ),
    el('main', { class: 'dashboard' },
      el('section', { class: 'stats' },
        el('div', { class: 'card stat' }, el('b', { text: String(users.length) }), el('span', { text: 'إجمالي المستخدمين' })),
        el('div', { class: 'card stat' }, el('b', { text: String(servers.length) }), el('span', { text: 'السيرفرات المضافة' })),
        el('div', { class: 'card stat' }, el('b', { text: String(online) }), el('span', { text: 'بوتات متصلة الآن' })),
      ),
      el('section', { class: 'card' },
        el('div', { class: 'section-head' }, el('h2', { text: 'المستخدمون' }), el('span', { class: 'muted', text: `${users.length} حساب` })),
        table(['الاسم', 'البريد', 'الصلاحية', 'السيرفرات', 'تاريخ الإنشاء'], userRows, 'لا يوجد مستخدمون بعد.'),
      ),
      el('section', { class: 'card' },
        el('div', { class: 'section-head' }, el('h2', { text: 'السيرفرات' }), el('span', { class: 'muted', text: `${servers.length} سيرفر` })),
        table(['الاسم', 'العنوان', 'اسم البوت', 'الحالة', 'تاريخ الإضافة'], serverRows, 'لا توجد سيرفرات مضافة.'),
      ),
    ),
  ));
}

async function boot() {
  try {
    const session = await api('/api/session');
    if (!session.user) return login();
    if (session.user.role !== 'admin') {
      root.replaceChildren(el('section', { class: 'card login' }, el('h1', { text: 'غير مصرح' }), el('p', { class: 'sub', text: 'هذا المسار مخصص للمدير فقط.' }), el('a', { class: 'btn', href: '/', text: 'العودة' })));
      return;
    }
    dashboard(await api('/api/admin/overview'), session.user);
  } catch (error) {
    root.replaceChildren(el('section', { class: 'card login' }, el('div', { class: 'alert', text: error.message }), el('button', { class: 'btn', text: 'إعادة المحاولة', onclick: boot })));
  }
}

boot();
