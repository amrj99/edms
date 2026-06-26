# ArcScale EDMS — Feature Inventory
> **الحالة الفعلية للنظام** — ليس Roadmap.  
> يُحدَّث بعد كل ميزة أو إصلاح مكتمل.  
> آخر تحديث: 2026-06-26 | Commit: `4ba0ca1`

---

## كيفية القراءة

| الرمز | المعنى |
|-------|--------|
| ✅ | مُنفَّذ ومختبر ويعمل في الإنتاج |
| ⚠️ | مُنفَّذ لكن به قيد أو مشكلة معروفة |
| 🔒 | مُنفَّذ لكن محجوب بـ Plan Gate |
| ❌ | غير مُنفَّذ |

---

## 1. Authentication & Security

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Login بـ Email + Password | ✅ | JWT HS256 + bcrypt cost 12 |
| Refresh Token rotation | ✅ | يُحدَّث عند كل استخدام، يُحفظ SHA-256 في DB |
| Progressive login lockout | ✅ | 7 محاولات / 15 دقيقة، تتصاعد لـ 30 دقيقة |
| Forgot Password (email reset) | ✅ | Token مُستخدَم مرة واحدة، منتهي الصلاحية |
| Admin Reset Password | ✅ | POST /api/users/:id/reset-password — يمسح mustChangePassword |
| Set Password (onboarding invitation) | ✅ | Token من الدعوة، يمسح mustChangePassword |
| Terms of Use (first login) | ✅ | يتطلب Scroll + قبول |
| Registration (self-signup) | ✅ | مفتوح حالياً — موصى بـ Hybrid Gated مستقبلاً |
| CSRF Protection | ✅ | JWT في header (لا cookies) |
| File upload MIME checking | ✅ | Magic bytes + blocklist |
| Rate limiting | ✅ | Per-endpoint، escalating للـ password reset |

---

## 2. Organizations & Multi-Tenancy

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Multiple organizations | ✅ | كل org معزولة تماماً |
| Organization types | ✅ | client/consultant/contractor/subcontractor |
| Org creation (system_owner) | ✅ | POST /api/organizations — يتطلب system_owner |
| Org editing (admin = own org فقط) | ✅ | تم إصلاح R2 — admin org-scoped |
| Org listing (admin = own فقط) | ✅ | GET /api/organizations — admin يرى org-ه فقط |
| Org listing (system_owner = all) | ✅ | system_owner يرى الكل |
| Org config (storage, AI, quotas) | ✅ | org_config table |
| Plan/subscription management | ✅ | plans.ts — expired/starter/basic/professional/enterprise |
| Storage quotas | ✅ | موجودة في code، تحتاج enforcement في upload |
| Trial (14 days) | ✅ | trial_ends_at، يُنزل تلقائياً لـ "expired" |
| Default Document Types عند إنشاء org | ❌ | **غير مُنفَّذ — الأولوية التالية** |
| Default Workflow Template عند إنشاء org | ❌ | **غير مُنفَّذ — الأولوية التالية** |

---

## 3. Users & Roles

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| 6 أدوار | ✅ | system_owner > admin > project_manager > document_controller > reviewer > viewer |
| User creation (admin+) | ✅ | POST /api/users — requireMinRole("admin") |
| User listing | ✅ | org-scoped للـ admin، all للـ system_owner |
| User editing | ✅ | org-boundary enforced |
| User deactivation | ✅ | isActive=false — يمنع الـ login |
| Password reset (admin) | ✅ | يمسح mustChangePassword (إصلاح B1) |
| Project-level role override | ✅ | project_members.role — override الـ org role |
| Delegations | ✅ | مستخدم يُفوِّض صلاحياته لآخر لفترة |
| User invitation via email | ✅ | invitation token → set-password page |
| Resend invitation (UI) | ❌ | لا يوجد زر Resend في Admin UI |
| "Pending Invitation" status display | ❌ | لا يظهر في Users list |
| mustChangePassword cleared on admin reset | ✅ | إصلاح B1 — commit c214db7 |

