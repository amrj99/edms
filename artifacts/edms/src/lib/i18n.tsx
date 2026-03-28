import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

type Lang = "en" | "ar";

const translations = {
  en: {
    // Navigation / menu
    reports: "Reports",
    masterRegister: "Master Register",
    correspondenceRegister: "Correspondence Register",
    transmittalRegister: "Transmittal Register",
    drawingRegister: "Drawing Register",
    itrMirRegister: "ITR / MIR",
    ncrSorRegister: "NCR / SOR",
    nocRegister: "NOC",
    language: "Language",
    english: "English",
    arabic: "Arabic",

    // Actions
    exportExcel: "Excel",
    exportPdf: "PDF",
    print: "Print",
    clearFilters: "Clear Filters",
    refresh: "Refresh",
    addRecord: "Add Record",

    // Filters
    project: "Project",
    allProjects: "All Projects",
    status: "Status",
    allStatuses: "All Statuses",
    dateFrom: "From",
    dateTo: "To",
    search: "Search…",
    discipline: "Discipline",
    allDisciplines: "All Disciplines",
    type: "Type",
    allTypes: "All Types",
    party: "Party Type",
    allParties: "All Parties",

    // Common columns
    no: "No.",
    docNumber: "Doc No.",
    title: "Title",
    revision: "Rev",
    date: "Date",
    updatedAt: "Updated",
    remarks: "Remarks",
    department: "Department",
    linkedCorrespondence: "Linked Corr.",
    linkedTransmittal: "Linked Transmittal",
    project_col: "Project",
    source: "Source",
    issuedBy: "Issued By",
    loading: "Loading…",
    noData: "No records found",
    records: "records",
    selectProject: "Select a project to view this register",

    // Master Register
    masterRegisterDesc: "All documents and linked correspondence & transmittals",
    documentType: "Type",

    // Correspondence Register
    correspondenceNo: "Corr. No.",
    from: "From",
    to: "To",
    subject: "Subject",
    relatedDocuments: "Related Documents",
    priority: "Priority",
    dueDate: "Due Date",
    client: "Client",
    consultant: "Consultant",
    subcontractor: "Subcontractor",
    other: "Other",

    // Transmittal Register
    transmittalNo: "Transmittal No.",
    documentsIncluded: "Documents",
    sentDate: "Sent",
    acknowledged: "Acknowledged",
    purpose: "Purpose",

    // Drawing Register
    drawingNo: "Drawing No.",

    // ITR / MIR
    requestNo: "Request No.",
    requestType: "Type",
    location: "Location",
    contractor: "Contractor",
    itr: "ITR",
    mir: "MIR",

    // NCR / SOR
    reportNo: "Report No.",
    description: "Description",
    raisedBy: "Raised By",
    correctiveAction: "Corrective Action",
    closeDate: "Close Date",
    ncr: "NCR",
    sor: "SOR",

    // NOC
    nocNo: "NOC No.",
    authority: "Authority",
    linkedDocument: "Linked Document",

    // Status
    draft: "Draft",
    approved: "Approved",
    rejected: "Rejected",
    sent: "Sent",
    acknowledged_s: "Acknowledged",
    closed: "Closed",
    open: "Open",
    pending: "Pending",
    under_review: "Under Review",
    issued: "Issued",
    superseded: "Superseded",
    void: "Void",
    in_progress: "In Progress",
    passed: "Passed",
    failed: "Failed",
    cancelled: "Cancelled",
    scheduled: "Scheduled",
    expired: "Expired",
    voided: "Voided",

    // Summary cards
    totalDocuments: "Total Documents",
    openRfis: "Open Correspondence",
    transmittals: "Transmittals",
    activeProjects: "Active Projects",

    // Activity Log
    activityLog: "Activity Log",
    activityLogDesc: "Full audit trail of all system actions",
    allEntityTypes: "All Entity Types",
    allActions: "All Actions",
    allUsers: "All Users",
    timestamp: "Timestamp",
    user: "User",
    action: "Action",
    entityType: "Entity Type",
    entityTitle: "Entity / Title",
    changeDetails: "Change Details",
    noActivityRecords: "No activity records match your filters",
    entries: "entries",
    exportExcelLabel: "Export Excel",
    details: "Details",
    clear: "Clear",
    activityDetail: "Activity Detail",
    logEntry: "Log entry",
    loadingActivity: "Loading activity log…",
    searchEntities: "Search entities, users…",
    exportFailed: "Export failed. Please try again.",
    // Action labels
    action_create: "Create",
    action_update: "Update",
    action_delete: "Delete",
    action_approve: "Approve",
    action_reject: "Reject",
    action_upload: "Upload",
    action_submit: "Submit",
    action_workflow_approve: "Workflow Approve",
    action_workflow_reject: "Workflow Reject",
    action_workflow_submit: "Workflow Submit",
    action_share: "Share",
    action_login: "Login",
    // Entity type labels
    entity_document: "Document",
    entity_correspondence: "Correspondence",
    entity_transmittal: "Transmittal",
    entity_ncr: "NCR",
    entity_itr: "ITR",
    entity_noc: "NOC",
    entity_deliverable: "Deliverable",
    entity_project: "Project",
    entity_user: "User",
    entity_task: "Task",
    entity_workflow: "Workflow",

    // Module Licensing
    modules: "Modules",
    modulesDesc: "Enable or disable feature modules per organization",
    moduleLicensing: "Module Licensing",
    moduleLicensingDesc: "Enable or disable feature modules per organization. Disabled modules are hidden from users' navigation and blocked on direct URL access.",
    module_dashboard: "Dashboard",
    module_deliverables: "Deliverables",
    module_registers: "Registers",
    module_notifications: "Notifications",
    moduleDesc_dashboard: "Main dashboard with project overview, activity feed, and configurable widgets",
    moduleDesc_deliverables: "Track project deliverables, planned vs actual dates, and linked documents",
    moduleDesc_registers: "All 7 document registers: master, correspondence, transmittals, drawings, ITR/MIR, NCR/SOR, NOC",
    moduleDesc_notifications: "In-app notification bell and alerts for users in this organization",
    moduleEnabled: "Enabled",
    moduleDisabled: "Disabled",
    saveModules: "Save Module Settings",
    saving: "Saving…",
    modulesSaved: "Module settings saved",
    moduleNotAvailable: "Module Not Available",
    moduleNotAvailableDesc: "This feature has been disabled by your organization administrator. Contact your admin to enable it.",
    moduleOrganization: "Organization",
    moduleMyOrg: "My Organization",
    selectOrgForModules: "Select an organization to configure modules",
    modulesSaveError: "Failed to save module settings",
    goHome: "Go to Dashboard",

    // Organization Management
    organizations: "Organizations",
    organizationsDesc: "Manage partner companies, clients, and contractors",
    addOrganization: "Add Organization",
    editOrganization: "Edit Organization",
    deleteOrganization: "Delete Organization",
    orgName: "Company Name",
    orgType: "Organization Type",
    orgContactEmail: "Contact Email",
    orgContactPhone: "Contact Phone",
    orgAddress: "Address",
    orgMembers: "Members",
    orgProjects: "Projects",
    orgAddedOn: "Added On",
    orgActions: "Actions",
    orgNoData: "No organizations found",
    orgCreated: "Organization created successfully",
    orgUpdated: "Organization updated successfully",
    orgDeleted: "Organization deleted",
    orgCreateFailed: "Failed to create organization",
    orgUpdateFailed: "Failed to update organization",
    orgDeleteFailed: "Failed to delete organization",
    orgDeleteConfirm: "Are you sure you want to delete this organization? This action cannot be undone.",
    orgTypeClient: "Client",
    orgTypeConsultant: "Consultant",
    orgTypeContractor: "Contractor",
    orgTypeSubcontractor: "Subcontractor",
    orgSwitcher: "Switch Organization",
    orgSwitcherAll: "All Organizations",
    orgSwitcherActive: "Viewing:",
    orgName_label: "Organization",
    crossOrgStats: "Cross-Organization Overview",
    crossOrgStatsDesc: "Project and document counts per organization",
    crossOrgProjects: "Projects",
    crossOrgDocs: "Documents",
    crossOrgOpenNCR: "Open NCR",
    noOrgsFound: "No organizations found",

    // Workflow Approvals
    approvalWorkflow: "Approval Workflow",
    approvalStatus: "Approval Status",
    approvalNone: "Not Submitted",
    approvalPending: "Pending Approval",
    approvalApproved: "Approved",
    approvalRejected: "Rejected",
    submitForApproval: "Submit for Approval",
    approveRecord: "Approve",
    rejectRecord: "Reject",
    approvalComment: "Comment",
    approvalCommentPlaceholder: "Add a comment (optional)…",
    approvedBy: "Approved By",
    approvedAt: "Decision Date",
    approvalSubmitted: "Submitted for approval",
    approvalApprovedMsg: "Record approved",
    approvalRejectedMsg: "Record rejected",
    approvalError: "Approval action failed",
    confirmApprove: "Confirm Approval",
    confirmReject: "Confirm Rejection",
    confirmApproveDesc: "Are you sure you want to approve this record?",
    confirmRejectDesc: "Are you sure you want to reject this record?",
    cancel: "Cancel",
    confirm: "Confirm",
    create: "Create",
    saveChanges: "Save Changes",
    delete: "Delete",
    users: "Users",
    documents: "Documents",
    projects: "Projects",
    manageOrganizations: "Manage Organizations",
  },
  ar: {
    // Navigation / menu
    reports: "التقارير",
    masterRegister: "السجل الرئيسي",
    correspondenceRegister: "سجل المراسلات",
    transmittalRegister: "سجل ملاحظات الإرسال",
    drawingRegister: "سجل الرسومات",
    itrMirRegister: "طلب الفحص / المواد",
    ncrSorRegister: "تقرير عدم المطابقة",
    nocRegister: "موافقة عدم الاعتراض",
    language: "اللغة",
    english: "الإنجليزية",
    arabic: "العربية",

    // Actions
    exportExcel: "إكسل",
    exportPdf: "PDF",
    print: "طباعة",
    clearFilters: "مسح الفلاتر",
    refresh: "تحديث",
    addRecord: "إضافة سجل",

    // Filters
    project: "المشروع",
    allProjects: "جميع المشاريع",
    status: "الحالة",
    allStatuses: "جميع الحالات",
    dateFrom: "من",
    dateTo: "إلى",
    search: "بحث…",
    discipline: "التخصص",
    allDisciplines: "جميع التخصصات",
    type: "النوع",
    allTypes: "جميع الأنواع",
    party: "نوع الجهة",
    allParties: "جميع الجهات",

    // Common columns
    no: "م",
    docNumber: "رقم المستند",
    title: "العنوان",
    revision: "المراجعة",
    date: "التاريخ",
    updatedAt: "تاريخ التحديث",
    remarks: "ملاحظات",
    department: "القسم",
    linkedCorrespondence: "المراسلة المرتبطة",
    linkedTransmittal: "الإرسال المرتبط",
    project_col: "المشروع",
    source: "المصدر",
    issuedBy: "صادر عن",
    loading: "جاري التحميل…",
    noData: "لا توجد سجلات",
    records: "سجل",
    selectProject: "اختر مشروعاً لعرض هذا السجل",

    // Master Register
    masterRegisterDesc: "جميع المستندات مع المراسلات وملاحظات الإرسال المرتبطة",
    documentType: "النوع",

    // Correspondence Register
    correspondenceNo: "رقم المراسلة",
    from: "من",
    to: "إلى",
    subject: "الموضوع",
    relatedDocuments: "المستندات المرتبطة",
    priority: "الأولوية",
    dueDate: "تاريخ الاستحقاق",
    client: "العميل",
    consultant: "الاستشاري",
    subcontractor: "المقاول الفرعي",
    other: "أخرى",

    // Transmittal Register
    transmittalNo: "رقم الإرسال",
    documentsIncluded: "المستندات",
    sentDate: "أُرسل",
    acknowledged: "تم الاستلام",
    purpose: "الغرض",

    // Drawing Register
    drawingNo: "رقم الرسم",

    // ITR / MIR
    requestNo: "رقم الطلب",
    requestType: "النوع",
    location: "الموقع",
    contractor: "المقاول",
    itr: "فحص الاختبار",
    mir: "فحص المواد",

    // NCR / SOR
    reportNo: "رقم التقرير",
    description: "الوصف",
    raisedBy: "أُعد بواسطة",
    correctiveAction: "الإجراء التصحيحي",
    closeDate: "تاريخ الإغلاق",
    ncr: "عدم المطابقة",
    sor: "تقرير التفتيش",

    // NOC
    nocNo: "رقم عدم الاعتراض",
    authority: "الجهة المختصة",
    linkedDocument: "المستند المرتبط",

    // Status
    draft: "مسودة",
    approved: "معتمد",
    rejected: "مرفوض",
    sent: "مُرسل",
    acknowledged_s: "تم الاستلام",
    closed: "مغلق",
    open: "مفتوح",
    pending: "قيد الانتظار",
    under_review: "قيد المراجعة",
    issued: "صادر",
    superseded: "مستبدل",
    void: "ملغى",
    in_progress: "قيد التنفيذ",
    passed: "اجتاز",
    failed: "فشل",
    cancelled: "ملغى",
    scheduled: "مجدول",
    expired: "منتهي الصلاحية",
    voided: "باطل",

    // Summary cards
    totalDocuments: "إجمالي المستندات",
    openRfis: "المراسلات المفتوحة",
    transmittals: "ملاحظات الإرسال",
    activeProjects: "المشاريع النشطة",

    // Activity Log
    activityLog: "سجل الأنشطة",
    activityLogDesc: "سجل تدقيق شامل لجميع إجراءات النظام",
    allEntityTypes: "جميع أنواع الكيانات",
    allActions: "جميع الإجراءات",
    allUsers: "جميع المستخدمين",
    timestamp: "الطابع الزمني",
    user: "المستخدم",
    action: "الإجراء",
    entityType: "نوع الكيان",
    entityTitle: "الكيان / العنوان",
    changeDetails: "تفاصيل التغيير",
    noActivityRecords: "لا توجد سجلات نشاط تطابق الفلاتر",
    entries: "إدخال",
    exportExcelLabel: "تصدير Excel",
    details: "التفاصيل",
    clear: "مسح",
    activityDetail: "تفاصيل النشاط",
    logEntry: "إدخال السجل",
    loadingActivity: "جاري تحميل سجل الأنشطة…",
    searchEntities: "بحث في الكيانات والمستخدمين…",
    exportFailed: "فشل التصدير. يرجى المحاولة مجدداً.",
    // Action labels
    action_create: "إنشاء",
    action_update: "تحديث",
    action_delete: "حذف",
    action_approve: "موافقة",
    action_reject: "رفض",
    action_upload: "رفع",
    action_submit: "إرسال",
    action_workflow_approve: "موافقة سير العمل",
    action_workflow_reject: "رفض سير العمل",
    action_workflow_submit: "إرسال سير العمل",
    action_share: "مشاركة",
    action_login: "تسجيل دخول",
    // Entity type labels
    entity_document: "مستند",
    entity_correspondence: "مراسلات",
    entity_transmittal: "ملاحظة إرسال",
    entity_ncr: "تقرير عدم المطابقة",
    entity_itr: "طلب فحص",
    entity_noc: "شهادة عدم ممانعة",
    entity_deliverable: "مسلَّم",
    entity_project: "مشروع",
    entity_user: "مستخدم",
    entity_task: "مهمة",
    entity_workflow: "سير عمل",

    // Module Licensing
    modules: "الوحدات",
    modulesDesc: "تفعيل أو تعطيل وحدات الميزات لكل مؤسسة",
    moduleLicensing: "ترخيص الوحدات",
    moduleLicensingDesc: "تفعيل أو تعطيل وحدات الميزات لكل مؤسسة. الوحدات المعطّلة تُخفى من تنقل المستخدمين وتُحجب عند الدخول المباشر.",
    module_dashboard: "لوحة التحكم",
    module_deliverables: "المستخلصات",
    module_registers: "السجلات",
    module_notifications: "الإشعارات",
    moduleDesc_dashboard: "لوحة التحكم الرئيسية مع نظرة عامة على المشروع وخلاصة النشاط والأدوات القابلة للتكوين",
    moduleDesc_deliverables: "تتبع مستخلصات المشروع والتواريخ المخططة والفعلية والمستندات المرتبطة",
    moduleDesc_registers: "جميع السجلات السبعة: الرئيسي، المراسلات، ملاحظات الإرسال، الرسومات، ITR/MIR، NCR/SOR، NOC",
    moduleDesc_notifications: "جرس الإشعارات داخل التطبيق والتنبيهات للمستخدمين في هذه المؤسسة",
    moduleEnabled: "مفعّل",
    moduleDisabled: "معطّل",
    saveModules: "حفظ إعدادات الوحدات",
    saving: "جارٍ الحفظ…",
    modulesSaved: "تم حفظ إعدادات الوحدات",
    moduleNotAvailable: "الوحدة غير متاحة",
    moduleNotAvailableDesc: "تم تعطيل هذه الميزة من قِبل مدير مؤسستك. تواصل مع المدير لتفعيلها.",
    moduleOrganization: "المؤسسة",
    moduleMyOrg: "مؤسستي",
    selectOrgForModules: "اختر مؤسسة لضبط الوحدات",
    modulesSaveError: "فشل حفظ إعدادات الوحدات",
    goHome: "الذهاب إلى لوحة التحكم",

    // Organization Management
    organizations: "المؤسسات",
    organizationsDesc: "إدارة الشركات الشريكة والعملاء والمقاولين",
    addOrganization: "إضافة مؤسسة",
    editOrganization: "تعديل المؤسسة",
    deleteOrganization: "حذف المؤسسة",
    orgName: "اسم الشركة",
    orgType: "نوع المؤسسة",
    orgContactEmail: "البريد الإلكتروني للتواصل",
    orgContactPhone: "هاتف التواصل",
    orgAddress: "العنوان",
    orgMembers: "الأعضاء",
    orgProjects: "المشاريع",
    orgAddedOn: "تاريخ الإضافة",
    orgActions: "الإجراءات",
    orgNoData: "لا توجد مؤسسات",
    orgCreated: "تم إنشاء المؤسسة بنجاح",
    orgUpdated: "تم تحديث المؤسسة بنجاح",
    orgDeleted: "تم حذف المؤسسة",
    orgCreateFailed: "فشل إنشاء المؤسسة",
    orgUpdateFailed: "فشل تحديث المؤسسة",
    orgDeleteFailed: "فشل حذف المؤسسة",
    orgDeleteConfirm: "هل أنت متأكد من حذف هذه المؤسسة؟ لا يمكن التراجع عن هذا الإجراء.",
    orgTypeClient: "عميل",
    orgTypeConsultant: "استشاري",
    orgTypeContractor: "مقاول",
    orgTypeSubcontractor: "مقاول فرعي",
    orgSwitcher: "تبديل المؤسسة",
    orgSwitcherAll: "جميع المؤسسات",
    orgSwitcherActive: "عرض:",
    orgName_label: "المؤسسة",
    crossOrgStats: "نظرة عامة عبر المؤسسات",
    crossOrgStatsDesc: "عدد المشاريع والمستندات لكل مؤسسة",
    crossOrgProjects: "المشاريع",
    crossOrgDocs: "المستندات",
    crossOrgOpenNCR: "NCR مفتوح",
    noOrgsFound: "لا توجد مؤسسات",

    // Workflow Approvals
    approvalWorkflow: "سير عمل الاعتماد",
    approvalStatus: "حالة الاعتماد",
    approvalNone: "لم يُقدَّم",
    approvalPending: "قيد الاعتماد",
    approvalApproved: "معتمد",
    approvalRejected: "مرفوض",
    submitForApproval: "تقديم للاعتماد",
    approveRecord: "اعتماد",
    rejectRecord: "رفض",
    approvalComment: "تعليق",
    approvalCommentPlaceholder: "أضف تعليقاً (اختياري)…",
    approvedBy: "اعتمد بواسطة",
    approvedAt: "تاريخ القرار",
    approvalSubmitted: "تم تقديم الاعتماد",
    approvalApprovedMsg: "تم اعتماد السجل",
    approvalRejectedMsg: "تم رفض السجل",
    approvalError: "فشل إجراء الاعتماد",
    confirmApprove: "تأكيد الاعتماد",
    confirmReject: "تأكيد الرفض",
    confirmApproveDesc: "هل أنت متأكد من اعتماد هذا السجل؟",
    confirmRejectDesc: "هل أنت متأكد من رفض هذا السجل؟",
    cancel: "إلغاء",
    confirm: "تأكيد",
    create: "إنشاء",
    saveChanges: "حفظ التغييرات",
    delete: "حذف",
    users: "المستخدمون",
    documents: "المستندات",
    projects: "المشاريع",
    manageOrganizations: "إدارة المؤسسات",
  },
} as const;

export type TranslationKeys = keyof typeof translations.en;

interface I18nContextType {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TranslationKeys) => string;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextType>({
  lang: "en",
  setLang: () => {},
  t: (key) => translations.en[key] ?? key,
  isRtl: false,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    return (localStorage.getItem("edms_lang") as Lang) ?? "en";
  });

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("edms_lang", l);
  };

  const isRtl = lang === "ar";

  useEffect(() => {
    document.documentElement.dir = isRtl ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, [lang, isRtl]);

  const t = (key: TranslationKeys): string => {
    return (translations[lang] as any)[key] ?? (translations.en as any)[key] ?? key;
  };

  return (
    <I18nContext.Provider value={{ lang, setLang, t, isRtl }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
