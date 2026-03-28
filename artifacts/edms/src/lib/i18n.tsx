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
  },
} as const;

type TranslationKeys = keyof typeof translations.en;

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