---

## 4. Projects

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| إنشاء مشروع (PM+) | ✅ | |
| Project members | ✅ | إضافة/إزالة + project-level role |
| Project status | ✅ | active/on_hold/completed/cancelled |
| Cross-org project access | ❌ | **Design Decision** — org boundary لا يُتجاوز |
| Folders داخل المشروع | ✅ | هرمية، drag & drop في UI |
| Project portfolio في Dashboard | ✅ | نسب Active/On Hold/Completed |

---

## 5. Documents

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Upload Document (single) | ✅ | Dialog بـ 3 sections + inline validation |
| Bulk Upload | ✅ | Multi-file، form per file |
| Document metadata | ✅ | Discipline, Type, Rev, Status, Issued By, Source |
| Custom metadata fields | ✅ | Dynamic per Document Type، grandfathering |
| Document Types (dynamic) | ✅ | Per org، admin يُدير |
| Global metadata fields | ✅ | بدون documentTypeId — تظهر لكل أنواع |
| Document Number (immutable) | ✅ | لا يتغير بعد الإنشاء |
| Auto-generated doc number | ✅ | حسب numbering template الـ org |
| Inline doc-number validation | ✅ | Real-time check أثناء الكتابة |
| Revision history | ✅ | document_revisions table، عرض في UI |
| Document status lifecycle | ✅ | draft → under_review → approved → issued → superseded |
| Status badges (unified) | ✅ | إصلاح R3 — موحّدة بألوان متسقة |
| Title tooltip on truncation | ✅ | إصلاح R4 — title attribute |
| Edit document metadata | ✅ | DC أو creator |
| Document detail page | ✅ | Overview/Revisions/Activity/AI Analysis tabs |
| AI Analysis tab | ⚠️ | Tab ظاهر لكن يعرض "Coming Soon" عند VITE_AI_ENABLED=false |
| Share links (external access) | ✅ | per-token rate limit، expiry، password optional |
| Confidential flag | ✅ | Department-based access control |
| Document comparison (rev diff) | ❌ | |
| Email import to project | ❌ | |
| Server sync folder | ❌ | |
| Bulk actions | ✅ | Select + Create Transmittal / Bulk Status Change |

---

## 6. Master Document Register

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Master Register (Reports → Registers) | ✅ | Server-side filtering/sorting/pagination (إصلاح M2) |
| Excel export | ✅ | يصدّر الصفوف المفلترة حسب الأعمدة المرئية |
| PDF export | ✅ | jsPDF، Unicode خارج Latin يظهر كـ "yy" (pre-existing) |
| Print | ✅ | `window.print()` |
| Bulk status change | ✅ | من المستندات المُحددة |
| "View in Master Register" من المشروع | ✅ | إصلاح M4 — pre-filter للمشروع |
| Column visibility toggle | ✅ | |
| Sub-registers | ✅ | Correspondence / Transmittal / Drawing / ITR-MIR / NCR-SOR / NOC |
| Saved Views | ❌ | |
| Column sort (UI headers) | ❌ | Backend يدعم sortBy — frontend headers غير قابلة للنقر |

---

## 7. Workflow Engine

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Workflow Templates (per org + per doc type) | ✅ | قابلة للتهيئة من Admin |
| Sequential stages | ✅ | responsible_role أو responsible_user |
| canAct من Backend | ✅ | enrichInstance() — لا static role list |
| Multi-user workflow | ✅ | DC → Reviewer → Admin — مختبر |
| Notifications by role | ✅ | يُحل المستلمون بـ responsibleRole |
| "My Actions" view | ✅ | amber banner + filter + badge |
| Document link في Workflow instance | ✅ | نقرة واحدة لفتح المستند |
| Workflow history (transitions) | ✅ | Immutable audit |
| Default template عند إنشاء org | ⚠️ | يعمل في أول deploy بعد إضافة مستخدم — لا trigger فوري |
| Workflow للمنظمات الجديدة | ⚠️ | 4 templates تظهر بعد أول deploy (General/Drawing/Correspondence/Contract) |
| SLA / deadline per stage | ❌ | |

---

## 8. Correspondence

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| إنشاء مراسلة (RFI, NCR, Instruction...) | ✅ | |
| To + CC recipients | ✅ | |
| Reference Number (auto) | ✅ | |
| Due Date + requires_response | ✅ | |
| SLA tracking (unread, no-response, due-soon) | ✅ | |
| Threaded replies | ✅ | Parent-child |
| Project-linked أو General | ✅ | |
| Status (open/closed/overdue) | ✅ | |
| Document reference | ✅ | |
| External file attachments | ❌ | يمكن مرفق مستند من النظام فقط |
| Inbox-style layout | ✅ | Folders: Incoming/Outgoing/Drafts/Archive |
| Direction (in/out) | ✅ | |

---

## 9. Transmittals

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| إنشاء Transmittal | 🔒 | Professional+ plan |
| ABCD review codes | 🔒 | Professional+ |
| Outgoing / Incoming | 🔒 | Professional+ |
| Response tracking | 🔒 | Professional+ |
| External share link | 🔒 | Professional+ |
| Complete Review authorization | ✅ | org-scoped — إصلاح security |

---

## 10. Tasks

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| إنشاء Task (My Tasks) | ✅ | |
| Task من Project Tasks tab | ✅ | إصلاح R5 — زر "+ Add Task" |
| Priority / Status / Due Date | ✅ | |
| Assign to user | ✅ | |
| Overdue indication | ✅ | |
| Tasks من Meetings (auto) | ❌ | |
| Tasks من Correspondence | ❌ | |

---

## 11. Meetings & Calendar

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| إنشاء اجتماع | ✅ | |
| Attendees | ✅ | |
| Meeting notes | ✅ | |
| Calendar view | ✅ | |
| Meeting minutes → auto Task extraction | ❌ | |
| AI meeting summary | ❌ | |

---

## 12. Reports & Registers

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Master Register (Documents) | ✅ | مع server-side filtering |
| Correspondence Register | ✅ | |
| Transmittal Register | 🔒 | Professional+ |
| Drawing Register | ✅ | |
| ITR / MIR | 🔒 | Professional+ |
| NCR / SOR | 🔒 | Professional+ |
| NOC | ✅ | |
| Excel export (Registers) | ✅ | |
| PDF export | ✅ | |
| Print | ✅ | |
| Report generator (custom filters → export) | ❌ | Dashboard shows stats فقط |
| Scheduled reports | ❌ | |

---

## 13. Search

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Global search (instant) | ✅ | Documents + Correspondence |
| Search by Doc No. + Title | ✅ | |
| Search scoped to org | ✅ | |
| Fuzzy search | ❌ | Exact/ILIKE فقط |
| Full-text search (file content) | ❌ | |

---

## 14. Dashboard

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| KPI cards (Docs, Approvals, Tasks, Projects) | ✅ | |
| Documents by Status (donut chart) | ✅ | |
| Project Portfolio (active/on-hold/...) | ✅ | |
| Overdue Items | ✅ | |
| Open ITR/MIR, NCR/SOR, NOC | ✅ | |
| Open Correspondence | ✅ | |
| Recent Documents | ✅ | |
| Dashboard customization | ✅ | Widget toggle |
| Date filtering on dashboard | ❌ | |
| Export dashboard data | ❌ | |

---

## 15. Notifications

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| In-app notifications | ✅ | Bell icon + counter |
| Email notifications | ✅ | Resend — إذا RESEND_API_KEY مضبوط |
| Notification types | ✅ | Document upload/approval/rejection، Workflow، Correspondence |
| Mark as read | ✅ | |
| Notification center (all notifications) | ⚠️ | Bell فقط — لا صفحة مستقلة |

---

## 16. Admin Panel

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| User management | ✅ | Create/Edit/Disable/Reset Password |
| Organization management | ✅ | system_owner فقط للـ cross-org |
| Document Types management | ✅ | Admin UI + Detail page |
| Metadata Fields management | ✅ | Global + per Document Type |
| Workflow Templates | ✅ | Create/Edit/Delete |
| Correspondence Types | ✅ | |
| Document Numbering format | ✅ | Configurable per org |
| Audit Log viewer | ✅ | org-scoped + search + export |
| Access Shadow Log | ✅ | Divergence tracking |
| Security Settings | ✅ | Password policy, session timeout |
| AI Settings | ✅ | Provider, model, limits |
| Storage config | ✅ | Cloudflare R2 أو local |
| Branding | ✅ | Logo, colors |
| Modules toggle | ✅ | Enable/disable per org |
| Plan management | ✅ | system_owner فقط |
| Resend invitation button | ❌ | لا يوجد في UI |

---

## 17. Audit & Compliance

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Audit log (كل action) | ✅ | Append-only، لا يُحذف |
| Org-scoping للـ audit logs | ✅ | admin يرى org-ه فقط |
| system_owner يرى الكل | ✅ | |
| Audit log export (Excel + CSV) | ✅ | |
| Regression tests للـ scoping | ✅ | إصلاح R7 — 11 tests |

---

## 18. Integrations & Infrastructure

| الميزة | الحالة | ملاحظة |
|--------|--------|---------|
| Cloudflare R2 storage | ✅ | Default في production |
| Local file storage (fallback) | ✅ | |
| Email (Resend) | ✅ | يسقط بصمت إذا لم يُضبط |
| AI (OpenRouter) | ✅ | مُعطَّل بـ VITE_AI_ENABLED=false |
| AI stub (AIProcedurePanel) | ✅ | Interface محفوظة للتفعيل لاحقاً |
| Drizzle ORM migrations (auto) | ✅ | يشتغل عند كل container start |
| Docker Compose deployment | ✅ | deploy.sh — git pull + build + up |
| Cloudflare CDN | ✅ | اختياري (CF_API_TOKEN) |
| Mobile app | ❌ | API جاهز — لا frontend |
| API documentation | ❌ | |
| Webhooks | ❌ | |
| SSO / SAML | ❌ | |

---

## ملاحظات مهمة (Known Constraints)

| # | الموضوع | التفاصيل |
|---|---------|---------|
| K1 | isSysAdmin() bug | admin يرى جميع org في بعض endpoints — تم تضييق 4 endpoints (R2) |
| K2 | Cross-org project access | غير مدعوم by design — Transmittals هو آلية التعاون |
| K3 | Transmittals plan-gated | Professional+ فقط — قرار تجاري مؤجل |
| K4 | PDF Unicode | em-dash وأحرف خاصة تظهر كـ "yy" في jsPDF |
| K5 | Column sort UI | backend يدعم sortBy لكن headers غير قابلة للنقر |
| K6 | Audit logs org_id = null | للسجلات القديمة — buildOrgCondition يعالجها |
| K7 | Tasks with projectId = null | لا org scope — لا أحد يستطيع رؤيتها cross-org |
| K8 | Default WF seed — orgs الجديدة فقط | `seed-wf-defaults.mjs` idempotent — الـ orgs الحالية لا تُعدَّل تلقائياً. يمكن تحديثها يدوياً بـ "Setup Default Templates" في Workflow Engine |
| K9 | Invoice Approval Workflow | مُزال من default seed (2026-06-26). يُنشأ يدوياً من Workflow Engine أو مستقبلاً عبر Template Library لأنه متخصص لكل شركة |

---

*يُحدَّث هذا الملف مع كل commit يضيف أو يُغيّر ميزة.*
